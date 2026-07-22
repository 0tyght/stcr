import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

const flows = JSON.parse(
  await readFile(join(root, "flows.json"), "utf8"),
);
const buildSource = await readFile(
  join(root, "build-flow.mjs"),
  "utf8",
);
const adapterSource = await readFile(
  join(root, "functions", "factory-mqtt-adapter.js"),
  "utf8",
);
const dbWriterSource = await readFile(
  join(root, "functions", "factory-mqtt-db-writer.js"),
  "utf8",
);
const subscriberSource = await readFile(
  join(
    root,
    "functions",
    "factory-mqtt-subscriber-init.js",
  ),
  "utf8",
);
const routerSource = await readFile(
  join(root, "functions", "api-router.js"),
  "utf8",
);
const schemaSource = await readFile(
  join(root, "..", "database", "schema.sql"),
  "utf8",
);

const tabs = flows.filter(
  (node) => node.type === "tab",
);

assert.deepEqual(
  tabs.map((tab) => tab.label),
  [
    "01 ฐานข้อมูลและ API",
    "02 รับข้อมูล MQTT โรงงาน",
  ],
);

assert.doesNotMatch(
  JSON.stringify(flows),
  /simulation|simulator|mock|ข้อมูลจำลอง|ข้อมูลสมมุติ/i,
);
assert.doesNotMatch(
  buildSource,
  /simulation|simulator|mock|ข้อมูลจำลอง|ข้อมูลสมมุติ/i,
);

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
  assert.ok(
    flows.some(
      (node) =>
        node.type === "http in" &&
        node.url === path,
    ),
    `Missing route ${path}`,
  );
}

const subscriber = flows.find(
  (node) =>
    node.id === "stcr-factory-mqtt-subscriber",
);

assert.ok(subscriber);
assert.equal(
  subscriber.libs?.[0]?.module,
  "mqtt",
);
assert.match(
  subscriber.initialize,
  /STCR_FACTORY_MQTT_PASSWORD/,
);
assert.match(
  subscriber.initialize,
  /client\.subscribe/,
);
assert.doesNotMatch(
  JSON.stringify(subscriber),
  /mqtt:\/\/\d{1,3}(?:\.\d{1,3}){3}/,
);
assert.match(
  subscriberSource,
  /STCR_FACTORY_MQTT_ENABLED/,
);
assert.match(
  subscriberSource,
  /deploymentMode === "production"/,
);
assert.match(subscriberSource, /STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON/);

const adapterNode = {
  status: () => undefined,
};

const runAdapter = new Function(
  "msg",
  "env",
  "node",
  "Buffer",
  adapterSource,
);

const sampleTimestamp =
  new Date().toISOString();

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
  factoryMqtt: {
    qos: 1,
    retain: false,
    duplicate: false,
    receivedAt: sampleTimestamp,
  },
};

const values = {
  STCR_FACTORY_MQTT_COMPANY_ID: "ttn",
  STCR_FACTORY_MQTT_OVEN_MAP_JSON:
    '{"1":"oven-1","2":"oven-2","3":"oven-3","4":"oven-4","5":"oven-5","6":"oven-6","7":"oven-7","8":"oven-8","9":"oven-9"}',
  STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON:
    '{"test":{"companyId":"ttn","messageType":"status"},"sensor":{"companyId":"ttn","messageType":"sensor"},"status_gr":{"companyId":"gr","messageType":"status"},"sensor_gr":{"companyId":"gr","messageType":"sensor"}}',
  STCR_FACTORY_MQTT_OVEN_MAPS_JSON:
    '{"ttn":{"1":"oven-1","2":"oven-2","3":"oven-3","4":"oven-4","5":"oven-5","6":"oven-6","7":"oven-7","8":"oven-8","9":"oven-9"},"gr":{"11":"oven-11","12":"oven-12","13":"oven-13","14":"oven-14","15":"oven-15","16":"oven-16","17":"oven-17","18":"oven-18","19":"oven-19","20":"oven-20","21":"oven-21","22":"oven-22","23":"oven-23","24":"oven-24","25":"oven-25","26":"oven-26"}}',
  STCR_FACTORY_MQTT_SOURCE_UTC_OFFSET_MINUTES:
    "0",
  STCR_DEPLOYMENT_MODE: "production",
  STCR_TTN_INGEST_API_KEY:
    `stcr_ttn_${"a".repeat(32)}`,
};

const env = {
  get: (key) => values[key],
};

