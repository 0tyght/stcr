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
const companyId = String(
  env.get("STCR_FACTORY_MQTT_COMPANY_ID") || "",
)
  .trim()
  .toLowerCase();
const topics = String(env.get("STCR_FACTORY_MQTT_TOPICS") || "test,sensor")
  .split(",")
  .map((topic) => topic.trim())
  .filter(Boolean);

if (
  !/^mqtts?:\/\//.test(brokerUrl) ||
  !username ||
  !password ||
  !["gr", "ttn"].includes(companyId)
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

if (!topics.length || topics.some((topic) => !["test", "sensor"].includes(topic))) {
  node.error("Factory MQTT topics must be test and/or sensor");
  node.status({ fill: "red", shape: "ring", text: "MQTT topics invalid" });
  return;
}

const clientId = String(
  env.get("STCR_FACTORY_MQTT_CLIENT_ID") || `stcr-${companyId}-server`,
);

node.log(
  `Connecting Factory MQTT: company=${companyId}, broker=${brokerUrl}, topics=${topics.join(
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

client.on("connect", () => {
  node.log(`Factory MQTT connected: ${brokerUrl}`);

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
      receivedAt: new Date().toISOString(),
    },
  });
});

client.on("reconnect", () => {
  node.status({ fill: "yellow", shape: "ring", text: "MQTT reconnecting" });
  node.log("Factory MQTT reconnecting");
});

client.on("offline", () => {
  node.status({ fill: "red", shape: "ring", text: "MQTT offline" });
  node.warn("Factory MQTT is offline");
});

client.on("close", () => {
  node.status({ fill: "red", shape: "ring", text: "MQTT disconnected" });
  node.log("Factory MQTT connection closed");
});

client.on("error", (error) => {
  node.warn(`Factory MQTT connection error: ${error.message}`);
  node.status({ fill: "red", shape: "ring", text: "MQTT error" });
});
