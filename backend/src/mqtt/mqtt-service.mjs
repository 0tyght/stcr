import { resolve } from "node:path";

import mqtt from "mqtt";

import { envBoolean, envNumber } from "../config/env.mjs";
import {
  createBoundedSerialExecutor,
  createLegacyFunctionRunner,
} from "../runtime/function-runner.mjs";
import {
  globalStore,
  mqttAdapterContextStore,
  mqttWriterContextStore,
} from "../runtime/store.mjs";

const adapterPath = resolve(
  process.cwd(),
  "backend/src/legacy-functions/factory-mqtt-adapter.js",
);
const writerPath = resolve(
  process.cwd(),
  "backend/src/legacy-functions/factory-mqtt-db-writer.js",
);

function deploymentMode() {
  return String(process.env.STCR_DEPLOYMENT_MODE || "development").trim().toLowerCase();
}

function validateRoute(topic, route) {
  if (!route || typeof route !== "object" || Array.isArray(route)) {
    throw new Error(`MQTT route for ${topic} must be an object`);
  }
  const companyId = String(route.companyId || "").trim().toLowerCase();
  const messageType = String(route.messageType || "").trim().toLowerCase();
  if (!companyId) throw new Error(`MQTT route for ${topic} is missing companyId`);
  if (!new Set(["status", "sensor"]).has(messageType)) {
    throw new Error(`MQTT route for ${topic} has invalid messageType`);
  }
  if (deploymentMode() === "production" && /[+#]/.test(topic)) {
    throw new Error(`Wildcard MQTT topic is not allowed in production: ${topic}`);
  }
  return { companyId, messageType };
}

function parseTopicRoutes() {
  const configured = String(process.env.STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON || "").trim();
  let parsed;
  if (configured) {
    parsed = JSON.parse(configured);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON must be an object");
    }
  } else {
    const companyId = String(process.env.STCR_FACTORY_MQTT_COMPANY_ID || "ttn")
      .trim()
      .toLowerCase();
    const topics = String(process.env.STCR_FACTORY_MQTT_TOPICS || "test,sensor")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    parsed = Object.fromEntries(topics.map((topic) => [topic, {
      companyId,
      messageType: topic === "test" ? "status" : "sensor",
    }]));
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([topic, route]) => [topic, validateRoute(topic, route)]),
  );
}

function setMqttHealth(patch) {
  const current = globalStore.get("stcrMqttHealth") || { topics: {} };
  globalStore.set("stcrMqttHealth", {
    ...current,
    ...patch,
    topics: patch.topics || current.topics || {},
    runtime: "express",
  });
}

function incrementHealthCounter(name) {
  const health = globalStore.get("stcrMqttHealth") || { topics: {} };
  setMqttHealth({ [name]: Number(health[name] || 0) + 1 });
}

const sensorSourceFields = {
  chamberTemp: "roomtemp",
  humidity: "humanity",
  furnaceTemp: "oventemp",
  blowerTemp: "blower",
};

function requiredSensorFields(companyId) {
  const defaults = {
    ttn: Object.keys(sensorSourceFields),
    gr: ["chamberTemp", "humidity"],
  };
  const configured = String(
    process.env.STCR_FACTORY_MQTT_REQUIRED_SENSORS_JSON || "",
  ).trim();
  if (!configured) {
    return (defaults[companyId] || []).map((key) => sensorSourceFields[key]);
  }
  try {
    const parsed = JSON.parse(configured);
    const profile = parsed?.[companyId];
    if (!Array.isArray(profile)) {
      return (defaults[companyId] || []).map((key) => sensorSourceFields[key]);
    }
    return profile.map((key) => sensorSourceFields[key]).filter(Boolean);
  } catch {
    return (defaults[companyId] || []).map((key) => sensorSourceFields[key]);
  }
}

