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

const deploymentMode = String(
  env.get("STCR_DEPLOYMENT_MODE") || "development",
).toLowerCase();
const sourceTopic = String(msg.topic || "").trim();
const receivedAt =
  msg.factoryMqtt?.receivedAt || new Date().toISOString();

function resolveTopicRoute() {
  const forwarded = msg.factoryMqtt?.route;
  if (forwarded && typeof forwarded === "object") {
    return {
      companyId: String(forwarded.companyId || "").trim().toLowerCase(),
      messageType: String(forwarded.messageType || "").trim().toLowerCase(),
    };
  }

  const rawRoutes = String(
    env.get("STCR_FACTORY_MQTT_TOPIC_ROUTES_JSON") || "",
  ).trim();
  if (rawRoutes) {
    const parsed = JSON.parse(rawRoutes);
    const route = parsed?.[sourceTopic];
    return {
      companyId: String(route?.companyId || "").trim().toLowerCase(),
      messageType: String(route?.messageType || "").trim().toLowerCase(),
    };
  }

  const legacyCompanyId = String(
    env.get("STCR_FACTORY_MQTT_COMPANY_ID") || "",
  ).trim().toLowerCase();
  return {
    companyId: legacyCompanyId,
    messageType: sourceTopic === "test" ? "status" : sourceTopic === "sensor" ? "sensor" : "",
  };
}

let topicRoute;
try {
  topicRoute = resolveTopicRoute();
} catch {
  topicRoute = null;
}
const companyId = topicRoute?.companyId || "";
const messageType = topicRoute?.messageType || "";
const sourceUtcOffsetMinutes = Number(
  env.get("STCR_FACTORY_MQTT_SOURCE_UTC_OFFSET_MINUTES") || 0,
);
const defaultSensorRanges = {
  chamberTemp: { min: 0, max: 150 },
  humidity: { min: 0, max: 100 },
  furnaceTemp: { min: 0, max: 1000 },
  blowerTemp: { min: 0, max: 600 },
};
const defaultSpikeLimits = {
  chamberTemp: 12,
  humidity: 20,
  furnaceTemp: 200,
  blowerTemp: 120,
};
const defaultRequiredSensors = {
  ttn: ["chamberTemp", "humidity", "furnaceTemp", "blowerTemp"],
  gr: ["chamberTemp", "humidity"],
};
const defaultRequiredSensorsByOven = {
  gr: {
    18: ["chamberTemp", "humidity", "furnaceTemp"],
    19: ["chamberTemp", "humidity", "furnaceTemp", "blowerTemp"],
    20: ["chamberTemp", "humidity", "furnaceTemp", "blowerTemp"],
    21: ["chamberTemp", "humidity", "furnaceTemp", "blowerTemp"],
    22: ["chamberTemp", "humidity", "furnaceTemp", "blowerTemp"],
    23: ["chamberTemp", "humidity", "furnaceTemp", "blowerTemp"],
    24: ["chamberTemp", "humidity", "furnaceTemp", "blowerTemp"],
    25: ["chamberTemp", "humidity", "furnaceTemp", "blowerTemp"],
    26: ["chamberTemp", "humidity", "furnaceTemp", "blowerTemp"],
  },
};
const plausibilityStateKey = "stcrSensorPlausibilityStateV1";

function readRequiredSensors() {
  const configured = String(
    env.get("STCR_FACTORY_MQTT_REQUIRED_SENSORS_JSON") || "",
  ).trim();
  if (!configured) {
    return (
      defaultRequiredSensorsByOven[companyId]?.[ovenNumber] ||
      defaultRequiredSensors[companyId]
    );
  }

  const parsed = JSON.parse(configured);
  const candidate = parsed?.[companyId];
  if (candidate === undefined) {
    return (
      defaultRequiredSensorsByOven[companyId]?.[ovenNumber] ||
      defaultRequiredSensors[companyId]
    );
  }
  const knownSensors = new Set(Object.keys(defaultSensorRanges));
  if (
    !Array.isArray(candidate) ||
    candidate.length < 1 ||
    candidate.some((sensorKey) => !knownSensors.has(sensorKey))
  ) {
    throw new Error(`Invalid required sensor profile for ${companyId}`);
  }
  return [...new Set(candidate)];
}

