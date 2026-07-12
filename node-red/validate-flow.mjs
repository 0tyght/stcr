import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const flows = JSON.parse(await readFile(join(root, "flows.json"), "utf8"));
const simulatorSource = await readFile(join(root, "functions", "simulator.js"), "utf8");
const routerSource = await readFile(join(root, "functions", "api-router.js"), "utf8");

const context = new Map();
const flow = {
  get: (key) => context.get(key),
  set: (key, value) => context.set(key, value),
};
const node = { status: () => undefined };

const runSimulator = new Function("msg", "flow", "node", simulatorSource);
runSimulator({ payload: Date.now() }, flow, node);

const state = flow.get("stcrState");
assert.ok(state, "Simulator must initialize stcrState");
assert.equal(state.ovens.length, 16, "Simulator must create ovens 11-26");
assert.equal(state.ovens[0].number, 11);
assert.equal(state.ovens[15].number, 26);
assert.ok(state.history["oven-18"].length > 1000, "History seed must cover more than one cycle");
assert.equal(state.ovens.find((oven) => oven.id === "oven-18").cycleCount, 83);

const runRouter = new Function("msg", "flow", "node", routerSource);

const health = runRouter(
  { req: { method: "GET", path: "/stcr/api/health", query: {} } },
  flow,
  node,
);
assert.equal(health.statusCode, 200);
assert.equal(health.payload.ok, true);

const ovens = runRouter(
  { req: { method: "GET", path: "/stcr/api/ovens", query: {} } },
  flow,
  node,
);
assert.equal(ovens.payload.length, 16);

const history = runRouter(
  {
    req: {
      method: "GET",
      path: "/stcr/api/ovens/oven-18/history",
      query: {},
    },
  },
  flow,
  node,
);
assert.ok(history.payload.length > 1000);
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

console.log("Node-RED flow validation passed.");
