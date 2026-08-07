import { resolve } from "node:path";

import { createLegacyFunctionRunner } from "../src/runtime/function-runner.mjs";
import { RuntimeStore } from "../src/runtime/store.mjs";

const savedEnvironment = {
  deploymentMode: process.env.STCR_DEPLOYMENT_MODE,
  routes: process.env.STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON,
  maps: process.env.STCR_FACTORY_MQTT_OVEN_MAPS_JSON,
  ranges: process.env.STCR_FACTORY_MQTT_SENSOR_RANGES_JSON,
  spikes: process.env.STCR_FACTORY_MQTT_SPIKE_LIMITS_JSON,
  requiredSensors: process.env.STCR_FACTORY_MQTT_REQUIRED_SENSORS_JSON,
  offset: process.env.STCR_FACTORY_MQTT_SOURCE_UTC_OFFSET_MINUTES,
};

process.env.STCR_DEPLOYMENT_MODE = "production";
process.env.STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON = JSON.stringify({
  sensor: { companyId: "ttn", messageType: "sensor" },
  sensor_gr: { companyId: "gr", messageType: "sensor" },
});
process.env.STCR_FACTORY_MQTT_OVEN_MAPS_JSON = JSON.stringify({
  ttn: { 1: "oven-1" },
  gr: { 11: "oven-11", 14: "oven-14", 18: "oven-18", 19: "oven-19" },
});
process.env.STCR_FACTORY_MQTT_SENSOR_RANGES_JSON = JSON.stringify({
  chamberTemp: { min: 0, max: 150 },
  humidity: { min: 0, max: 100 },
  furnaceTemp: { min: 0, max: 1000 },
  blowerTemp: { min: 0, max: 600 },
});
process.env.STCR_FACTORY_MQTT_SPIKE_LIMITS_JSON = JSON.stringify({
  chamberTemp: 12,
  humidity: 20,
  furnaceTemp: 200,
  blowerTemp: 120,
});
delete process.env.STCR_FACTORY_MQTT_REQUIRED_SENSORS_JSON;
process.env.STCR_FACTORY_MQTT_SOURCE_UTC_OFFSET_MINUTES = "0";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function message(values, timestampMs) {
  return {
    topic: "sensor",
    payload: JSON.stringify({
      oven: 1,
      cycle: 12,
      startoven: 1,
      time_stamp: new Date(timestampMs).toISOString(),
      roomtemp: values.room,
      humanity: values.humidity,
      oventemp: values.furnace,
      blower: values.blower,
    }),
    factoryMqtt: {
      receivedAt: new Date(timestampMs).toISOString(),
      route: { companyId: "ttn", messageType: "sensor" },
      qos: 1,
      retain: false,
      duplicate: false,
    },
  };
}

function grMessage(values, timestampMs, oven = 14) {
  return {
    topic: "sensor_gr",
    payload: JSON.stringify({
      oven,
      cycle: 87,
      startoven: values.startOven,
      time_stamp: new Date(timestampMs).toISOString(),
      roomtemp: values.room,
      humanity: values.humidity,
      oventemp: values.furnace ?? null,
      blower: values.blower ?? null,
      page: 1,
    }),
    factoryMqtt: {
      receivedAt: new Date(timestampMs).toISOString(),
      route: { companyId: "gr", messageType: "sensor" },
      qos: 1,
      retain: false,
      duplicate: false,
    },
  };
}

