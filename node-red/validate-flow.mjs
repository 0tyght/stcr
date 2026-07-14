import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const flows = JSON.parse(await readFile(join(root, "flows.json"), "utf8"));
const simulationModelSource = await readFile(join(root, "functions", "simulation-model.js"), "utf8");
const simulatorBody = await readFile(join(root, "functions", "simulator.js"), "utf8");
const simulatorSource = `${simulationModelSource}\n${simulatorBody}`;
const routerSource = await readFile(join(root, "functions", "api-router.js"), "utf8");
const persistenceBody = await readFile(join(root, "functions", "persist-snapshot.js"), "utf8");
const persistenceSource = `${simulationModelSource}\n${persistenceBody}`;
const gatewaySource = await readFile(join(root, "functions", "sensor-gateway.js"), "utf8");
const processingSource = await readFile(join(root, "functions", "signal-processing.js"), "utf8");
const aggregatorSource = await readFile(join(root, "functions", "telemetry-aggregator.js"), "utf8");
const reseedSource = await readFile(join(root, "reseed-current-simulation.mjs"), "utf8");
const { simulationSensorValues, simulationWoodLoadingPeriod } = new Function(
  `${simulationModelSource}\nreturn { simulationSensorValues, simulationWoodLoadingPeriod };`,
)();

const context = new Map();
const flow = {
  get: (key) => context.get(key),
  set: (key, value) => context.set(key, value),
};
const globalApi = {
  get: (key) => context.get(key),
  set: (key, value) => context.set(key, value),
};
const node = { status: () => undefined, warn: () => undefined };

const runSimulator = new Function("msg", "flow", "global", "node", simulatorSource);
const telemetryOutputs = runSimulator({ payload: Date.now() }, flow, globalApi, node);
assert.equal(telemetryOutputs.length, 4, "Simulator must emit four independent sensor channels");
assert.match(telemetryOutputs[0][0].topic, /^stcr\/gr\/oven-\d+\/telemetry\/chamberTemp$/);
assert.equal(telemetryOutputs[0][0].payload.sensorKey, "chamberTemp");
assert.ok(telemetryOutputs[0][0].payload.sensorId);
assert.ok(telemetryOutputs[0][0].payload.deviceId);
assert.ok(Number.isInteger(telemetryOutputs[0][0].payload.sequence));
assert.equal(telemetryOutputs[0][0].payload.expectedTelemetryCount, 56);
assert.equal(
  telemetryOutputs.flat().find((msg) => msg.payload.companyId === "ttn").payload.expectedTelemetryCount,
  36,
);

const state = globalApi.get("stcrState");
assert.ok(state, "Simulator must initialize stcrState");
assert.deepEqual(Object.keys(state.companies).sort(), ["gr", "ttn"]);
const grState = state.companies.gr;
const ttnState = state.companies.ttn;
grState.alarms.push({
  id: "contract-stale-alarm",
  ovenId: "oven-15",
  severity: "warning",
  status: "active",
  title: "contract test",
  detail: "must resolve when no longer active",
  createdAt: new Date(Date.now() - 60000).toISOString(),
});
runSimulator({ payload: Date.now() + 5000 }, flow, globalApi, node);
const resolvedContractAlarm = state.companies.gr.alarms.find(
  (alarm) => alarm.id === "contract-stale-alarm",
);
assert.equal(resolvedContractAlarm.status, "resolved");
assert.ok(resolvedContractAlarm.resolvedAt);
assert.equal(grState.ovens.length, 16, "GR source must create ovens 11-26");
assert.equal(grState.ovens[0].number, 11);
assert.equal(grState.ovens[15].number, 26);
assert.equal(ttnState.ovens.length, 10, "TTN source must create ovens 1-10 independently");
assert.equal(ttnState.ovens[0].number, 1);
assert.notStrictEqual(grState.ovens, ttnState.ovens, "Company sources must not share oven state");
assert.equal(
  ttnState.alarms.some((alarm) => alarm.ovenId === "oven-1" && alarm.sensor),
  false,
  "Ignition grace period must suppress sensor alarms",
);
assert.ok(ttnState.ovens[0].firedAt, "Ignition oven must retain firedAt");
assert.equal(ttnState.ovens[0].reportStartedAt, undefined, "Report must not start before ready temperature");
assert.ok(
  grState.ovens.filter((oven) => oven.status === "open" && oven.reportStartedAt).length > 0,
  "Mature open ovens must have reportStartedAt",
);
assert.ok(grState.history["oven-18"].length > 10, "Current cycle must contain seeded history");
assert.equal(grState.ovens.find((oven) => oven.id === "oven-18").cycleCount, 83);
const completedOven = grState.ovens.find((oven) => oven.id === "oven-11");
assert.equal(completedOven.status, "closed");
assert.ok(completedOven.firedAt, "Completed cycle must retain firedAt");
assert.ok(completedOven.reportStartedAt, "Completed cycle must retain reportStartedAt");
assert.ok(completedOven.stoppedAt, "Completed cycle must retain stoppedAt");
assert.ok(grState.history[completedOven.id].length > 500, "Completed cycle history must be available");
assert.equal(grState.archivedCycles[completedOven.id].length, 6);
assert.equal(grState.archivedCycles["oven-18"][0].cycleNumber, 82);
assert.ok(
  Date.parse(grState.archivedCycles["oven-18"][0].reportStartedAt)
    < Date.parse(grState.archivedCycles["oven-18"][0].stoppedAt),
  "Archived report range must be ordered",
);
assert.ok(
  Date.parse(grState.history[completedOven.id].at(-1).timestamp) <= Date.parse(completedOven.stoppedAt),
  "Completed cycle history must stop when the oven stops",
);

