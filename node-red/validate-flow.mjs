import assert from "node:assert/strict";
import crypto from "node:crypto";
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
const httpPublisherSource = await readFile(join(root, "functions", "http-telemetry-publisher.js"), "utf8");
const schemaSource = await readFile(join(root, "..", "database", "schema.sql"), "utf8");
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
const nodeWarnings = [];
const node = { status: () => undefined, warn: (message) => nodeWarnings.push(String(message)) };

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
const gatewayContextMap = new Map();
const gatewayContext = {
  get: (key) => gatewayContextMap.get(key),
  set: (key, value) => gatewayContextMap.set(key, value),
};
const runGateway = new Function("msg", "context", "global", "node", gatewaySource);
const gatewaySample = structuredClone(telemetryOutputs[0][0]);
const acceptedGatewaySample = runGateway(gatewaySample, gatewayContext, globalApi, node);
assert.ok(acceptedGatewaySample, "Known telemetry source must pass gateway identity checks");
assert.equal(
  runGateway(structuredClone(telemetryOutputs[0][0]), gatewayContext, globalApi, node),
  null,
  "Repeated sensor sequence must be rejected as replay",
);
const spoofedGatewaySample = structuredClone(telemetryOutputs[0][0]);
spoofedGatewaySample.payload.ovenId = "oven-999";
assert.equal(
  runGateway(spoofedGatewaySample, gatewayContext, globalApi, node),
  null,
  "Unknown oven identity must be rejected",
);
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
const testPassword = "contract-test-password";
const testSalt = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const testHash = crypto.argon2Sync("argon2id", {
  message: testPassword,
  nonce: testSalt,
  parallelism: 1,
  tagLength: 32,
  memory: 19456,
  passes: 2,
}).toString("hex");
const encodedTestHash = `argon2id$v=19$m=19456,t=2,p=1$${testSalt.toString("hex")}$${testHash}`;
const ingestPepper = "contract-test-api-key-pepper-32-characters";
const grIngestKey = "stcr_gr_contract_test_key_abcdefghijklmnopqrstuvwxyz012345";
const grIngestHash = crypto.createHmac("sha256", ingestPepper).update(grIngestKey).digest("hex");
const databaseUsers = {
  gr_dev_admin: { id: 1, companyId: "gr", username: "gr_dev_admin" },
  ttn_dev_admin: { id: 2, companyId: "ttn", username: "ttn_dev_admin" },
};
const envValues = new Map([
  ["STCR_ALLOWED_ORIGINS", "http://127.0.0.1:5173"],
  ["STCR_API_KEY_PEPPER", ingestPepper],
  ["STCR_DB_PASSWORD", "contract-test-database-password"],
]);
const env = { get: (key) => envValues.get(key) };
const mockConnection = {
  beginTransaction: async () => {},
  commit: async () => {},
  rollback: async () => {},
  release: () => {},
  execute: async (sql, params) => {
    if (/SELECT id FROM ovens/.test(sql)) {
      return [params[0] === "gr" && params[1] === "oven-18" ? [{ id: "oven-18" }] : []];
    }
    if (/SELECT id, state FROM oven_cycles/.test(sql)) return [[{ id: 83, state: "recording" }]];
    return [{ affectedRows: 1 }];
  },
};
const mockPool = {
  execute: async (sql, params = []) => {
    if (/FROM users u/.test(sql)) {
      const user = databaseUsers[params[0]];
      return [user ? [{
        ...user,
        displayName: user.username,
        passwordHash: encodedTestHash,
        passwordAlgorithm: "argon2id",
        status: "active",
        failedLoginCount: 0,
        lockedUntil: null,
        roleCodes: "admin",
      }] : []];
    }
    if (/SELECT id FROM users/.test(sql)) {
      const user = Object.values(databaseUsers).find((item) => item.id === params[0]);
      return [user && user.companyId === params[1] && user.username === params[2] ? [{ id: user.id }] : []];
    }
    if (/FROM api_keys/.test(sql)) {
      return [params[0] === "gr" && params[1] === grIngestKey.slice(0, 16)
        ? [{ id: 10, companyId: "gr", allowedOvenId: null, keyHash: grIngestHash }]
        : []];
    }
    if (/FROM oven_cycles/.test(sql)) {
      return [params[0] === "gr" && params[1] === "oven-18" && params[2] === 83
        ? [{
          rubberType: "latex",
          smokingPeriodStatus: "under",
          temperatureControlStatus: "underControl",
          reason: null,
          inputNetWeightKg: "12500.000",
          outputNetWeightKg: "8100.000",
          firewoodWeightKg: "2400.000",
        }]
        : []];
    }
    if (/UPDATE users/.test(sql)) return [{ affectedRows: 1 }];
    if (/UPDATE oven_cycles/.test(sql)) {
      return [{ affectedRows: params[7] === "gr" && params[8] === "oven-18" ? 1 : 0 }];
    }
    throw new Error("Database fallback in contract test");
  },
  query: async () => { throw new Error("Database history fallback in contract test"); },
  getConnection: async () => mockConnection,
};
const mysql = { createPool: () => mockPool };
const runRouter = new AsyncFunction(
  "msg", "flow", "global", "node", "context", "env", "mysql", "crypto", routerSource,
);
const callRouter = (request) => runRouter(request, flow, globalApi, node, contextApi, env, mysql, crypto);