function readSensorRanges() {
  const configured = String(
    env.get("STCR_FACTORY_MQTT_SENSOR_RANGES_JSON") || "",
  ).trim();
  if (!configured) return defaultSensorRanges;

  const parsed = JSON.parse(configured);
  return Object.fromEntries(
    Object.keys(defaultSensorRanges).map((sensorKey) => {
      const candidate = parsed?.[sensorKey];
      const min = Number(candidate?.min);
      const max = Number(candidate?.max);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
        throw new Error(`Invalid range for ${sensorKey}`);
      }
      return [sensorKey, { min, max }];
    }),
  );
}

function readSpikeLimits() {
  const configured = String(
    env.get("STCR_FACTORY_MQTT_SPIKE_LIMITS_JSON") || "",
  ).trim();
  if (!configured) return defaultSpikeLimits;

  const parsed = JSON.parse(configured);
  return Object.fromEntries(
    Object.keys(defaultSpikeLimits).map((sensorKey) => {
      const limit = Number(parsed?.[sensorKey]);
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error(`Invalid spike limit for ${sensorKey}`);
      }
      return [sensorKey, limit];
    }),
  );
}

function inspectPlausibility(
  sensorKey,
  value,
  sourceTimestampMs,
  spikeLimits,
) {
  const allStates = global.get(plausibilityStateKey) || {};
  const stateKey = `${companyId}|${ovenId}|${sensorKey}`;
  const state = allStates[stateKey];

  if (
    !state ||
    !Number.isFinite(Number(state.lastGoodValue)) ||
    !Number.isFinite(Number(state.lastGoodAt))
  ) {
    allStates[stateKey] = {
      lastGoodValue: value,
      lastGoodAt: sourceTimestampMs,
      candidateValue: null,
      candidateAt: null,
    };
    global.set(plausibilityStateKey, allStates);
    return { accepted: true, confirmed: false };
  }

  // Do not let a delayed or replayed packet move the live plausibility state
  // backwards. Ordering and duplicate checks are handled by the DB writer.
  if (sourceTimestampMs <= Number(state.lastGoodAt)) {
    return { accepted: true, confirmed: false };
  }

  const elapsedMinutes = Math.max(
    1,
    (sourceTimestampMs - Number(state.lastGoodAt)) / 60_000,
  );
  const allowedDelta = spikeLimits[sensorKey] * elapsedMinutes;
  const delta = Math.abs(value - Number(state.lastGoodValue));

  if (delta <= allowedDelta) {
    allStates[stateKey] = {
      lastGoodValue: value,
      lastGoodAt: sourceTimestampMs,
      candidateValue: null,
      candidateAt: null,
    };
    global.set(plausibilityStateKey, allStates);
    return { accepted: true, confirmed: false };
  }

  const candidateValue = Number(state.candidateValue);
  const candidateAt = Number(state.candidateAt);
  const confirmsCandidate =
    Number.isFinite(candidateValue) &&
    Number.isFinite(candidateAt) &&
    sourceTimestampMs > candidateAt &&
    Math.abs(value - candidateValue) <= spikeLimits[sensorKey];

  if (confirmsCandidate) {
    allStates[stateKey] = {
      lastGoodValue: value,
      lastGoodAt: sourceTimestampMs,
      candidateValue: null,
      candidateAt: null,
    };
    global.set(plausibilityStateKey, allStates);
    return {
      accepted: true,
      confirmed: true,
      previousValue: Number(state.lastGoodValue),
      candidateValue,
      allowedDelta,
    };
  }

  allStates[stateKey] = {
    ...state,
    candidateValue: value,
    candidateAt: sourceTimestampMs,
  };
  global.set(plausibilityStateKey, allStates);
  return {
    accepted: false,
    confirmed: false,
    previousValue: Number(state.lastGoodValue),
    candidateValue: value,
    allowedDelta,
  };
}

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

