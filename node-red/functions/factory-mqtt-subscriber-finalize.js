const minuteFlushTimer = context.get("factoryMqttMinuteFlushTimer");
if (minuteFlushTimer) {
  clearInterval(minuteFlushTimer);
  context.set("factoryMqttMinuteFlushTimer", undefined);
}

const client = context.get("factoryMqttClient");
if (client) {
  client.removeAllListeners();
  client.end(true);
  context.set("factoryMqttClient", undefined);
}

const mqttPool = global.get("stcrMqttDbPool");
if (mqttPool) {
  mqttPool.end().catch(() => {});
  global.set("stcrMqttDbPool", undefined);
}

global.set("stcrMinuteFlushRunning", false);
