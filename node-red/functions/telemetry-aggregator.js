const BATCH_TIMEOUT_MS = 6500;
const REQUIRED_SENSOR_KEYS = ["chamberTemp", "humidity", "furnaceTemp", "blowerTemp"];

function flushBatch(batchKey, timedOut) {
  const batch = context.get(batchKey);
  if (!batch) return null;
  context.set(batchKey, undefined);

  const state = global.get("stcrState");
  if (!state?.companies) return null;
  const companyId = batch.companyId;
  const companyState = state.companies[companyId];
  if (!companyState) return null;

  const updatedOvenIds = [];
  companyState.ovens = companyState.ovens.map((oven) => {
    const sensorSet = batch.sensors[`${companyId}:${oven.id}`];
    const complete = REQUIRED_SENSOR_KEYS.every((sensorKey) => sensorSet?.[sensorKey]);
    if (!complete) return oven;

    const readings = { ...oven.readings };
    REQUIRED_SENSOR_KEYS.forEach((sensorKey) => {
      const sample = sensorSet[sensorKey];
      readings[sensorKey] = {
        ...readings[sensorKey],
        value: sample.value,
        updatedAt: sample.sourceTimestamp,
      };
    });
    updatedOvenIds.push(oven.id);
    return { ...oven, readings };
  });

  state.companies[companyId] = companyState;
  global.set("stcrState", state);

  let good = 0;
  let suspect = 0;
  Object.values(batch.sensors).forEach((sensorSet) => {
    Object.values(sensorSet).forEach((sample) => {
      if (sample.quality === "good") good += 1;
      else suspect += 1;
    });
  });
  const missing = Math.max(0, batch.expected - batch.received);

  node.status({
    fill: missing ? "yellow" : "green",
    shape: missing ? "ring" : "dot",
    text: missing
      ? `${updatedOvenIds.length} ovens / ${missing} missing`
      : `batch ${good} good / ${suspect} suspect`,
  });

  return {
    topic: "stcr/persist",
    payload: {
      version: state.version,
      capturedAt: new Date().toISOString(),
      telemetryBatchId: batch.batchId,
      telemetryQuality: { good, suspect, missing, timedOut },
      telemetrySamples: batch.sensors,
      updatedOvenIds,
      companies: { [companyId]: companyState },
    },
  };
}

const telemetry = msg.payload;
if (!msg.telemetry || !telemetry?.batchId) return null;

const batchKey = `telemetryBatch:${telemetry.batchId}`;
let batch = context.get(batchKey);
if (!batch) {
  batch = {
    batchId: telemetry.batchId,
    companyId: telemetry.companyId,
    received: 0,
    expected: telemetry.expectedTelemetryCount,
    sensors: {},
    startedAt: Date.now(),
  };

  setTimeout(() => {
    const output = flushBatch(batchKey, true);
    if (output) node.send(output);
  }, BATCH_TIMEOUT_MS);
}

const pointKey = `${telemetry.companyId}:${telemetry.ovenId}`;
batch.sensors[pointKey] ||= {};
const existing = batch.sensors[pointKey][telemetry.sensorKey];

if (!existing || telemetry.sequence >= existing.sequence) {
  if (!existing) batch.received += 1;
  batch.sensors[pointKey][telemetry.sensorKey] = telemetry;
}

context.set(batchKey, batch);

if (batch.received >= batch.expected) {
  return flushBatch(batchKey, false);
}

node.status({ fill: "blue", shape: "dot", text: `${batch.received}/${batch.expected}` });
return null;
