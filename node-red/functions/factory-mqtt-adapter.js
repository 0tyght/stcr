// factory-mqtt-adapter.js
// Validate and normalize factory MQTT messages.
// Every valid sensor value is forwarded immediately for realtime display.
// Minute aggregation and database persistence are handled by the DB writer.

if (msg._minuteFlushTick) {
  msg.topic = "stcr/factory-mqtt/minute-flush";
  msg.payload = {
    status: "flush",
    detail: "Flush completed minute buckets",
    receivedAt:
      msg.factoryMqtt?.receivedAt || new Date().toISOString(),
  };
  return msg;
}

const allowedTopics = new Set(["test", "sensor"]);
const companyId = String(
  env.get("STCR_FACTORY_MQTT_COMPANY_ID") || "",
).trim().toLowerCase();
const deploymentMode = String(
  env.get("STCR_DEPLOYMENT_MODE") || "development",
).toLowerCase();
const sourceTopic = String(msg.topic || "").trim();
const receivedAt =
  msg.factoryMqtt?.receivedAt || new Date().toISOString();
const sourceUtcOffsetMinutes = Number(
  env.get("STCR_FACTORY_MQTT_SOURCE_UTC_OFFSET_MINUTES") || 0,
);

function inspection(status, detail, extra = {}) {
  msg.topic = `stcr/factory-mqtt/${status}`;
  msg.payload = {
    status,
    detail,
    sourceTopic,
    companyId: companyId || null,
    receivedAt,
    ...extra,
  };

  return msg;
}

function reject(detail, extra = {}) {
  delete msg._mqttEnvelope;
  return inspection("rejected", detail, extra);
}

if (!["gr", "ttn"].includes(companyId)) {
  node.status({
    fill: "red",
    shape: "ring",
    text: "company mapping missing",
  });
  return reject("STCR_FACTORY_MQTT_COMPANY_ID is missing");
}

if (!allowedTopics.has(sourceTopic)) {
  node.status({
    fill: "yellow",
    shape: "ring",
    text: "unknown MQTT topic",
  });
  return reject("Unknown MQTT topic");
}

const rawText = Buffer.isBuffer(msg.payload)
  ? msg.payload.toString("utf8")
  : String(msg.payload || "");

if (!rawText || Buffer.byteLength(rawText, "utf8") > 8192) {
  return reject("MQTT payload is empty or too large");
}

let source;
try {
  source = JSON.parse(rawText);
} catch {
  node.status({
    fill: "yellow",
    shape: "ring",
    text: "invalid MQTT JSON",
  });
  return reject("MQTT payload is not valid JSON");
}

const ovenNumber = Number(source.oven);
const cycleNumber = Number(source.cycle);
const rawSourceTimestampMs = Date.parse(source.time_stamp);
const validSourceOffset =
  Number.isInteger(sourceUtcOffsetMinutes) &&
  Math.abs(sourceUtcOffsetMinutes) <= 840;
const sourceTimestampMs =
  rawSourceTimestampMs - sourceUtcOffsetMinutes * 60 * 1000;

if (
  !Number.isSafeInteger(ovenNumber) ||
  ovenNumber < 1 ||
  ovenNumber > 10000 ||
  !Number.isSafeInteger(cycleNumber) ||
  cycleNumber < 0 ||
  cycleNumber > 1000000 ||
  !Number.isFinite(rawSourceTimestampMs) ||
  !validSourceOffset
) {
  node.status({
    fill: "yellow",
    shape: "ring",
    text: "invalid MQTT identity",
  });
  return reject("Invalid oven, cycle, or timestamp", {
    rawPayload: source,
  });
}

let ovenMap = {};
try {
  ovenMap = JSON.parse(
    String(env.get("STCR_FACTORY_MQTT_OVEN_MAP_JSON") || "{}"),
  );
} catch {
  return reject("STCR_FACTORY_MQTT_OVEN_MAP_JSON is invalid JSON");
}

const explicitOvenId =
  typeof ovenMap[String(ovenNumber)] === "string"
    ? ovenMap[String(ovenNumber)].trim()
    : "";
const ovenId =
  explicitOvenId ||
  (deploymentMode === "production" ? "" : `oven-${ovenNumber}`);

