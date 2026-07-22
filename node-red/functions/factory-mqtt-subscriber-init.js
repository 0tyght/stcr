const enabled =
  String(env.get("STCR_FACTORY_MQTT_ENABLED") || "false").toLowerCase() ===
  "true";

if (!enabled) {
  node.status({ fill: "grey", shape: "ring", text: "MQTT disabled" });
  node.log("Factory MQTT is disabled by STCR_FACTORY_MQTT_ENABLED");
  return;
}

// สร้าง DB pool ล่วงหน้าเพื่อลด latency ของข้อความแรก
if (!global.get("stcrMqttDbPool")) {
  const dbPassword = String(env.get("STCR_DB_PASSWORD") || "");

  if (dbPassword) {
    const pool = mysql.createPool({
      host: env.get("STCR_DB_HOST") || "127.0.0.1",
      port: Number(env.get("STCR_DB_PORT") || 3306),
      user: env.get("STCR_DB_USER") || "stcr_app",
      password: dbPassword,
      database: env.get("STCR_DB_NAME") || "stcr",
      waitForConnections: true,
      connectionLimit: 4,
      timezone: "Z",
    });

    global.set("stcrMqttDbPool", pool);
  }
}

const deploymentMode = String(
  env.get("STCR_DEPLOYMENT_MODE") || "development",
).toLowerCase();
const brokerUrl = String(env.get("STCR_FACTORY_MQTT_URL") || "").trim();
const username = String(
  env.get("STCR_FACTORY_MQTT_USERNAME") || "",
).trim();
const password = String(env.get("STCR_FACTORY_MQTT_PASSWORD") || "");

function readTopicRoutes() {
  const rawRoutes = String(
    env.get("STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON") || "",
  ).trim();

  if (rawRoutes) {
    const parsed = JSON.parse(rawRoutes);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("MQTT topic routes must be a JSON object");
    }

    const routes = {};
    for (const [rawTopic, rawRoute] of Object.entries(parsed)) {
      const topic = String(rawTopic || "").trim();
      const companyId = String(rawRoute?.companyId || "").trim().toLowerCase();
      const messageType = String(rawRoute?.messageType || "").trim().toLowerCase();
      if (
        !topic || topic.length > 256 || /[#+\u0000]/.test(topic) ||
        !["gr", "ttn"].includes(companyId) ||
        !["status", "sensor"].includes(messageType)
      ) {
        throw new Error(`Invalid MQTT route for topic ${topic || "(empty)"}`);
      }
      routes[topic] = { companyId, messageType };
    }
    if (!Object.keys(routes).length) throw new Error("MQTT topic routes are empty");
    return routes;
  }

  // Backward compatibility for installations configured for one company.
  const companyId = String(
    env.get("STCR_FACTORY_MQTT_COMPANY_ID") || "",
  ).trim().toLowerCase();
  const topics = String(env.get("STCR_FACTORY_MQTT_TOPICS") || "test,sensor")
    .split(",")
    .map((topic) => topic.trim())
    .filter(Boolean);
  if (!(["gr", "ttn"].includes(companyId)) ||
      !topics.length || topics.some((topic) => !["test", "sensor"].includes(topic))) {
    throw new Error("Legacy MQTT company/topics configuration is invalid");
  }
  return Object.fromEntries(
    topics.map((topic) => [
      topic,
      { companyId, messageType: topic === "test" ? "status" : "sensor" },
    ]),
  );
}

let topicRoutes;
try {
  topicRoutes = readTopicRoutes();
} catch (error) {
  node.error(`Factory MQTT topic routes are invalid: ${error.message}`);
  node.status({ fill: "red", shape: "ring", text: "MQTT routes invalid" });
  return;
}
const topics = Object.keys(topicRoutes);
const companies = [...new Set(Object.values(topicRoutes).map((route) => route.companyId))];

function updateMqttHealth(patch) {
  const current = global.get("stcrMqttHealth") || { topics: {} };
  global.set("stcrMqttHealth", {
    ...current,
    ...patch,
    topics: patch.topics || current.topics || {},
  });
}

if (
  !/^mqtts?:\/\//.test(brokerUrl) ||
  !username ||
  !password
) {
  node.error("Factory MQTT configuration is incomplete");
  node.status({ fill: "red", shape: "ring", text: "MQTT config invalid" });
  return;
}

if (deploymentMode === "production" && !brokerUrl.startsWith("mqtts://")) {
  node.error("Factory MQTT must use TLS in production");
  node.status({ fill: "red", shape: "ring", text: "MQTT TLS required" });
  return;
}

const clientId = String(
  env.get("STCR_FACTORY_MQTT_CLIENT_ID") || "stcr-multi-company-server",
);

node.log(
  `Connecting Factory MQTT: companies=${companies.join(",")}, broker=${brokerUrl}, topics=${topics.join(
    ",",
  )}, clientId=${clientId}`,
);
node.status({ fill: "yellow", shape: "ring", text: "MQTT connecting" });

