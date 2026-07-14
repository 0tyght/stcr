const physicalRanges = {
  chamberTemp: { min: -20, max: 120, unit: "C" },
  humidity: { min: 0, max: 100, unit: "%" },
  furnaceTemp: { min: -20, max: 900, unit: "C" },
  blowerTemp: { min: -20, max: 600, unit: "C" },
};

const telemetry = msg.payload;
if (!telemetry || typeof telemetry !== "object") {
  node.warn("Dropped telemetry without payload");
  return null;
}

const requiredIds = ["companyId", "ovenId", "deviceId", "sensorId", "batchId"];
const invalidId = requiredIds.some((key) =>
  typeof telemetry[key] !== "string" ||
  !telemetry[key].trim() ||
  telemetry[key].length > 160 ||
  /[\u0000-\u001f\u007f]/.test(telemetry[key])
);
const sequence = Number(telemetry.sequence);
const rootState = global.get("stcrState");
const companyState = rootState?.companies?.[telemetry.companyId];
const knownOven = companyState?.ovens?.some((oven) => oven.id === telemetry.ovenId);
const expectedTopic = `stcr/${telemetry.companyId}/${telemetry.ovenId}/telemetry/${telemetry.sensorKey}`;

if (invalidId || !Number.isSafeInteger(sequence) || sequence < 0 || !knownOven || msg.topic !== expectedTopic) {
  node.warn(`Dropped telemetry with invalid source identity: ${msg.topic || "unknown topic"}`);
  return null;
}

const rule = physicalRanges[telemetry.sensorKey];
const value = Number(telemetry.value);
const sourceTime = Date.parse(telemetry.sourceTimestamp);
const now = Date.now();

if (!rule || !Number.isFinite(value) || !Number.isFinite(sourceTime)) {
  node.warn(`Dropped malformed telemetry: ${msg.topic || "unknown topic"}`);
  return null;
}

const sequenceKey = `lastSequence:${telemetry.companyId}:${telemetry.sensorId}`;
const lastSequence = context.get(sequenceKey);
if (Number.isSafeInteger(lastSequence) && sequence <= lastSequence) {
  node.warn(`Dropped replayed telemetry: ${telemetry.sensorId} seq ${sequence}`);
  return null;
}
context.set(sequenceKey, sequence);

let quality = "good";
const qualityReasons = [];

if (telemetry.unit !== rule.unit) {
  quality = "suspect";
  qualityReasons.push(`unit:${telemetry.unit}`);
}
if (value < rule.min || value > rule.max) {
  quality = "suspect";
  qualityReasons.push("physical-range");
}
if (now - sourceTime > 30000) {
  quality = "suspect";
  qualityReasons.push("stale");
}
if (sourceTime - now > 5000) {
  quality = "suspect";
  qualityReasons.push("future-timestamp");
}

msg.payload = {
  ...telemetry,
  topic: msg.topic,
  value,
  quality,
  qualityReasons,
  gatewayTimestamp: new Date(now).toISOString(),
};
msg.telemetry = true;
node.status({
  fill: quality === "good" ? "green" : "yellow",
  shape: quality === "good" ? "dot" : "ring",
  text: `${telemetry.sensorKey} seq ${telemetry.sequence}`,
});
return msg;
