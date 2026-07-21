import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const flows = JSON.parse(await readFile(join(root, "flows.json"), "utf8"));
const buildSource = await readFile(join(root, "build-flow.mjs"), "utf8");
const adapterSource = await readFile(join(root, "functions", "factory-mqtt-adapter.js"), "utf8");
const subscriberSource = await readFile(join(root, "functions", "factory-mqtt-subscriber-init.js"), "utf8");
const routerSource = await readFile(join(root, "functions", "api-router.js"), "utf8");
const schemaSource = await readFile(join(root, "..", "database", "schema.sql"), "utf8");

const tabs = flows.filter((node) => node.type === "tab");
assert.deepEqual(tabs.map((tab) => tab.label), [
  "01 ฐานข้อมูลและ API",
  "02 รับข้อมูล MQTT โรงงาน",
]);
assert.doesNotMatch(JSON.stringify(flows), /simulation|simulator|mock|ข้อมูลจำลอง|ข้อมูลสมมุติ/i);
assert.doesNotMatch(buildSource, /simulation|simulator|mock|ข้อมูลจำลอง|ข้อมูลสมมุติ/i);

const requiredPaths = [
  "/stcr/api/health",
  "/stcr/api/auth/login",
  "/stcr/api/auth/logout",
  "/stcr/api/telemetry",
  "/stcr/api/factory-mqtt/raw",
  "/stcr/api/ovens",
  "/stcr/api/ovens/:ovenId/history",
  "/stcr/api/ovens/:ovenId/cycles/:cycleNumber/report-meta",
  "/stcr/api/alarms",
];
for (const path of requiredPaths) {
  assert.ok(flows.some((node) => node.type === "http in" && node.url === path), `Missing route ${path}`);
}

const subscriber = flows.find((node) => node.id === "stcr-factory-mqtt-subscriber");
assert.ok(subscriber);
assert.equal(subscriber.libs?.[0]?.module, "mqtt");
assert.match(subscriber.initialize, /STCR_FACTORY_MQTT_PASSWORD/);
assert.match(subscriber.initialize, /client\.subscribe/);
assert.doesNotMatch(JSON.stringify(subscriber), /mqtt:\/\/\d{1,3}(?:\.\d{1,3}){3}/);
assert.match(subscriberSource, /STCR_FACTORY_MQTT_ENABLED/);
assert.match(subscriberSource, /deploymentMode === "production"/);

const adapterNode = { status: () => undefined };
const runAdapter = new Function("msg", "env", "node", "Buffer", adapterSource);
const sampleTimestamp = new Date().toISOString();
const sample = {
  topic: "sensor",
  payload: JSON.stringify({
    startoven: 1,
    oven: 3,
    cycle: 116,
    oventemp: 424,
    blower: 201,
    roomtemp: 59.45,
    humanity: 46.48,
    page: 1,
    time_stamp: sampleTimestamp,
  }),
  factoryMqtt: { qos: 1, retain: false, duplicate: false, receivedAt: sampleTimestamp },
};
const values = {
  STCR_FACTORY_MQTT_COMPANY_ID: "ttn",
  STCR_FACTORY_MQTT_FORWARD_ENABLED: "false",
  STCR_FACTORY_MQTT_OVEN_MAP_JSON: '{"1":"oven-1","2":"oven-2","3":"oven-3","4":"oven-4","5":"oven-5","6":"oven-6","7":"oven-7","8":"oven-8","9":"oven-9"}',
  STCR_FACTORY_MQTT_SOURCE_UTC_OFFSET_MINUTES: "0",
  STCR_DEPLOYMENT_MODE: "production",
  STCR_TTN_INGEST_API_KEY: `stcr_ttn_${"a".repeat(32)}`,
  STCR_INGEST_URL: "http://127.0.0.1:1880/stcr/api/telemetry",
};
const env = { get: (key) => values[key] };

const [disabledForward, inspected] = runAdapter(structuredClone(sample), env, adapterNode, Buffer);
assert.equal(disabledForward, null);
assert.equal(inspected.payload.status, "validated");
assert.equal(inspected.payload.pageUsed, false);
assert.deepEqual(
  inspected.payload.normalizedPayload.readings.map(({ sensorKey, value }) => [sensorKey, value]),
  [["chamberTemp", 59.45], ["humidity", 46.48], ["furnaceTemp", 424], ["blowerTemp", 201]],
);

values.STCR_FACTORY_MQTT_FORWARD_ENABLED = "true";
const [forwarded] = runAdapter(structuredClone(sample), env, adapterNode, Buffer);
assert.equal(forwarded.length, 2);
assert.match(forwarded[0].url, /\/factory-mqtt\/raw$/);
assert.match(forwarded[1].url, /\/telemetry$/);
assert.equal(forwarded[1].payload.companyId, "ttn");
assert.equal(forwarded[1].payload.ovenId, "oven-3");

const [missingRaw, missing] = runAdapter({
  ...structuredClone(sample),
  payload: JSON.stringify({ ...JSON.parse(sample.payload), blower: null }),
}, env, adapterNode, Buffer);
assert.equal(missing.payload.status, "pending");
assert.deepEqual(missing.payload.missingSensors, ["blowerTemp"]);
assert.equal(missingRaw.payload.payload.blower, null);

const [statusRaw, status] = runAdapter({
  topic: "test",
  payload: JSON.stringify({ oven: 3, cycle: 116, oven_state: 1, time_stamp: sampleTimestamp }),
  factoryMqtt: sample.factoryMqtt,
}, env, adapterNode, Buffer);
assert.equal(status.payload.status, "validated");
assert.equal(status.payload.ovenState, 1);
assert.equal(statusRaw.payload.normalizationStatus, "received");

values.STCR_FACTORY_MQTT_SOURCE_UTC_OFFSET_MINUTES = "420";
const [, corrected] = runAdapter({
  ...structuredClone(sample),
  payload: JSON.stringify({ ...JSON.parse(sample.payload), time_stamp: "2026-07-21T10:30:00.000Z" }),
}, env, adapterNode, Buffer);
assert.equal(corrected.payload.normalizedSourceTimestamp, "2026-07-21T03:30:00.000Z");

values.STCR_FACTORY_MQTT_OVEN_MAP_JSON = '{"1":"oven-1"}';
const [unmappedRaw, unmapped] = runAdapter(structuredClone(sample), env, adapterNode, Buffer);
assert.equal(unmappedRaw, null);
assert.equal(unmapped.payload.status, "pending");

for (const table of [
  "companies", "ovens", "oven_cycles", "sensor_readings", "telemetry_events",
  "factory_mqtt_messages", "alarms", "users", "sessions", "api_keys", "audit_events",
]) {
  assert.match(schemaSource, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
}
assert.match(routerSource, /timingSafeEqual/);
assert.match(routerSource, /INVALID_API_KEY/);
assert.match(routerSource, /Origin is not allowed/);
assert.match(routerSource, /HISTORY_DATABASE_UNAVAILABLE/);
assert.match(routerSource, /companyId/);

console.log("Node-RED production flow validation passed.");
