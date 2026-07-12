import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const simulator = await readFile(join(root, "functions", "simulator.js"), "utf8");
const router = await readFile(join(root, "functions", "api-router.js"), "utf8");

const tabId = "stcr-simulator-tab";
const routerId = "stcr-api-router";
const responseId = "stcr-http-response";

const endpoints = [
  ["get", "/stcr/api/health", "Health"],
  ["get", "/stcr/api/ovens", "All ovens"],
  ["get", "/stcr/api/ovens/:ovenId", "Oven detail"],
  ["get", "/stcr/api/ovens/:ovenId/history", "History"],
  ["get", "/stcr/api/ovens/:ovenId/export.csv", "CSV export"],
  ["get", "/stcr/api/alarms", "Alarms"],
  ["get", "/stcr/api/audit-events", "Audit events"],
  ["put", "/stcr/api/ovens/:ovenId/limits", "Save limits"],
  ["patch", "/stcr/api/ovens/:ovenId", "Update oven"],
  ["post", "/stcr/api/ovens", "Add oven"],
  ["post", "/stcr/api/alarms/:alarmId/acknowledge", "Acknowledge alarm"],
  ["options", "/stcr/api/*", "CORS preflight"],
];

const nodes = [
  {
    id: tabId,
    type: "tab",
    label: "STCR Realtime Simulator",
    disabled: false,
    info: "Realtime oven simulator and REST API for the STCR React application.",
  },
  {
    id: "stcr-simulator-tick",
    type: "inject",
    z: tabId,
    name: "Initialize / tick every 5s",
    props: [{ p: "payload" }, { p: "topic", vt: "str" }],
    repeat: "5",
    crontab: "",
    once: true,
    onceDelay: "0.2",
    topic: "stcr/tick",
    payload: "",
    payloadType: "date",
    x: 170,
    y: 80,
    wires: [["stcr-simulator-core"]],
  },
  {
    id: "stcr-simulator-core",
    type: "function",
    z: tabId,
    name: "Realtime oven simulator",
    func: simulator,
    outputs: 1,
    timeout: 0,
    noerr: 0,
    initialize: "",
    finalize: "",
    libs: [],
    x: 430,
    y: 80,
    wires: [[]],
  },
  ...endpoints.map(([method, url, name], index) => ({
    id: `stcr-http-${index + 1}`,
    type: "http in",
    z: tabId,
    name,
    url,
    method,
    upload: false,
    swaggerDoc: "",
    x: 170,
    y: 160 + index * 42,
    wires: [[routerId]],
  })),
  {
    id: routerId,
    type: "function",
    z: tabId,
    name: "STCR API router",
    func: router,
    outputs: 1,
    timeout: 0,
    noerr: 0,
    initialize: "",
    finalize: "",
    libs: [],
    x: 510,
    y: 390,
    wires: [[responseId]],
  },
  {
    id: responseId,
    type: "http response",
    z: tabId,
    name: "HTTP response",
    statusCode: "",
    headers: {},
    x: 760,
    y: 390,
    wires: [],
  },
  {
    id: "stcr-flow-note",
    type: "comment",
    z: tabId,
    name: "Import, Deploy, then open http://127.0.0.1:1880/stcr/api/health",
    info: "Set VITE_DATA_SOURCE=node-red and VITE_API_BASE_URL=http://127.0.0.1:1880/stcr/api in the React app.",
    x: 330,
    y: 40,
    wires: [],
  },
];

await writeFile(join(root, "flows.json"), `${JSON.stringify(nodes, null, 2)}\n`, "utf8");
console.log(`Generated node-red/flows.json with ${nodes.length} nodes.`);
