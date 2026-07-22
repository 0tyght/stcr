import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const requiredEnvironment = ["STCR_DB_PASSWORD"];
for (const name of requiredEnvironment) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const databaseOptions = {
  host: process.env.STCR_DB_HOST || "127.0.0.1",
  port: Number(process.env.STCR_DB_PORT || 3306),
  user: process.env.STCR_DB_USER || "stcr_app",
  password: process.env.STCR_DB_PASSWORD,
  database: process.env.STCR_DB_NAME || "stcr",
  timezone: "Z",
};

const qaOvenId = "__qa_mqtt_lifecycle__";
const qaOvenNumber = 9999;
const qaCycleNumber = 900001;
const contextValues = new Map();
const runtimeGlobal = {
  get: (key) => contextValues.get(key),
  set: (key, value) => contextValues.set(key, value),
};
const environment = new Map([
  ["STCR_DB_HOST", databaseOptions.host],
  ["STCR_DB_PORT", String(databaseOptions.port)],
  ["STCR_DB_USER", databaseOptions.user],
  ["STCR_DB_PASSWORD", databaseOptions.password],
  ["STCR_DB_NAME", databaseOptions.database],
  ["STCR_FACTORY_MQTT_HEARTBEAT_SECONDS", "10"],
  ["STCR_FACTORY_MQTT_MINUTE_FLUSH_GRACE_MS", "0"],
  ["STCR_FACTORY_MQTT_STORE_RAW_MESSAGES", "false"],
]);
const env = { get: (key) => environment.get(key) };
const node = {
  status: () => {},
  warn: (message) => {
    throw new Error(String(message));
  },
};

const writerSource = await readFile(
  new URL("../node-red/functions/factory-mqtt-db-writer.js", import.meta.url),
  "utf8",
);
const runWriter = new Function(
  "msg",
  "env",
  "global",
  "node",
  "mysql",
  "crypto",
  "Buffer",
  `return (async () => { ${writerSource}\n})();`,
);

const admin = await mysql.createConnection(databaseOptions);
const minuteAt = new Date();
minuteAt.setUTCSeconds(0, 0);

function envelope(startOven, timestamp) {
  const readings = [
    ["chamberTemp", 50, "C"],
    ["humidity", 60, "%"],
    ["furnaceTemp", 500, "C"],
    ["blowerTemp", 360, "C"],
  ].map(([sensorKey, value, unit]) => ({ sensorKey, value, unit }));

  return {
    companyId: "ttn",
    ovenId: qaOvenId,
    ovenNumber: qaOvenNumber,
    cycleNumber: qaCycleNumber,
    type: "sensor",
    startOven,
    readings,
    quality: "good",
    sourceTimestamp: timestamp.toISOString(),
    receivedAt: timestamp.toISOString(),
    topic: "sensor",
    source: { qa: true },
  };
}

async function invoke(message) {
  await runWriter(message, env, runtimeGlobal, node, mysql, crypto, Buffer);
}

async function cleanup() {
  const writerPool = contextValues.get("stcrMqttDbPool");
  if (writerPool) await writerPool.end();
  await admin.execute(
    "DELETE FROM sensor_readings WHERE company_id='ttn' AND oven_id=?",
    [qaOvenId],
  );
  await admin.execute(
    "DELETE FROM sensor_minute_aggregates WHERE company_id='ttn' AND oven_id=?",
    [qaOvenId],
  );
  await admin.execute(
    "DELETE FROM oven_cycles WHERE company_id='ttn' AND oven_id=?",
    [qaOvenId],
  );
  await admin.execute(
    "DELETE FROM ovens WHERE company_id='ttn' AND id=?",
    [qaOvenId],
  );
  await admin.end();
}

try {
  await admin.execute(
    `INSERT INTO ovens (
       id, company_id, oven_number, name, zone_name, line_name,
       status, enabled, chamber_lower, chamber_upper,
       furnace_lower, furnace_upper, blower_lower, blower_upper,
       humidity_lower, humidity_upper
     ) VALUES (?, 'ttn', ?, 'QA lifecycle', 'QA', 'QA',
       'offline', TRUE, 35, 60, 450, 550, 330, 400, 45, 85)`,
    [qaOvenId, qaOvenNumber],
  );

  runtimeGlobal.set("stcrState", {
    companies: {
      ttn: {
        ovens: [{ id: qaOvenId, status: "offline", readings: {} }],
        history: { [qaOvenId]: [] },
      },
    },
  });

  await invoke({ _mqttEnvelope: envelope(1, minuteAt) });
  await invoke({
    _minuteFlushTick: true,
    factoryMqtt: {
      receivedAt: new Date(minuteAt.getTime() + 61_000).toISOString(),
    },
  });

  const [recordingRows] = await admin.execute(
    `SELECT state, report_started_at AS reportStartedAt
     FROM oven_cycles
     WHERE company_id='ttn' AND oven_id=? AND cycle_number=?`,
    [qaOvenId, qaCycleNumber],
  );
  if (recordingRows[0]?.state !== "recording" || !recordingRows[0]?.reportStartedAt) {
    throw new Error("Cycle did not transition from ignition to recording");
  }

  const stopMinute = new Date(minuteAt.getTime() + 60_000);
  await invoke({ _mqttEnvelope: envelope(0, stopMinute) });
  await invoke({
    _minuteFlushTick: true,
    factoryMqtt: {
      receivedAt: new Date(stopMinute.getTime() + 61_000).toISOString(),
    },
  });

  const [completedRows] = await admin.execute(
    `SELECT state, stopped_at AS stoppedAt
     FROM oven_cycles
     WHERE company_id='ttn' AND oven_id=? AND cycle_number=?`,
    [qaOvenId, qaCycleNumber],
  );
  if (completedRows[0]?.state !== "completed" || !completedRows[0]?.stoppedAt) {
    throw new Error("Cycle did not transition from recording to completed");
  }

  console.log("MQTT lifecycle integration test passed.");
} finally {
  await cleanup();
}