function inspectPayload(topic, payload, route) {
  const health = globalStore.get("stcrMqttHealth") || { topics: {} };
  const previous = health.topics?.[topic] || { count: 0 };
  const receivedAt = new Date().toISOString();
  let payloadFields = [];
  let missingOrInvalidFields = [];
  let latestOven = null;

  try {
    const parsed = JSON.parse(payload.toString("utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      payloadFields = Object.keys(parsed).sort();
      const oven = Number(parsed.oven);
      latestOven = Number.isSafeInteger(oven) ? oven : null;
      if (route?.messageType === "sensor") {
        const fields = [
          "startoven",
          "oven",
          "cycle",
          ...requiredSensorFields(route.companyId),
        ];
        missingOrInvalidFields = fields.filter((field) => {
          const value = parsed[field];
          return value == null || value === "" || !Number.isFinite(Number(value));
        });
      }
    }
  } catch {
    // The adapter performs final schema validation and rejection.
  }

  const totalMessages = Number(health.totalMessages || 0) + 1;
  setMqttHealth({
    connected: true,
    lastMessageAt: receivedAt,
    totalMessages,
    topics: {
      ...(health.topics || {}),
      [topic]: {
        count: Number(previous.count || 0) + 1,
        lastReceivedAt: receivedAt,
        payloadFields,
        missingOrInvalidFields,
        latestOven,
      },
    },
  });

  return { receivedAt, totalMessages };
}

export async function startMqttService() {
  const enabled = envBoolean("STCR_FACTORY_MQTT_ENABLED", false);
  if (!enabled) {
    setMqttHealth({ connected: false, disabled: true, topics: {} });
    console.log("[express-mqtt] MQTT is disabled by STCR_FACTORY_MQTT_ENABLED");
    return async () => undefined;
  }

  const brokerUrl = String(process.env.STCR_FACTORY_MQTT_URL || "").trim();
  if (!brokerUrl) throw new Error("STCR_FACTORY_MQTT_URL is required when MQTT is enabled");

  const routes = parseTopicRoutes();
  const topics = Object.keys(routes);
  if (!topics.length) throw new Error("No MQTT topics are configured");

  const adapter = await createLegacyFunctionRunner({
    filename: adapterPath,
    scope: "express-mqtt-adapter",
    globalStore,
    contextStore: mqttAdapterContextStore,
  });
  const writer = await createLegacyFunctionRunner({
    filename: writerPath,
    scope: "express-mqtt-writer",
    globalStore,
    contextStore: mqttWriterContextStore,
  });
  const runSerial = createBoundedSerialExecutor(
    envNumber("STCR_FACTORY_MQTT_MAX_PENDING_MESSAGES", 1000, 10, 100000),
  );

  async function processMessage(message) {
    const adapted = await adapter(message);
    if (adapted?._mqttEnvelope || adapted?._minuteFlushTick) {
      await writer(adapted);
      return true;
    }
    return false;
  }

  const qos = envNumber("STCR_FACTORY_MQTT_QOS", 1, 0, 2);
  const client = mqtt.connect(brokerUrl, {
    clientId: String(process.env.STCR_FACTORY_MQTT_CLIENT_ID || `stcr-express-${process.pid}`),
    username: process.env.STCR_FACTORY_MQTT_USERNAME || undefined,
    password: process.env.STCR_FACTORY_MQTT_PASSWORD || undefined,
    clean: true,
    protocolVersion: 4,
    keepalive: envNumber("STCR_FACTORY_MQTT_KEEPALIVE_SECONDS", 30, 5, 300),
    reconnectPeriod: envNumber("STCR_FACTORY_MQTT_RECONNECT_MS", 5000, 1000, 60000),
    connectTimeout: envNumber("STCR_FACTORY_MQTT_CONNECT_TIMEOUT_MS", 10000, 1000, 60000),
    resubscribe: true,
    queueQoSZero: false,
    rejectUnauthorized: envBoolean("STCR_FACTORY_MQTT_TLS_REJECT_UNAUTHORIZED", true),
  });

  setMqttHealth({
    connected: false,
    disabled: false,
    startedAt: new Date().toISOString(),
    topics: {},
  });

  client.on("connect", () => {
    client.subscribe(topics, { qos }, (error, grants) => {
      if (error) {
        setMqttHealth({ connected: false, lastErrorAt: new Date().toISOString() });
        console.error("[express-mqtt] Subscribe failed", error);
        return;
      }
      setMqttHealth({
        connected: true,
        connectedAt: new Date().toISOString(),
        subscriptions: grants,
      });
      console.log(`[express-mqtt] Connected and subscribed: ${topics.join(", ")}`);
    });
  });

  const maxPayloadBytes = envNumber(
    "STCR_FACTORY_MQTT_MAX_PAYLOAD_BYTES",
    8192,
    256,
    1048576,
  );
  const allowRetainedSensor = envBoolean("STCR_FACTORY_MQTT_ALLOW_RETAINED_SENSOR", false);
  const ackTopicPrefix = String(
    process.env.STCR_FACTORY_MQTT_ACK_TOPIC_PREFIX || "stcr/ack",
  )
    .trim()
    .replace(/\/+$/, "");
  const logEvery = envNumber(
    "STCR_FACTORY_MQTT_LOG_EVERY_MESSAGES",
    deploymentMode() === "production" ? 1000 : 100,
    1,
    1000000,
  );

  client.on("message", (topic, payload, packet) => {
    const route = routes[topic];
    if (!route) {
      incrementHealthCounter("rejectedUnknownTopic");
      return;
    }
    if (payload.length > maxPayloadBytes) {
      incrementHealthCounter("rejectedOversize");
      console.warn(`[express-mqtt] Rejected oversized payload on ${topic}: ${payload.length} bytes`);
      return;
    }
    if (packet.retain && route.messageType === "sensor" && !allowRetainedSensor) {
      incrementHealthCounter("rejectedRetainedSensor");
      console.warn(`[express-mqtt] Rejected retained sensor payload on ${topic}`);
      return;
    }

    const { receivedAt, totalMessages } = inspectPayload(topic, payload, route);
    if (totalMessages === 1 || totalMessages % logEvery === 0) {
      console.log(`[express-mqtt] Received ${totalMessages} messages; latest topic=${topic}`);
    }

    let localMessageId = "";
    try {
      const parsed = JSON.parse(payload.toString("utf8"));
      const candidate = String(parsed?._stcr_message_id || "").trim();
      if (/^[A-Za-z0-9._:-]{16,160}$/.test(candidate)) {
        localMessageId = candidate;
      }
    } catch {
      // The adapter below performs the authoritative JSON validation.
    }

    void runSerial(() => processMessage({
      topic,
      payload: payload.toString("utf8"),
      factoryMqtt: {
        qos: packet.qos,
        retain: Boolean(packet.retain),
        duplicate: Boolean(packet.dup),
        receivedAt,
        route,
      },
    })).then((persisted) => {
      if (!persisted || !localMessageId || !ackTopicPrefix || !client.connected) return;
      const ackTopic = `${ackTopicPrefix}/${route.companyId}`;
      client.publish(
        ackTopic,
        JSON.stringify({
          messageId: localMessageId,
          sourceTopic: topic,
          companyId: route.companyId,
          storedAt: new Date().toISOString(),
        }),
        { qos: 1, retain: false },
        (error) => {
          if (error) {
            incrementHealthCounter("ackPublishFailed");
            console.error(`[express-mqtt] ACK publish failed for ${localMessageId}`, error);
          }
        },
      );
    }).catch((error) => {
      if (error?.code === "SERIAL_QUEUE_FULL") {
        incrementHealthCounter("rejectedQueueFull");
        console.error("[express-mqtt] Processing queue is full; message rejected");
        return;
      }
      setMqttHealth({ lastErrorAt: new Date().toISOString() });
      console.error("[express-mqtt] Message processing failed", error);
    });
  });

  client.on("reconnect", () => {
    setMqttHealth({ connected: false, reconnectingAt: new Date().toISOString() });
    console.warn("[express-mqtt] Reconnecting");
  });
  client.on("offline", () => {
    setMqttHealth({ connected: false, disconnectedAt: new Date().toISOString() });
    console.warn("[express-mqtt] Offline");
  });
  client.on("close", () => {
    setMqttHealth({ connected: false, disconnectedAt: new Date().toISOString() });
  });
  client.on("error", (error) => {
    setMqttHealth({ connected: false, lastErrorAt: new Date().toISOString() });
    console.error("[express-mqtt] Connection error", error);
  });

  const flushIntervalMs = envNumber(
    "STCR_FACTORY_MQTT_FLUSH_INTERVAL_MS",
    5000,
    1000,
    60000,
  );
  const flushTimer = setInterval(() => {
    const receivedAt = new Date().toISOString();
    void runSerial(() => processMessage({
      _minuteFlushTick: true,
      factoryMqtt: { receivedAt },
    })).catch((error) => {
      if (error?.code === "SERIAL_QUEUE_FULL") {
        incrementHealthCounter("rejectedFlushQueueFull");
        return;
      }
      console.error("[express-mqtt] Minute flush failed", error);
    });
  }, flushIntervalMs);
  flushTimer.unref?.();

  return async function stopMqttService() {
    clearInterval(flushTimer);
    await new Promise((resolveStop) => client.end(true, resolveStop));
    const pool = globalStore.get("stcrMqttDbPool");
    if (pool?.end) await pool.end().catch(() => undefined);
    globalStore.set("stcrMqttDbPool", undefined);
    setMqttHealth({ connected: false, stoppedAt: new Date().toISOString() });
  };
}
