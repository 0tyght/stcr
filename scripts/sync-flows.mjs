import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const flows = JSON.parse(read("node-red/flows.json"));
const adapter    = read("node-red/functions/factory-mqtt-adapter.js");
const dbWriter   = read("node-red/functions/factory-mqtt-db-writer.js");
const subInit    = read("node-red/functions/factory-mqtt-subscriber-init.js");
const subFinal   = read("node-red/functions/factory-mqtt-subscriber-finalize.js");
const inspection = read("node-red/functions/factory-mqtt-inspection.js");
const router     = read("node-red/functions/api-router.js");

// เพิ่ม db-writer node ถ้ายังไม่มี
const hasDbWriter = flows.some((n) => n.id === "stcr-factory-mqtt-db-writer");
if (!hasDbWriter) {
  flows.push({
    id: "stcr-factory-mqtt-db-writer",
    type: "function",
    z: "stcr-factory-mqtt-tab",
    name: "เขียนข้อมูล MQTT ลง MySQL โดยตรง",
    func: dbWriter,
    outputs: 1,
    timeout: 0,
    noerr: 0,
    initialize: "",
    finalize: "",
    libs: [
      { var: "mysql",  module: "mysql2/promise" },
      { var: "crypto", module: "crypto" },
    ],
    x: 980,
    y: 160,
    wires: [[]],
  });
} else {
  const node = flows.find((n) => n.id === "stcr-factory-mqtt-db-writer");
  node.func = dbWriter;
}

for (const node of flows) {
  if (node.id === "stcr-api-router") {
    node.func = router;
  }
  if (node.id === "stcr-factory-mqtt-adapter") {
    node.func    = adapter;
    node.outputs = 1;
    // ส่งไป inspection (debug) และ db-writer พร้อมกัน
    node.wires   = [["stcr-factory-mqtt-inspection", "stcr-factory-mqtt-db-writer"]];
    node.libs    = [];
  }
  if (node.id === "stcr-factory-mqtt-subscriber") {
    node.initialize = subInit;
    node.finalize   = subFinal;
    if (!node.libs) node.libs = [];
    if (!node.libs.some((l) => l.module === "mqtt"))           node.libs.push({ var: "mqtt",  module: "mqtt" });
    if (!node.libs.some((l) => l.module === "mysql2/promise")) node.libs.push({ var: "mysql", module: "mysql2/promise" });
  }
  if (node.id === "stcr-factory-mqtt-inspection") {
    node.func = inspection;
  }
  if (node.id === "stcr-factory-mqtt-note") {
    node.info = "รับ Topic test และ sensor เขียน MySQL โดยตรง ไม่ผ่าน HTTP self-call";
  }
}

// ลบ http request node ที่ไม่ใช้แล้ว
const cleaned = flows.filter((n) => n.id !== "stcr-factory-mqtt-http");

writeFileSync(join(root, "node-red/flows.json"), JSON.stringify(cleaned, null, 2) + "\n", "utf8");
console.log(`flows.json synced — ${cleaned.length} nodes`);
