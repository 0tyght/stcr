const allowedTopics = new Set(["test", "sensor"]);
const companyId = String(env.get("STCR_FACTORY_MQTT_COMPANY_ID") || "").trim().toLowerCase();
const forwardingEnabled = String(env.get("STCR_FACTORY_MQTT_FORWARD_ENABLED") || "false").toLowerCase() === "true";
const deploymentMode = String(env.get("STCR_DEPLOYMENT_MODE") || "development").toLowerCase();
const topic = String(msg.topic || "").trim();
const receivedAt = msg.factoryMqtt?.receivedAt || new Date().toISOString();
const sourceUtcOffsetMinutes = Number(env.get("STCR_FACTORY_MQTT_SOURCE_UTC_OFFSET_MINUTES") || 0);

function inspection(status, detail, extra = {}) {
  return {
    topic: `stcr/factory-mqtt/${status}`,
    payload: { status, detail, sourceTopic: topic, companyId: companyId || null, receivedAt, ...extra },
  };
}

if (!["gr", "ttn"].includes(companyId)) {
  node.status({ fill: "red", shape: "ring", text: "company mapping missing" });
  return [null, inspection("rejected", "STCR_FACTORY_MQTT_COMPANY_ID is missing")];
}
if (!allowedTopics.has(topic)) {
  node.status({ fill: "yellow", shape: "ring", text: "unknown MQTT topic" });
  return [null, inspection("rejected", "Unknown MQTT topic")];
}

const rawText = Buffer.isBuffer(msg.payload) ? msg.payload.toString("utf8") : String(msg.payload || "");
if (!rawText || Buffer.byteLength(rawText, "utf8") > 8192) {
  return [null, inspection("rejected", "MQTT payload is empty or too large")];
}

let source;
try {
  source = JSON.parse(rawText);
} catch {
  node.status({ fill: "yellow", shape: "ring", text: "invalid MQTT JSON" });
  return [null, inspection("rejected", "MQTT payload is not valid JSON")];
}

const ovenNumber = Number(source.oven);
const cycleNumber = Number(source.cycle);
const rawSourceTimestampMs = Date.parse(source.time_stamp);
const validSourceOffset = Number.isInteger(sourceUtcOffsetMinutes) && Math.abs(sourceUtcOffsetMinutes) <= 840;
const sourceTimestampMs = rawSourceTimestampMs - sourceUtcOffsetMinutes * 60 * 1000;
if (
  !Number.isSafeInteger(ovenNumber) || ovenNumber < 1 || ovenNumber > 10000 ||
  !Number.isSafeInteger(cycleNumber) || cycleNumber < 0 || cycleNumber > 1000000 ||
  !Number.isFinite(rawSourceTimestampMs) || !validSourceOffset
) {
  node.status({ fill: "yellow", shape: "ring", text: "invalid MQTT identity" });
  return [null, inspection("rejected", "Invalid oven, cycle, or timestamp", { rawPayload: source })];
}

let ovenMap = {};
try {
  ovenMap = JSON.parse(String(env.get("STCR_FACTORY_MQTT_OVEN_MAP_JSON") || "{}"));
} catch {
  return [null, inspection("rejected", "STCR_FACTORY_MQTT_OVEN_MAP_JSON is invalid JSON")];
}
const explicitOvenId = typeof ovenMap[String(ovenNumber)] === "string"
  ? ovenMap[String(ovenNumber)].trim()
  : "";
const ovenId = explicitOvenId || (deploymentMode === "production" ? "" : `oven-${ovenNumber}`);
if (!ovenId || ovenId.length > 64 || /[\u0000-\u001f\u007f]/.test(ovenId)) {
  node.status({ fill: "red", shape: "ring", text: `oven ${ovenNumber} unmapped` });
  return [null, inspection("pending", "Oven mapping is required", {
    ovenNumber, cycleNumber, rawPayload: source,
  })];
}

const apiKeyName = companyId === "gr" ? "STCR_GR_INGEST_API_KEY" : "STCR_TTN_INGEST_API_KEY";
const apiKey = String(env.get(apiKeyName) || "");
const ingestUrl = String(env.get("STCR_INGEST_URL") || "http://127.0.0.1:1880/stcr/api/telemetry");
const rawIngestUrl = String(
  env.get("STCR_FACTORY_MQTT_RAW_URL") || ingestUrl.replace(/\/telemetry\/?$/, "/factory-mqtt/raw"),
);
if (forwardingEnabled && !apiKey) {
  node.status({ fill: "red", shape: "ring", text: `${apiKeyName} missing` });
  return [null, inspection("rejected", `${apiKeyName} is missing`)];
}

