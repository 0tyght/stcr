const enabled = String(env.get("STCR_FACTORY_MQTT_ENABLED") || "false").toLowerCase() === "true";
if (!enabled) {
  node.status({ fill: "grey", shape: "ring", text: "MQTT disabled" });
  return;
}

const deploymentMode = String(env.get("STCR_DEPLOYMENT_MODE") || "development").toLowerCase();
const brokerUrl = String(env.get("STCR_FACTORY_MQTT_URL") || "").trim();
const username = String(env.get("STCR_FACTORY_MQTT_USERNAME") || "").trim();
const password = String(env.get("STCR_FACTORY_MQTT_PASSWORD") || "");
const companyId = String(env.get("STCR_FACTORY_MQTT_COMPANY_ID") || "").trim().toLowerCase();
const topics = String(env.get("STCR_FACTORY_MQTT_TOPICS") || "test,sensor")
  .split(",")
  .map((topic) => topic.trim())
  .filter(Boolean);

if (!/^mqtts?:\/\//.test(brokerUrl) || !username || !password || !["gr", "ttn"].includes(companyId)) {
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

const client = mqtt.connect(brokerUrl, {
  username,
  password,
  clientId: String(env.get("STCR_FACTORY_MQTT_CLIENT_ID") || `stcr-${companyId}-server`),
  clean: true,
  protocolVersion: 4,
  connectTimeout: 10000,
  reconnectPeriod: 5000,
  keepalive: 60,
  rejectUnauthorized: String(env.get("STCR_FACTORY_MQTT_TLS_REJECT_UNAUTHORIZED") || "true").toLowerCase() !== "false",
});
context.set("factoryMqttClient", client);

client.on("connect", () => {
  client.subscribe(Object.fromEntries(topics.map((topic) => [topic, { qos: 1 }])), (error) => {
    if (error) {
      node.error(`Factory MQTT subscribe failed: ${error.message}`);
      node.status({ fill: "red", shape: "ring", text: "MQTT subscribe failed" });
      return;
    }
    node.status({ fill: "green", shape: "dot", text: `MQTT ${topics.join(", ")}` });
  });
});

client.on("message", (topic, payload, packet) => {
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

client.on("reconnect", () => node.status({ fill: "yellow", shape: "ring", text: "MQTT reconnecting" }));
client.on("offline", () => node.status({ fill: "red", shape: "ring", text: "MQTT offline" }));
client.on("error", (error) => {
  node.warn(`Factory MQTT connection error: ${error.message}`);
  node.status({ fill: "red", shape: "ring", text: "MQTT error" });
});
