// factory-mqtt-adapter.js
// Validate and normalize factory MQTT messages.
// The database write is handled by factory-mqtt-db-writer.js.

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
  // IMPORTANT:
  // Return the original msg so _mqttEnvelope reaches the DB writer node.
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
  return reject(
    "STCR_FACTORY_MQTT_OVEN_MAP_JSON is invalid JSON",
  );
}

const explicitOvenId =
  typeof ovenMap[String(ovenNumber)] === "string"
    ? ovenMap[String(ovenNumber)].trim()
    : "";

const ovenId =
  explicitOvenId ||
  (deploymentMode === "production"
    ? ""
    : `oven-${ovenNumber}`);

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

  return inspection(
    "pending",
    "Oven mapping is required",
    {
      ovenNumber,
      cycleNumber,
      rawPayload: source,
    },
  );
}

const sourceTimestamp =
  new Date(sourceTimestampMs).toISOString();

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

// Topic: test
if (sourceTopic === "test") {
  const ovenState = Number(source.oven_state);

  if (![0, 1].includes(ovenState)) {
    node.status({
      fill: "yellow",
      shape: "ring",
      text: `oven ${ovenNumber} bad state`,
    });

    return reject(
      "oven_state must be 0 or 1",
      {
        ovenNumber,
        ovenId,
        cycleNumber,
        rawPayload: source,
      },
    );
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

// Topic: sensor
const startOven = Number(source.startoven);

if (![0, 1].includes(startOven)) {
  return reject(
    "startoven must be 0 or 1",
    {
      ovenNumber,
      ovenId,
      cycleNumber,
      rawPayload: source,
    },
  );
}

const definitions = [
  ["chamberTemp", "roomtemp", "C"],
  ["humidity", "humanity", "%"],
  ["furnaceTemp", "oventemp", "C"],
  ["blowerTemp", "blower", "C"],
];

const missingSensors = definitions
  .filter(([, sourceKey]) => {
    const value = source[sourceKey];

    return (
      value === null ||
      value === undefined ||
      value === "" ||
      !Number.isFinite(Number(value))
    );
  })
  .map(([sensorKey]) => sensorKey);

if (missingSensors.length) {
  msg._mqttEnvelope = {
    ...commonEnvelope,
    type: "pending",
    startOven,
    missingSensors,
  };

  node.status({
    fill: "yellow",
    shape: "ring",
    text: `${missingSensors.join(", ")} missing`,
  });

  return inspection(
    "pending",
    "Sensor values are incomplete",
    {
      ovenNumber,
      ovenId,
      cycleNumber,
      startOven,
      missingSensors,
      rawPayload: source,
    },
  );
}

const now = Date.now();
const stale =
  now - sourceTimestampMs > 2 * 60 * 1000;
const future =
  sourceTimestampMs - now > 30 * 1000;

const qualityReasons = [
  ...(stale ? ["stale"] : []),
  ...(future ? ["future-timestamp"] : []),
];

const quality =
  qualityReasons.length ? "suspect" : "good";
const sequence = sourceTimestampMs;

const readings = definitions.map(
  ([sensorKey, sourceKey, unit]) => ({
    sensorKey,
    sensorId:
      `factory-${companyId}-${ovenId}-${sensorKey}`,
    sequence,
    value: Number(source[sourceKey]),
    rawValue: Number(source[sourceKey]),
    unit,
    quality,
    qualityReasons,
    sourceTimestamp,
  }),
);

const batchId =
  `mqtt-${ovenNumber}-${cycleNumber}-${sourceTimestampMs}`;
const deviceId =
  `factory-${companyId}-oven-${ovenNumber}`;

msg._mqttEnvelope = {
  ...commonEnvelope,
  type: "sensor",
  startOven,
  quality,
  qualityReasons,
  readings,
  batchId,
  deviceId,
};

node.status({
  fill: "green",
  shape: "dot",
  text: `normalized oven ${ovenNumber}`,
});

return inspection(
  "validated",
  "Sensor data normalized; queued for database write",
  {
    ovenNumber,
    ovenId,
    cycleNumber,
    startOven,
    page: source.page,
    pageUsed: false,
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