const client = mqtt.connect(brokerUrl, {
  username,
  password,
  clientId,
  clean: true,
  protocolVersion: 4,
  connectTimeout: 10000,
  reconnectPeriod: 5000,
  keepalive: 60,
  resubscribe: true,
  rejectUnauthorized:
    String(
      env.get("STCR_FACTORY_MQTT_TLS_REJECT_UNAUTHORIZED") || "true",
    ).toLowerCase() !== "false",
});

context.set("factoryMqttClient", client);
context.set("factoryMqttMessageCount", 0);
updateMqttHealth({
  connected: false,
  configuredTopics: topics,
  startedAt: new Date().toISOString(),
  topics: {},
});

const minuteFlushIntervalMs = Math.max(
  1000,
  Number(env.get("STCR_FACTORY_MQTT_FLUSH_INTERVAL_MS") || 5000),
);
const minuteFlushTimer = setInterval(() => {
  node.send({
    _minuteFlushTick: true,
    factoryMqtt: {
      receivedAt: new Date().toISOString(),
    },
  });
}, minuteFlushIntervalMs);
context.set("factoryMqttMinuteFlushTimer", minuteFlushTimer);

client.on("connect", () => {
  node.log(`Factory MQTT connected: ${brokerUrl}`);
  updateMqttHealth({ connected: true, connectedAt: new Date().toISOString() });

  client.subscribe(
    Object.fromEntries(topics.map((topic) => [topic, { qos: 1 }])),
    (error, granted) => {
      if (error) {
        node.error(`Factory MQTT subscribe failed: ${error.message}`);
        node.status({
          fill: "red",
          shape: "ring",
          text: "MQTT subscribe failed",
        });
        return;
      }

      const subscribedTopics = (granted || [])
        .map((item) => `${item.topic}(qos${item.qos})`)
        .join(", ");

      node.log(`Factory MQTT subscribed: ${subscribedTopics || topics.join(", ")}`);
      node.status({
        fill: "green",
        shape: "dot",
        text: `MQTT ${topics.join(", ")}`,
      });
    },
  );
});

client.on("message", (topic, payload, packet) => {
  const count = Number(context.get("factoryMqttMessageCount") || 0) + 1;
  context.set("factoryMqttMessageCount", count);
  const receivedAt = new Date().toISOString();
  const health = global.get("stcrMqttHealth") || { topics: {} };
  const topicHealth = health.topics?.[topic] || { count: 0 };
  let payloadFields = [];
  let missingOrInvalidFields = [];
  let latestOven = null;
  try {
    const parsedPayload = JSON.parse(payload.toString("utf8"));
    if (parsedPayload && typeof parsedPayload === "object" && !Array.isArray(parsedPayload)) {
      payloadFields = Object.keys(parsedPayload).sort();
      const parsedOven = Number(parsedPayload.oven);
      latestOven = Number.isSafeInteger(parsedOven) ? parsedOven : null;
      if (topicRoutes[topic]?.messageType === "sensor") {
        const numericFields = [
          "startoven", "oven", "cycle", "roomtemp", "humanity", "oventemp", "blower",
        ];
        missingOrInvalidFields = numericFields.filter((field) => {
          const value = parsedPayload[field];
          return value === null || value === undefined || value === "" || !Number.isFinite(Number(value));
        });
      }
    }
  } catch {
    // Payload validation is handled by the adapter; health keeps no raw values.
  }
  updateMqttHealth({
    connected: true,
    lastMessageAt: receivedAt,
    totalMessages: count,
    topics: {
      ...(health.topics || {}),
      [topic]: {
        count: Number(topicHealth.count || 0) + 1,
        lastReceivedAt: receivedAt,
        payloadFields,
        missingOrInvalidFields,
        latestOven,
      },
    },
  });

  // เขียน log ข้อความแรกและทุก 100 ข้อความ เพื่อไม่ให้ log โตเร็วเกินไป
  if (count === 1 || count % 100 === 0) {
    node.log(`Factory MQTT received ${count} message(s); latest topic=${topic}`);
  }

  node.send({
    topic,
    payload: payload.toString("utf8"),
    factoryMqtt: {
      qos: packet.qos,
      retain: Boolean(packet.retain),
      duplicate: Boolean(packet.dup),
      receivedAt,
      route: topicRoutes[topic],
    },
  });
});

client.on("reconnect", () => {
  node.status({ fill: "yellow", shape: "ring", text: "MQTT reconnecting" });
  node.log("Factory MQTT reconnecting");
});

client.on("offline", () => {
  updateMqttHealth({ connected: false, disconnectedAt: new Date().toISOString() });
  node.status({ fill: "red", shape: "ring", text: "MQTT offline" });
  node.warn("Factory MQTT is offline");
});

client.on("close", () => {
  updateMqttHealth({ connected: false, disconnectedAt: new Date().toISOString() });
  node.status({ fill: "red", shape: "ring", text: "MQTT disconnected" });
  node.log("Factory MQTT connection closed");
});

client.on("error", (error) => {
  updateMqttHealth({ lastErrorAt: new Date().toISOString() });
  node.warn(`Factory MQTT connection error: ${error.message}`);
  node.status({ fill: "red", shape: "ring", text: "MQTT error" });
});
