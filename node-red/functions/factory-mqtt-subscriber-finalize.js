const client = context.get("factoryMqttClient");
if (client) {
  client.removeAllListeners();
  client.end(true);
  context.set("factoryMqttClient", undefined);
}