const health = await callRouter(
  { req: { method: "GET", path: "/stcr/api/health", query: {} } },
);
assert.equal(health.statusCode, 200);
assert.equal(health.payload.ok, true);
assert.equal(health.payload.sources, undefined, "Public health response must not expose tenant names");

const unauthorized = await callRouter(
  { req: { method: "GET", path: "/stcr/api/ovens", query: {}, headers: {} } },
);
assert.equal(unauthorized.statusCode, 401);

const login = await callRouter({
  req: { method: "POST", path: "/stcr/api/auth/login", query: {}, headers: {} },
  payload: { username: "gr_dev_admin", password: testPassword },
});
assert.equal(login.statusCode, 200);
assert.equal(login.payload.companyId, "gr");
assert.match(login.payload.token, /^[a-f0-9]{64}$/);
const grAuthHeaders = { authorization: `Bearer ${login.payload.token}` };

const ttnLogin = await callRouter({
  req: { method: "POST", path: "/stcr/api/auth/login", query: {}, headers: {} },
  payload: { username: "ttn_dev_admin", password: testPassword },
});
const ttnAuthHeaders = { authorization: `Bearer ${ttnLogin.payload.token}` };

const ovens = await callRouter(
  { req: { method: "GET", path: "/stcr/api/ovens", query: {}, headers: grAuthHeaders } },
);
assert.equal(ovens.payload.length, 16);

const ttnOvens = await callRouter(
  { req: { method: "GET", path: "/stcr/api/ovens", query: { companyId: "ttn" }, headers: ttnAuthHeaders } },
);
assert.equal(ttnOvens.payload.length, 10);
assert.equal(ttnOvens.payload[0].number, 1);
assert.equal(ttnOvens.payload[0].zone, "TTN");

const tenantEscape = await callRouter(
  { req: { method: "GET", path: "/stcr/api/ovens", query: { companyId: "ttn" }, headers: grAuthHeaders } },
);
assert.equal(tenantEscape.statusCode, 403, "Authenticated GR user must not access TTN");

const telemetryReadings = [
  ["chamberTemp", 56.2, "C"],
  ["humidity", 70.1, "%"],
  ["furnaceTemp", 500, "C"],
  ["blowerTemp", 365, "C"],
].map(([sensorKey, value, unit], index) => ({
  sensorKey,
  sensorId: `gr-oven-18-${sensorKey}`,
  sequence: 100 + index,
  value,
  rawValue: value,
  unit,
  quality: "good",
  qualityReasons: [],
  sourceTimestamp: new Date().toISOString(),
}));
const acceptedTelemetry = await callRouter({
  req: { method: "POST", path: "/stcr/api/telemetry", query: {}, headers: { "x-api-key": grIngestKey } },
  payload: {
    companyId: "gr",
    ovenId: "oven-18",
    batchId: "contract-batch-1",
    deviceId: "gr-oven-18-gateway",
    readings: telemetryReadings,
  },
});
assert.equal(acceptedTelemetry.statusCode, 202, nodeWarnings.at(-1));
assert.equal(acceptedTelemetry.payload.companyId, "gr");

const crossCompanyTelemetry = await callRouter({
  req: { method: "POST", path: "/stcr/api/telemetry", query: {}, headers: { "x-api-key": grIngestKey } },
  payload: {
    companyId: "ttn",
    ovenId: "oven-1",
    batchId: "contract-batch-cross-company",
    deviceId: "ttn-oven-1-gateway",
    readings: telemetryReadings.map((reading) => ({ ...reading, sensorId: reading.sensorId.replace("gr-oven-18", "ttn-oven-1") })),
  },
});
assert.equal(crossCompanyTelemetry.statusCode, 401, "GR API key must not ingest TTN telemetry");