// Complete sensor:
// the returned message itself must carry _mqttEnvelope.
{
  const msg = structuredClone(sample);
  const inspected = runAdapter(
    msg,
    env,
    adapterNode,
    Buffer,
  );

  assert.equal(inspected, msg);
  assert.equal(
    inspected.payload.status,
    "validated",
  );
  assert.equal(
    inspected.payload.pageUsed,
    false,
  );
  assert.equal(
    inspected._mqttEnvelope.type,
    "sensor",
  );
  assert.equal(
    inspected._mqttEnvelope.ovenId,
    "oven-3",
  );
  assert.equal(
    inspected._mqttEnvelope.companyId,
    "ttn",
  );
  assert.deepEqual(
    inspected.payload.normalizedPayload.readings.map(
      ({ sensorKey, value }) => [
        sensorKey,
        value,
      ],
    ),
    [
      ["chamberTemp", 59.45],
      ["humidity", 46.48],
      ["furnaceTemp", 424],
      ["blowerTemp", 201],
    ],
  );
}

// GR uses the same payload contract on separate topics.
{
  const msg = {
    ...structuredClone(sample),
    topic: "sensor_gr",
    payload: JSON.stringify({
      ...JSON.parse(sample.payload),
      oven: 11,
    }),
  };
  const inspected = runAdapter(msg, env, adapterNode, Buffer);
  assert.equal(inspected.payload.status, "validated");
  assert.equal(inspected._mqttEnvelope.companyId, "gr");
  assert.equal(inspected._mqttEnvelope.ovenId, "oven-11");
  assert.equal(inspected._mqttEnvelope.type, "sensor");
}

{
  const msg = {
    topic: "status_gr",
    payload: JSON.stringify({
      oven: 11,
      cycle: 1,
      oven_state: 1,
      time_stamp: sampleTimestamp,
    }),
    factoryMqtt: sample.factoryMqtt,
  };
  const inspected = runAdapter(msg, env, adapterNode, Buffer);
  assert.equal(inspected.payload.status, "validated");
  assert.equal(inspected._mqttEnvelope.companyId, "gr");
  assert.equal(inspected._mqttEnvelope.type, "test");
}

// Incomplete sensor:
// the returned message must still carry a pending envelope
// so DB writer can update last_seen_at.
{
  const msg = {
    ...structuredClone(sample),
    payload: JSON.stringify({
      ...JSON.parse(sample.payload),
      blower: null,
    }),
  };

  const missing = runAdapter(
    msg,
    env,
    adapterNode,
    Buffer,
  );

  assert.equal(missing, msg);
  assert.equal(
    missing.payload.status,
    "pending",
  );
  assert.deepEqual(
    missing.payload.missingSensors,
    ["blowerTemp"],
  );
  assert.equal(
    missing._mqttEnvelope.type,
    "pending",
  );
  assert.equal(
    missing._mqttEnvelope.startOven,
    1,
  );
  assert.deepEqual(
    missing._mqttEnvelope.readings.map(({ sensorKey }) => sensorKey),
    ["chamberTemp", "humidity", "furnaceTemp"],
  );
}

// Physically impossible values are quarantined, not normalized.
{
  const msg = {
    ...structuredClone(sample),
    payload: JSON.stringify({
      ...JSON.parse(sample.payload),
      oventemp: 1372,
    }),
  };
  const quarantined = runAdapter(msg, env, adapterNode, Buffer);
  assert.equal(quarantined.payload.status, "pending");
  assert.equal(quarantined._mqttEnvelope.quality, "suspect");
  assert.deepEqual(
    quarantined._mqttEnvelope.invalidSensors.map(({ sensorKey }) => sensorKey),
    ["furnaceTemp"],
  );
  assert.ok(
    !quarantined._mqttEnvelope.readings.some(({ sensorKey }) => sensorKey === "furnaceTemp"),
  );
}

// Minute flush ticks pass through the adapter without MQTT validation.
{
  const tick = {
    _minuteFlushTick: true,
    factoryMqtt: { receivedAt: sampleTimestamp },
  };
  const result = runAdapter(tick, env, adapterNode, Buffer);
  assert.equal(result, tick);
  assert.equal(result.payload.status, "flush");
}

// Status topic.
{
  const msg = {
    topic: "test",
    payload: JSON.stringify({
      oven: 3,
      cycle: 116,
      oven_state: 1,
      time_stamp: sampleTimestamp,
    }),
    factoryMqtt: sample.factoryMqtt,
  };

  const status = runAdapter(
    msg,
    env,
    adapterNode,
    Buffer,
  );

  assert.equal(status, msg);
  assert.equal(
    status.payload.status,
    "validated",
  );
  assert.equal(
    status.payload.ovenState,
    1,
  );
  assert.equal(
    status._mqttEnvelope.type,
    "test",
  );
  assert.equal(
    status._mqttEnvelope.ovenState,
    1,
  );
}

