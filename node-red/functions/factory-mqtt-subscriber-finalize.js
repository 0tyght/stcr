const client = context.get("factoryMqttClient");
if (client) {
  client.removeAllListeners();
  client.end(true);
  context.set("factoryMqttClient", undefined);
}

// ปิด DB pool ของ MQTT adapter ด้วย
const mqttPool = global.get("stcrMqttDbPool");
if (mqttPool) {
  mqttPool.end().catch(() => {});
  global.set("stcrMqttDbPool", undefined);
}