const savedReportMeta = await callRouter({
  req: {
    method: "PUT",
    path: "/stcr/api/ovens/oven-18/cycles/83/report-meta",
    query: {},
    headers: grAuthHeaders,
  },
  payload: {
    rubberType: "latex",
    smokingPeriodStatus: "under",
    temperatureControlStatus: "underControl",
    reason: null,
    inputNetWeightKg: 12500,
    outputNetWeightKg: 8100,
    firewoodWeightKg: 2400,
  },
});
assert.equal(savedReportMeta.statusCode, 200);
assert.equal(savedReportMeta.payload.ok, true);

const loadedReportMeta = await callRouter({
  req: {
    method: "GET",
    path: "/stcr/api/ovens/oven-18/cycles/83/report-meta",
    query: {},
    headers: grAuthHeaders,
  },
});
assert.equal(loadedReportMeta.statusCode, 200);
assert.equal(loadedReportMeta.payload.rubberType, "latex");
assert.equal(loadedReportMeta.payload.firewoodWeightKg, 2400);

const crossCompanyReportMeta = await callRouter({
  req: {
    method: "PUT",
    path: "/stcr/api/ovens/oven-1/cycles/83/report-meta",
    query: {},
    headers: grAuthHeaders,
  },
  payload: { rubberType: "latex" },
});
assert.equal(crossCompanyReportMeta.statusCode, 404, "GR session must not update a TTN oven cycle");

const history = await callRouter(
  {
    req: {
      method: "GET",
      path: "/stcr/api/ovens/oven-18/history",
      query: { cycleNumber: "83" },
      headers: grAuthHeaders,
    },
  },
);
assert.ok(history.payload.length > 10);
assert.deepEqual(
  Object.keys(history.payload[0]),
  ["timestamp", "chamberTemp", "humidity", "furnaceTemp", "blowerTemp"],
);

const requiredPaths = [
  "/stcr/api/health",
  "/stcr/api/auth/login",
  "/stcr/api/auth/logout",
  "/stcr/api/telemetry",
  "/stcr/api/ovens",
  "/stcr/api/ovens/:ovenId/history",
  "/stcr/api/ovens/:ovenId/cycles/:cycleNumber/report-meta",
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
const apiRouterNode = flows.find((item) => item.id === "stcr-api-router");
assert.deepEqual(apiRouterNode.libs, [
  { var: "mysql", module: "mysql2/promise" },
  { var: "crypto", module: "crypto" },
]);
assert.equal(flows.filter((item) => /stcr-(gr|ttn)-http-publisher/.test(item.id || "")).length, 2);
assert.equal(flows.filter((item) => /stcr-(gr|ttn)-http-request/.test(item.id || "")).length, 2);
assert.match(persistenceSource, /INSERT INTO sensor_readings/);
assert.match(persistenceSource, /included_in_report/);
assert.match(persistenceSource, /INSERT INTO telemetry_events/);
assert.match(persistenceSource, /dbBackfill:/);
assert.match(persistenceSource, /INSERT IGNORE INTO sensor_readings/);
assert.match(persistenceSource, /persistArchivedCycle/);
assert.match(persistenceSource, /dbArchive:/);
assert.match(persistenceSource, /SET time_zone = '\+00:00'/);
assert.match(routerSource, /includeIgnition/);
assert.match(routerSource, /argon2Sync\("argon2id"/);
assert.match(routerSource, /FROM api_keys/);
assert.match(routerSource, /apiKey\.startsWith\(`stcr_\$\{companyId\}_`\)/);
assert.match(routerSource, /WHERE company_id=\? AND id=\?/);
assert.match(httpPublisherSource, /60 \* 1000/);
assert.match(httpPublisherSource, /STCR_GR_INGEST_API_KEY/);
assert.match(httpPublisherSource, /STCR_TTN_INGEST_API_KEY/);
assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS users/);
assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS api_keys/);
assert.match(schemaSource, /firewood_weight_kg DECIMAL\(12,3\)/);
assert.match(routerSource, /WHERE company_id=\? AND oven_id=\? AND cycle_number=\?/);
assert.match(schemaSource, /'gr', 'F01-05-05 R07', '22\/06\/67'/);
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