// UTC offset correction.
{
  values.STCR_FACTORY_MQTT_SOURCE_UTC_OFFSET_MINUTES =
    "420";

  const msg = {
    ...structuredClone(sample),
    payload: JSON.stringify({
      ...JSON.parse(sample.payload),
      time_stamp:
        "2026-07-21T10:30:00.000Z",
    }),
  };

  const corrected = runAdapter(
    msg,
    env,
    adapterNode,
    Buffer,
  );

  assert.equal(
    corrected.payload.normalizedSourceTimestamp,
    "2026-07-21T03:30:00.000Z",
  );

  values.STCR_FACTORY_MQTT_SOURCE_UTC_OFFSET_MINUTES =
    "0";
}

// Unmapped oven in production.
{
  const savedMaps = values.STCR_FACTORY_MQTT_OVEN_MAPS_JSON;

  values.STCR_FACTORY_MQTT_OVEN_MAPS_JSON =
    '{"ttn":{"1":"oven-1"},"gr":{"11":"oven-11"}}';

  const msg = structuredClone(sample);
  const unmapped = runAdapter(
    msg,
    env,
    adapterNode,
    Buffer,
  );

  assert.equal(
    unmapped.payload.status,
    "pending",
  );
  assert.equal(
    unmapped._mqttEnvelope,
    undefined,
  );

  values.STCR_FACTORY_MQTT_OVEN_MAPS_JSON = savedMaps;
}

assert.match(
  dbWriterSource,
  /envelope\.type === "pending"/,
);
assert.match(
  dbWriterSource,
  /last_seen_at/,
);
assert.match(
  dbWriterSource,
  /status = CASE/,
);
assert.match(
  dbWriterSource,
  /received_at\s*=\s*VALUES\(received_at\)/,
);
assert.doesNotMatch(
  dbWriterSource,
  /CURRENT_TIMESTAMP\(3\)/,
);

for (const table of [
  "schema_migrations",
  "companies",
  "ovens",
  "oven_cycles",
  "sensor_readings",
  "telemetry_events",
  "factory_mqtt_messages",
  "alarms",
  "users",
  "sessions",
  "api_keys",
  "audit_events",
]) {
  assert.match(
    schemaSource,
    new RegExp(
      `CREATE TABLE IF NOT EXISTS ${table}\\b`,
    ),
  );
}

assert.match(
  routerSource,
  /timingSafeEqual/,
);
assert.match(
  routerSource,
  /INVALID_API_KEY/,
);
assert.match(
  routerSource,
  /Origin is not allowed/,
);
assert.match(
  routerSource,
  /HISTORY_DATABASE_UNAVAILABLE/,
);
assert.match(
  routerSource,
  /companyId/,
);
assert.match(routerSource, /HTTP ingestion is disabled/);
assert.match(routerSource, /sessionAccountRecheckMs/);


assert.match(dbWriterSource, /sensor_minute_aggregates/);
assert.match(dbWriterSource, /chamber_temp_avg/);
assert.match(dbWriterSource, /heartbeatSeconds/);
assert.match(dbWriterSource, /STCR_FACTORY_MQTT_STORE_RAW_MESSAGES/);
assert.match(dbWriterSource, /duplicate-message/);
assert.match(dbWriterSource, /out-of-order-message/);
assert.match(adapterSource, /STCR_FACTORY_MQTT_SENSOR_RANGES_JSON/);
assert.match(routerSource, /sensor_minute_aggregates r/);
assert.match(dbWriterSource, /resolveCycleLifecycle/);
assert.match(dbWriterSource, /async function applyCycleLifecycle/);
assert.match(dbWriterSource, /VALUES \(\?, \?, \?, 'recording'/);
assert.match(dbWriterSource, /state = IF\(state = 'ignition', 'recording', state\)/);
assert.match(dbWriterSource, /report_started_at/);
assert.match(dbWriterSource, /ready_hold_seconds/);
assert.match(dbWriterSource, /state = 'completed'/);
assert.match(subscriberSource, /factoryMqttMinuteFlushTimer/);
assert.match(subscriberSource, /stcrMqttHealth/);
assert.match(routerSource, /mqttHealth/);
assert.match(routerSource, /INSERT INTO alarms/);
assert.match(routerSource, /severity='offline'/);
assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS sensor_minute_aggregates\b/);
assert.match(schemaSource, /\('oven-11', 'gr', 11/);
assert.match(schemaSource, /\('oven-26', 'gr', 26/);

console.log(
  "Node-RED production flow validation passed.",
);