if (
  !ovenId ||
  ovenId.length > 64 ||
  /[\u0000-\u001f\u007f]/.test(ovenId)
) {
  node.status({
    fill: "red",
    shape: "ring",
    text: `oven ${ovenNumber} unmapped`,
  });
  delete msg._mqttEnvelope;
  return inspection("pending", "Oven mapping is required", {
    ovenNumber,
    cycleNumber,
    rawPayload: source,
  });
}

const sourceTimestamp = new Date(sourceTimestampMs).toISOString();
const commonEnvelope = {
  companyId,
  ovenId,
  ovenNumber,
  cycleNumber,
  topic: sourceTopic,
  qos: Number(msg.factoryMqtt?.qos ?? 0),
  retained: Boolean(msg.factoryMqtt?.retain),
  duplicateDelivery: Boolean(msg.factoryMqtt?.duplicate),
  sourceTimestamp,
  receivedAt,
  source,
};

if (sourceTopic === "test") {
  const ovenState = Number(source.oven_state);
  if (![0, 1].includes(ovenState)) {
    node.status({
      fill: "yellow",
      shape: "ring",
      text: `oven ${ovenNumber} bad state`,
    });
    return reject("oven_state must be 0 or 1", {
      ovenNumber,
      ovenId,
      cycleNumber,
      rawPayload: source,
    });
  }

  msg._mqttEnvelope = {
    ...commonEnvelope,
    type: "test",
    ovenState,
  };

  node.status({
    fill: "blue",
    shape: "dot",
    text: `status oven ${ovenNumber}`,
  });

  return inspection(
    "validated",
    "oven_state accepted (0=closed, 1=open)",
    {
      ovenNumber,
      ovenId,
      cycleNumber,
      ovenState,
      rawPayload: source,
    },
  );
}

const startOven = Number(source.startoven);
if (![0, 1].includes(startOven)) {
  return reject("startoven must be 0 or 1", {
    ovenNumber,
    ovenId,
    cycleNumber,
    rawPayload: source,
  });
}

const definitions = [
  ["chamberTemp", "roomtemp", "C"],
  ["humidity", "humanity", "%"],
  ["furnaceTemp", "oventemp", "C"],
  ["blowerTemp", "blower", "C"],
];

const now = Date.now();
const stale = now - sourceTimestampMs > 2 * 60 * 1000;
const future = sourceTimestampMs - now > 30 * 1000;
const qualityReasons = [
  ...(stale ? ["stale"] : []),
  ...(future ? ["future-timestamp"] : []),
];
const quality = qualityReasons.length ? "suspect" : "good";
const sequence = sourceTimestampMs;

const readings = [];
const missingSensors = [];
for (const [sensorKey, sourceKey, unit] of definitions) {
  const rawValue = source[sourceKey];
  const numericValue = Number(rawValue);
  const missing =
    rawValue === null ||
    rawValue === undefined ||
    rawValue === "" ||
    !Number.isFinite(numericValue);

  if (missing) {
    missingSensors.push(sensorKey);
    continue;
  }

  readings.push({
    sensorKey,
    sensorId: `factory-${companyId}-${ovenId}-${sensorKey}`,
    sequence,
    value: numericValue,
    rawValue: numericValue,
    unit,
    quality,
    qualityReasons,
    sourceTimestamp,
  });
}

const batchId = `mqtt-${ovenNumber}-${cycleNumber}-${sourceTimestampMs}`;
const deviceId = `factory-${companyId}-oven-${ovenNumber}`;
const incomplete = missingSensors.length > 0;

msg._mqttEnvelope = {
  ...commonEnvelope,
  type: incomplete ? "pending" : "sensor",
  startOven,
  quality,
  qualityReasons,
  readings,
  missingSensors,
  batchId,
  deviceId,
};

node.status({
  fill: incomplete ? "yellow" : "green",
  shape: incomplete ? "ring" : "dot",
  text: incomplete
    ? `${missingSensors.join(", ")} missing`
    : `normalized oven ${ovenNumber}`,
});

return inspection(
  incomplete ? "pending" : "validated",
  incomplete
    ? "Available sensor values accepted; missing values ignored"
    : "Sensor data normalized for realtime display and minute aggregation",
  {
    ovenNumber,
    ovenId,
    cycleNumber,
    startOven,
    page: source.page,
    pageUsed: false,
    missingSensors,
    originalSourceTimestamp: source.time_stamp,
    normalizedSourceTimestamp: sourceTimestamp,
    normalizedPayload: {
      companyId,
      ovenId,
      batchId,
      deviceId,
      readings,
    },
    rawPayload: source,
  },
);