if (
  !["gr", "ttn"].includes(companyId) ||
  !["status", "sensor"].includes(messageType)
) {
  node.status({
    fill: "red",
    shape: "ring",
    text: "topic route missing",
  });
  return reject("MQTT topic is not mapped to a company and message type");
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
  const allMapsText = String(
    env.get("STCR_FACTORY_MQTT_OVEN_MAPS_JSON") || "",
  ).trim();
  if (allMapsText) {
    const allMaps = JSON.parse(allMapsText);
    ovenMap = allMaps?.[companyId] || {};
  } else {
    ovenMap = JSON.parse(
      String(env.get("STCR_FACTORY_MQTT_OVEN_MAP_JSON") || "{}"),
    );
  }
} catch {
  return reject("MQTT oven mapping is invalid JSON");
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

if (messageType === "status") {
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
let sensorRanges;
let spikeLimits;
let requiredSensorKeys;
try {
  sensorRanges = readSensorRanges();
  spikeLimits = readSpikeLimits();
  requiredSensorKeys = readRequiredSensors();
} catch (error) {
  return reject(`MQTT sensor filter configuration is invalid: ${error.message}`, {
    ovenNumber,
    ovenId,
    cycleNumber,
  });
}

const now = Date.now();
const stale = now - sourceTimestampMs > 2 * 60 * 1000;
const future = sourceTimestampMs - now > 30 * 1000;
const qualityReasons = [
  ...(stale ? ["stale"] : []),
  ...(future ? ["future-timestamp"] : []),
];
const sequence = sourceTimestampMs;

const readings = [];
const missingSensors = [];
const invalidSensors = [];
const suspectSensors = [];
const confirmedSensors = [];
for (const [sensorKey, sourceKey, unit] of definitions) {
  if (!requiredSensorKeys.includes(sensorKey)) continue;

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

  const range = sensorRanges[sensorKey];
  if (numericValue < range.min || numericValue > range.max) {
    invalidSensors.push({
      sensorKey,
      sourceKey,
      value: numericValue,
      min: range.min,
      max: range.max,
      reason: "outside-physical-range",
    });
    continue;
  }

  const plausibility = inspectPlausibility(
    sensorKey,
    numericValue,
    sourceTimestampMs,
    spikeLimits,
  );
  if (!plausibility.accepted) {
    suspectSensors.push({
      sensorKey,
      sourceKey,
      value: numericValue,
      previousValue: plausibility.previousValue,
      allowedDelta: plausibility.allowedDelta,
      reason: "unconfirmed-spike",
    });
    if (!missingSensors.includes(sensorKey)) {
      missingSensors.push(sensorKey);
    }
    continue;
  }
  if (plausibility.confirmed) {
    confirmedSensors.push({
      sensorKey,
      value: numericValue,
      previousValue: plausibility.previousValue,
      candidateValue: plausibility.candidateValue,
      reason: "confirmed-change",
    });
  }

  readings.push({
    sensorKey,
    sensorId: `factory-${companyId}-${ovenId}-${sensorKey}`,
    sequence,
    value: numericValue,
    rawValue: numericValue,
    unit,
    sourceTimestamp,
  });
}

for (const invalid of invalidSensors) {
  qualityReasons.push(`outside-range:${invalid.sensorKey}`);
  if (!missingSensors.includes(invalid.sensorKey)) {
    missingSensors.push(invalid.sensorKey);
  }
}
for (const suspect of suspectSensors) {
  qualityReasons.push(`unconfirmed-spike:${suspect.sensorKey}`);
}
for (const confirmed of confirmedSensors) {
  qualityReasons.push(`confirmed-change:${confirmed.sensorKey}`);
}
const quality = qualityReasons.length ? "suspect" : "good";
for (const reading of readings) {
  reading.quality = quality;
  reading.qualityReasons = [...qualityReasons];
}

const batchId = `mqtt-${ovenNumber}-${cycleNumber}-${sourceTimestampMs}`;
const deviceId = `factory-${companyId}-oven-${ovenNumber}`;
const missingRequiredSensors = missingSensors.filter((sensorKey) =>
  requiredSensorKeys.includes(sensorKey),
);
const incomplete = missingRequiredSensors.length > 0;

msg._mqttEnvelope = {
  ...commonEnvelope,
  type: incomplete ? "pending" : "sensor",
  startOven,
  quality,
  qualityReasons,
  readings,
  requiredSensorKeys,
  missingSensors,
  missingRequiredSensors,
  invalidSensors,
  suspectSensors,
  confirmedSensors,
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
    missingRequiredSensors,
    invalidSensors,
    suspectSensors,
    confirmedSensors,
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
