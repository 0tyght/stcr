import { resolve } from "node:path";

import mqtt from "mqtt";

import { envBoolean, envNumber } from "../config/env.mjs";
import { createLegacyFunctionRunner, createSerialExecutor } from "../runtime/function-runner.mjs";
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

function parseTopicRoutes() {
  const configured = String(process.env.STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON || "").trim();
  if (configured) {
    const parsed = JSON.parse(configured);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON must be an object");
    }
    return parsed;
  }

  const companyId = String(process.env.STCR_FACTORY_MQTT_COMPANY_ID || "ttn")
    .trim()
    .toLowerCase();
  const topics = String(process.env.STCR_FACTORY_MQTT_TOPICS || "test,sensor")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return Object.fromEntries(topics.map((topic) => [topic, {
    companyId,
    messageType: topic === "test" ? "status" : "sensor",
  }]));
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
          "roomtemp",
          "humanity",
          "oventemp",
          "blower",
        ];
        missingOrInvalidFields = fields.filter((field) => {
          const value = parsed[field];
          return value == null || value === "" || !Number.isFinite(Number(value));
        });
      }
    }
  } catch {
    // Adapter performs the final validation and rejection.
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
  const runSerial = createSerialExecutor();

  async function processMessage(message) {
    const adapted = await adapter(message);
    if (adapted?._mqttEnvelope || adapted?._minuteFlushTick) {
      await writer(adapted);
    }
  }

  const client = mqtt.connect(brokerUrl, {
    clientId: String(process.env.STCR_FACTORY_MQTT_CLIENT_ID || `stcr-express-${process.pid}`),
    username: process.env.STCR_FACTORY_MQTT_USERNAME || undefined,
    password: process.env.STCR_FACTORY_MQTT_PASSWORD || undefined,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
    rejectUnauthorized: envBoolean("STCR_FACTORY_MQTT_TLS_REJECT_UNAUTHORIZED", true),
  });

  setMqttHealth({
    connected: false,
    disabled: false,
    startedAt: new Date().toISOString(),
    topics: {},
  });

  client.on("connect", () => {
    client.subscribe(topics, { qos: 1 }, (error, grants) => {
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

  client.on("message", (topic, payload, packet) => {
    const route = routes[topic];
    const { receivedAt, totalMessages } = inspectPayload(topic, payload, route);
    if (totalMessages === 1 || totalMessages % 100 === 0) {
      console.log(`[express-mqtt] Received ${totalMessages} messages; latest topic=${topic}`);
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
    })).catch((error) => {
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