function rawForwardMessage(normalizationStatus, normalizationDetail) {
  if (!forwardingEnabled) return null;
  return {
    method: "POST",
    url: rawIngestUrl,
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    payload: {
      companyId,
      ovenId,
      ovenNumber,
      cycleNumber,
      topic,
      qos: Number(msg.factoryMqtt?.qos ?? 0),
      retained: Boolean(msg.factoryMqtt?.retain),
      duplicateDelivery: Boolean(msg.factoryMqtt?.duplicate),
      sourceTimestamp: new Date(sourceTimestampMs).toISOString(),
      payload: source,
      normalizationStatus,
      normalizationDetail,
    },
  };
}

if (topic === "test") {
  const ovenState = Number(source.oven_state);
  if (![0, 1].includes(ovenState)) {
    return [rawForwardMessage("rejected", "oven_state must be 0 or 1"), inspection("rejected", "oven_state must be 0 or 1", {
      ovenNumber, ovenId, cycleNumber, rawPayload: source,
    })];
  }
  node.status({ fill: "blue", shape: "dot", text: `status oven ${ovenNumber}` });
  const detail = "Status validated; oven_state is the primary control value (0=closed, 1=open)";
  return [rawForwardMessage("received", detail), inspection("validated", detail, {
    ovenNumber,
    ovenId,
    cycleNumber,
    ovenState,
    rawPayload: source,
  })];
}

const startOven = Number(source.startoven);
if (![0, 1].includes(startOven)) {
  return [rawForwardMessage("rejected", "startoven must be 0 or 1"), inspection("rejected", "startoven must be 0 or 1", {
    ovenNumber, ovenId, cycleNumber, rawPayload: source,
  })];
}

const definitions = [
  ["chamberTemp", "roomtemp", "C"],
  ["humidity", "humanity", "%"],
  ["furnaceTemp", "oventemp", "C"],
  ["blowerTemp", "blower", "C"],
];
const missingSensors = definitions
  .filter(([, sourceKey]) => (
    source[sourceKey] === null || source[sourceKey] === undefined || source[sourceKey] === "" ||
    !Number.isFinite(Number(source[sourceKey]))
  ))
  .map(([sensorKey]) => sensorKey);
if (missingSensors.length) {
  node.status({ fill: "yellow", shape: "ring", text: `${missingSensors.join(", ")} missing` });
  const detail = "Sensor values are incomplete";
  return [rawForwardMessage("pending", detail), inspection("pending", detail, {
    ovenNumber, ovenId, cycleNumber, missingSensors, rawPayload: source,
  })];
}

const now = Date.now();
const stale = now - sourceTimestampMs > 2 * 60 * 1000;
const future = sourceTimestampMs - now > 30 * 1000;
const qualityReasons = [
  ...(stale ? ["stale"] : []),
  ...(future ? ["future-timestamp"] : []),
];
const sourceTimestamp = new Date(sourceTimestampMs).toISOString();
const sequence = sourceTimestampMs;
const readings = definitions.map(([sensorKey, sourceKey, unit]) => ({
  sensorKey,
  sensorId: `factory-${companyId}-${ovenId}-${sensorKey}`,
  sequence,
  value: Number(source[sourceKey]),
  rawValue: Number(source[sourceKey]),
  unit,
  quality: qualityReasons.length ? "suspect" : "good",
  qualityReasons,
  sourceTimestamp,
}));

const normalizedPayload = {
  companyId,
  ovenId,
  batchId: `mqtt-${ovenNumber}-${cycleNumber}-${sourceTimestampMs}`,
  deviceId: `factory-${companyId}-oven-${ovenNumber}`,
  readings,
};
const inspectMessage = inspection(forwardingEnabled ? "forwarded" : "validated", forwardingEnabled
  ? "Normalized sensor payload forwarded to the ingestion API"
  : "Normalized sensor payload validated; database forwarding is disabled", {
  ovenNumber,
  ovenId,
  cycleNumber,
  startOven,
  page: source.page,
  pageUsed: false,
  originalSourceTimestamp: source.time_stamp,
  normalizedSourceTimestamp: sourceTimestamp,
  normalizedPayload,
  rawPayload: source,
});

if (!forwardingEnabled) {
  node.status({ fill: "blue", shape: "dot", text: `validated oven ${ovenNumber}` });
  return [null, inspectMessage];
}

node.status({ fill: "green", shape: "dot", text: `forward oven ${ovenNumber}` });
const telemetryForwardMessage = {
  method: "POST",
  url: ingestUrl,
  headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
  payload: normalizedPayload,
};
return [[
  rawForwardMessage("normalized", "All four sensor values were normalized"),
  telemetryForwardMessage,
], inspectMessage];
