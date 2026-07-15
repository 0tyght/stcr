if (String(env.get("STCR_HTTP_INGEST_ENABLED") || "false").toLowerCase() !== "true") return null;

const snapshot = msg.payload;
const companyId = Object.keys(snapshot?.companies || {})[0];
const companyState = snapshot?.companies?.[companyId];
if (!companyId || !companyState || !["gr", "ttn"].includes(companyId)) return null;

const now = Date.now();
const lastSentAt = Number(context.get(`httpLastSent:${companyId}`) || 0);
if (now - lastSentAt < 60 * 1000) return null;

const apiKeyName = companyId === "gr" ? "STCR_GR_INGEST_API_KEY" : "STCR_TTN_INGEST_API_KEY";
const apiKey = String(env.get(apiKeyName) || "");
const ingestUrl = String(env.get("STCR_INGEST_URL") || "http://127.0.0.1:1880/stcr/api/telemetry");
if (!apiKey) {
  node.status({ fill: "red", shape: "ring", text: `${apiKeyName} missing` });
  return null;
}

const messages = [];
for (const ovenId of snapshot.updatedOvenIds || []) {
  const sensorSet = snapshot.telemetrySamples?.[`${companyId}:${ovenId}`];
  if (!sensorSet) continue;
  const readings = ["chamberTemp", "humidity", "furnaceTemp", "blowerTemp"]
    .map((sensorKey) => sensorSet[sensorKey])
    .filter(Boolean)
    .map((sample) => ({
      sensorKey: sample.sensorKey,
      sensorId: sample.sensorId,
      sequence: sample.sequence,
      value: sample.value,
      rawValue: sample.rawValue ?? sample.value,
      unit: sample.unit,
      quality: sample.quality,
      qualityReasons: sample.qualityReasons || [],
      sourceTimestamp: sample.sourceTimestamp,
    }));
  if (readings.length !== 4) continue;
  messages.push({
    method: "POST",
    url: ingestUrl,
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    payload: {
      companyId,
      ovenId,
      batchId: `${snapshot.telemetryBatchId}-${ovenId}`,
      deviceId: `${companyId}-${ovenId}-gateway`,
      readings,
    },
  });
}

if (!messages.length) return null;
context.set(`httpLastSent:${companyId}`, now);
node.status({ fill: "blue", shape: "dot", text: `${messages.length} ovens / 1 min` });
return [messages];