for (const companyState of [grState, ttnState]) {
  const openOvens = companyState.ovens.filter((oven) => oven.status === "open");
  assert.ok(openOvens.length > 0);
  openOvens.forEach((oven) => {
    assert.ok(oven.readings.chamberTemp.value >= 25 && oven.readings.chamberTemp.value <= 63);
    assert.ok(oven.readings.humidity.value >= 42 && oven.readings.humidity.value <= 86);
    assert.ok(oven.readings.furnaceTemp.value >= 0 && oven.readings.furnaceTemp.value <= 565);
    assert.ok(oven.readings.blowerTemp.value >= 0 && oven.readings.blowerTemp.value <= 420);
  });
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const functionContext = new Map();
const contextApi = {
  get: (key) => functionContext.get(key),
  set: (key, value) => functionContext.set(key, value),
};
const env = { get: () => undefined };
const mysql = { createPool: () => { throw new Error("Database disabled in contract test"); } };
const runRouter = new AsyncFunction("msg", "flow", "global", "node", "context", "env", "mysql", routerSource);

const health = await runRouter(
  { req: { method: "GET", path: "/stcr/api/health", query: {} } },
  flow,
  globalApi,
  node, contextApi, env, mysql,
);
assert.equal(health.statusCode, 200);
assert.equal(health.payload.ok, true);
assert.deepEqual(health.payload.sources.sort(), ["gr", "ttn"]);

const ovens = await runRouter(
  { req: { method: "GET", path: "/stcr/api/ovens", query: {} } },
  flow,
  globalApi,
  node, contextApi, env, mysql,
);
assert.equal(ovens.payload.length, 16);

const ttnOvens = await runRouter(
  { req: { method: "GET", path: "/stcr/api/ovens", query: { companyId: "ttn" }, headers: {} } },
  flow,
  globalApi,
  node, contextApi, env, mysql,
);
assert.equal(ttnOvens.payload.length, 10);
assert.equal(ttnOvens.payload[0].number, 1);
assert.equal(ttnOvens.payload[0].zone, "TTN");

const history = await runRouter(
  {
    req: {
      method: "GET",
      path: "/stcr/api/ovens/oven-18/history",
      query: {},
    },
  },
  flow,
  globalApi,
  node, contextApi, env, mysql,
);
assert.ok(history.payload.length > 10);
assert.deepEqual(
  Object.keys(history.payload[0]),
  ["timestamp", "chamberTemp", "humidity", "furnaceTemp", "blowerTemp"],
);

const requiredPaths = [
  "/stcr/api/health",
  "/stcr/api/ovens",
  "/stcr/api/ovens/:ovenId/history",
  "/stcr/api/alarms",
];
const flowPaths = new Set(flows.filter((item) => item.type === "http in").map((item) => item.url));
requiredPaths.forEach((path) => assert.ok(flowPaths.has(path), `Missing HTTP node: ${path}`));

const tabs = flows.filter((item) => item.type === "tab");
assert.deepEqual(
  tabs.map((tab) => tab.label),
  [
    "01 จำลองข้อมูลอุปกรณ์หน้างาน",
    "02 ประมวลผลข้อมูล GR",
    "03 ประมวลผลข้อมูล TTN",
    "04 ฐานข้อมูลและ API",
  ],
);

const persistenceNode = flows.find((item) => item.id === "stcr-db-persistence");
assert.ok(persistenceNode, "Flow must include MariaDB persistence");
assert.deepEqual(persistenceNode.libs, [{ var: "mysql", module: "mysql2/promise" }]);
assert.match(persistenceSource, /INSERT INTO sensor_readings/);
assert.match(persistenceSource, /included_in_report/);
assert.match(persistenceSource, /INSERT INTO telemetry_events/);
assert.match(persistenceSource, /dbBackfill:/);
assert.match(persistenceSource, /INSERT IGNORE INTO sensor_readings/);
assert.match(persistenceSource, /persistArchivedCycle/);
assert.match(persistenceSource, /dbArchive:/);
assert.match(persistenceSource, /SET time_zone = '\+00:00'/);
assert.match(routerSource, /includeIgnition/);
assert.equal(flows.filter((item) => /stcr-(gr|ttn)-.+-gateway/.test(item.id || "")).length, 8);
assert.equal(flows.filter((item) => /stcr-(gr|ttn)-.+-processor/.test(item.id || "")).length, 8);
assert.equal(flows.filter((item) => /stcr-(gr|ttn)-aggregator/.test(item.id || "")).length, 2);
assert.match(gatewaySource, /physicalRanges/);
assert.match(gatewaySource, /future-timestamp/);
assert.match(aggregatorSource, /expectedTelemetryCount/);
assert.match(aggregatorSource, /companies: \{ \[companyId\]: companyState \}/);
assert.match(aggregatorSource, /BATCH_TIMEOUT_MS = 6500/);
assert.match(aggregatorSource, /updatedOvenIds/);
assert.match(processingSource, /medianWindow: 5/);
assert.match(processingSource, /emaAlpha/);
assert.match(processingSource, /spike-rejected/);
assert.match(persistenceSource, /sample\.rawValue \?\? sample\.value/);
assert.match(persistenceSource, /status IN \('active','acknowledged'\)/);
assert.match(persistenceSource, /resolved_at=COALESCE/);
assert.match(routerSource, /bucketSeconds = requestedRangeMs[^;]+\? 600 : 60/s);
assert.equal((simulatorBody.match(/function simulationSensorValues/g) || []).length, 0);
assert.equal((persistenceBody.match(/function simulationSensorValues/g) || []).length, 0);
assert.match(simulationModelSource, /function simulationSensorValues/);
assert.match(reseedSource, /functions["', ]+simulation-model\.js/);
assert.doesNotMatch(reseedSource, /function sensorValues/);
assert.doesNotMatch(
  reseedSource,
  /WHERE c\.state=['"]recording['"]/,
  "Simulation reseed must update current and completed cycles",
);
assert.match(reseedSource, /Map\.groupBy\(rows, \(row\) => row\.cycle_id\)/);
assert.match(reseedSource, /ER_LOCK_DEADLOCK/);
assert.match(simulatorBody, /newlyResolved/);
assert.match(simulatorBody, /resolvedAt/);

for (const companyId of ["gr", "ttn"]) {
  const ovenNumbers = companyId === "gr"
    ? Array.from({ length: 16 }, (_, index) => index + 11)
    : Array.from({ length: 10 }, (_, index) => index + 1);
  ovenNumbers.forEach((ovenNumber) => {
    const periods = Array.from(
      { length: 36 },
      (_, loadingIndex) => simulationWoodLoadingPeriod(companyId, ovenNumber, loadingIndex),
    );
    periods.forEach((period) => {
      assert.ok(period >= 3 && period <= 6, "Wood loading interval must stay within 3-6 hours");
    });
    assert.ok(
      new Set(periods.map((period) => period.toFixed(2))).size >= 24,
      "Wood loading intervals must vary for each loading event",
    );
  });
}

const modelPoints = Array.from({ length: 6 * 24 * 6 + 1 }, (_, index) =>
  simulationSensorValues("gr", 15, index * 10 * 60 * 1000, 0),
);
const modelDeltas = modelPoints.slice(1).map((point, index) => ({
  chamber: Math.abs(point.chamberTemp - modelPoints[index].chamberTemp),
  humidity: Math.abs(point.humidity - modelPoints[index].humidity),
  furnace: Math.abs(point.furnaceTemp - modelPoints[index].furnaceTemp),
  blower: Math.abs(point.blowerTemp - modelPoints[index].blowerTemp),
}));
const modelDeltasAfterRecordingStarts = modelDeltas.slice(6 * 6);
assert.ok(Math.max(...modelDeltas.map((delta) => delta.chamber)) <= 0.8);
assert.ok(Math.max(...modelDeltas.map((delta) => delta.humidity)) <= 0.2);
assert.ok(
  Math.max(...modelDeltasAfterRecordingStarts.map((delta) => delta.furnace)) <= 12,
  "Furnace temperature must respond gradually after recording starts",
);
assert.ok(
  Math.max(...modelDeltasAfterRecordingStarts.map((delta) => delta.blower)) <= 10,
  "Blower temperature must respond gradually after recording starts",
);
assert.ok(modelPoints[2 * 24 * 6].humidity >= 76, "Humidity must decline slowly during first two days");
assert.ok(modelPoints.at(-1).humidity <= 58, "Humidity must reach the final drying range by day six");

const processorContext = new Map();
const processorApi = {
  get: (key) => processorContext.get(key),
  set: (key, value) => processorContext.set(key, value),
};
const runProcessor = new Function("msg", "context", "node", processingSource);
const processed = runProcessor(
  {
    telemetry: true,
    payload: {
      companyId: "gr",
      ovenId: "oven-18",
      sensorKey: "chamberTemp",
      value: 57.5,
      quality: "good",
      qualityReasons: [],
    },
  },
  processorApi,
  node,
);
assert.equal(processed.payload.rawValue, 57.5);
assert.equal(processed.payload.value, 57.5);
assert.equal(processed.payload.processing.method, "calibration+median5+ema");

function createAggregatorHarness() {
  const aggregatorContext = new Map();
  const callbacks = [];
  const sent = [];
  const stateForAggregator = structuredClone(state);
  stateForAggregator.companies.gr.ovens = [
    stateForAggregator.companies.gr.ovens.find((oven) => oven.id === "oven-15"),
  ];
  const contextForAggregator = {
    get: (key) => aggregatorContext.get(key),
    set: (key, value) => value === undefined
      ? aggregatorContext.delete(key)
      : aggregatorContext.set(key, value),
  };
  const globalForAggregator = {
    get: () => stateForAggregator,
    set: () => undefined,
  };
  const nodeForAggregator = {
    status: () => undefined,
    send: (output) => sent.push(output),
  };
  const fakeSetTimeout = (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  };
  const runAggregator = new Function(
    "msg", "context", "global", "node", "setTimeout", aggregatorSource,
  );
  return {
    callbacks,
    sent,
    aggregatorContext,
    run: (payload) => runAggregator(
      { telemetry: true, payload },
      contextForAggregator,
      globalForAggregator,
      nodeForAggregator,
      fakeSetTimeout,
    ),
  };
}

function telemetrySample(batchId, sensorKey) {
  return {
    batchId,
    companyId: "gr",
    ovenId: "oven-15",
    sensorKey,
    sequence: 1,
    expectedTelemetryCount: 4,
    value: 50,
    quality: "good",
    sourceTimestamp: new Date().toISOString(),
  };
}

const completeHarness = createAggregatorHarness();
const sensorKeys = ["chamberTemp", "humidity", "furnaceTemp", "blowerTemp"];
sensorKeys.slice(0, -1).forEach((sensorKey) => {
  assert.equal(completeHarness.run(telemetrySample("complete", sensorKey)), null);
});
const completeBatch = completeHarness.run(telemetrySample("complete", sensorKeys.at(-1)));
assert.deepEqual(completeBatch.payload.updatedOvenIds, ["oven-15"]);
assert.equal(completeBatch.payload.telemetryQuality.missing, 0);
assert.equal(completeHarness.aggregatorContext.size, 0);

const partialHarness = createAggregatorHarness();
sensorKeys.slice(0, -1).forEach((sensorKey) => {
  assert.equal(partialHarness.run(telemetrySample("partial", sensorKey)), null);
});
assert.equal(partialHarness.callbacks.length, 1);
partialHarness.callbacks[0]();
assert.equal(partialHarness.sent.length, 1);
assert.deepEqual(partialHarness.sent[0].payload.updatedOvenIds, []);
assert.equal(partialHarness.sent[0].payload.telemetryQuality.missing, 1);
assert.equal(partialHarness.aggregatorContext.size, 0);

console.log("Node-RED flow validation passed.");