try {
  const globalStore = new RuntimeStore();
  const runner = await createLegacyFunctionRunner({
    filename: resolve(
      process.cwd(),
      "backend/src/legacy-functions/factory-mqtt-adapter.js",
    ),
    scope: "sensor-filter-test",
    globalStore,
    contextStore: new RuntimeStore(),
  });
  const base = Date.now() - 3_000;

  const normal = await runner(
    message(
      { room: 50, humidity: 55, furnace: 300, blower: 180 },
      base,
    ),
  );
  assert(normal?._mqttEnvelope?.type === "sensor", "Normal reading was not accepted");
  assert(normal._mqttEnvelope.readings.length === 4, "Normal reading is incomplete");

  const grOptionalSensors = await runner(
    grMessage(
      { startOven: 0, room: 40.8, humidity: 53.2 },
      base + 500,
    ),
  );
  assert(
    grOptionalSensors?._mqttEnvelope?.type === "sensor",
    "GR chamber/humidity packet was incorrectly marked incomplete",
  );
  assert(
    grOptionalSensors._mqttEnvelope.readings.length === 2 &&
      grOptionalSensors._mqttEnvelope.missingRequiredSensors.length === 0,
    "GR optional furnace/blower handling is incorrect",
  );

  const grBasicProfile = await runner(
    grMessage(
      { startOven: 0, room: 42.1, humidity: 51.3, furnace: "000", blower: "000" },
      base + 550,
      11,
    ),
  );
  assert(
    grBasicProfile?._mqttEnvelope?.readings.length === 2 &&
      grBasicProfile._mqttEnvelope.readings.every(
        (item) => item.sensorKey === "chamberTemp" || item.sensorKey === "humidity",
      ),
    "GR ovens 11-17 must ignore unsupported zero placeholders",
  );

  const grFurnaceProfile = await runner(
    grMessage(
      { startOven: 0, room: 43.1, humidity: 50.3, furnace: 277, blower: "000" },
      base + 600,
      18,
    ),
  );
  assert(
    grFurnaceProfile?._mqttEnvelope?.readings.length === 3 &&
      grFurnaceProfile._mqttEnvelope.readings.some(
        (item) => item.sensorKey === "furnaceTemp" && item.value === 277,
      ) &&
      !grFurnaceProfile._mqttEnvelope.readings.some(
        (item) => item.sensorKey === "blowerTemp",
      ),
    "GR oven 18 must accept furnace and ignore unsupported blower",
  );

  const grFullProfile = await runner(
    grMessage(
      { startOven: 0, room: 44.1, humidity: 49.3, furnace: 288, blower: 155 },
      base + 650,
      19,
    ),
  );
  assert(
    grFullProfile?._mqttEnvelope?.readings.length === 4,
    "GR ovens 19-26 must require and accept all four readings",
  );

  process.env.STCR_FACTORY_MQTT_REQUIRED_SENSORS_JSON = JSON.stringify({
    ttn: ["chamberTemp", "humidity", "furnaceTemp", "blowerTemp"],
  });
  const grProfileWithTtnOnlyOverride = await runner(
    grMessage(
      { startOven: 0, room: 44.2, humidity: 49.2, furnace: 289, blower: 156 },
      base + 700,
      19,
    ),
  );
  assert(
    grProfileWithTtnOnlyOverride?._mqttEnvelope?.readings.length === 4,
    "A TTN-only override must not downgrade the GR per-oven profile",
  );

  const grInvalidState = await runner(
    grMessage(
      { startOven: 85, room: 0.21, humidity: 0.02, furnace: 1 },
      base + 750,
    ),
  );
  assert(
    !grInvalidState?._mqttEnvelope && grInvalidState?.payload?.status === "rejected",
    "Malformed GR startoven value was not rejected",
  );

  const impossible = await runner(
    message(
      { room: 51, humidity: 55, furnace: 1372, blower: 181 },
      base + 1_000,
    ),
  );
  assert(impossible?._mqttEnvelope?.type === "pending", "Hard-range error was not quarantined");
  assert(
    impossible._mqttEnvelope.invalidSensors.some(
      (item) =>
        item.sensorKey === "furnaceTemp" &&
        item.reason === "outside-physical-range",
    ),
    "Hard-range error was not identified",
  );
  assert(
    !impossible._mqttEnvelope.readings.some(
      (item) => item.sensorKey === "furnaceTemp",
    ),
    "Hard-range error leaked into accepted readings",
  );

  const spike = await runner(
    message(
      { room: 90, humidity: 56, furnace: 301, blower: 182 },
      base + 2_000,
    ),
  );
  assert(spike?._mqttEnvelope?.type === "pending", "Single spike was not quarantined");
  assert(
    spike._mqttEnvelope.suspectSensors.some(
      (item) => item.sensorKey === "chamberTemp",
    ),
    "Single spike was not identified",
  );
  assert(
    !spike._mqttEnvelope.readings.some(
      (item) => item.sensorKey === "chamberTemp",
    ),
    "Single spike leaked into accepted readings",
  );

  const confirmed = await runner(
    message(
      { room: 91, humidity: 57, furnace: 302, blower: 183 },
      base + 3_000,
    ),
  );
  assert(
    confirmed?._mqttEnvelope?.readings.some(
      (item) => item.sensorKey === "chamberTemp" && item.value === 91,
    ),
    "Repeated changed value was not accepted",
  );
  assert(
    confirmed._mqttEnvelope.confirmedSensors.some(
      (item) => item.sensorKey === "chamberTemp",
    ),
    "Confirmed changed value was not labelled",
  );

  console.log("Sensor profile, hard-range and spike-confirmation tests passed");
} finally {
  const restore = (name, value) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  restore("STCR_DEPLOYMENT_MODE", savedEnvironment.deploymentMode);
  restore("STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON", savedEnvironment.routes);
  restore("STCR_FACTORY_MQTT_OVEN_MAPS_JSON", savedEnvironment.maps);
  restore("STCR_FACTORY_MQTT_SENSOR_RANGES_JSON", savedEnvironment.ranges);
  restore("STCR_FACTORY_MQTT_SPIKE_LIMITS_JSON", savedEnvironment.spikes);
  restore("STCR_FACTORY_MQTT_REQUIRED_SENSORS_JSON", savedEnvironment.requiredSensors);
  restore(
    "STCR_FACTORY_MQTT_SOURCE_UTC_OFFSET_MINUTES",
    savedEnvironment.offset,
  );
}
