import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceIndex = process.argv.indexOf("--source");
const outputIndex = process.argv.indexOf("--output");
const sourcePath =
  (sourceIndex >= 0 ? process.argv[sourceIndex + 1] : "") ||
  path.join(root, "output", "node-red", "gr-production-complete-v9.json");
const outputPath =
  (outputIndex >= 0 ? process.argv[outputIndex + 1] : "") || sourcePath;

const nodes = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
if (!Array.isArray(nodes)) throw new Error("Node-RED flow must be an array");

const byId = (id) => nodes.find((node) => node.id === id);
const requireNode = (id) => {
  const node = byId(id);
  if (!node) throw new Error(`Missing GR Node-RED node: ${id}`);
  return node;
};

const group = requireNode("30edb330dbe01b19");
const mqttOut = requireNode("7505da8b73a8e321");
const dispatch = requireNode("c437732590afbaad");
const pubackComplete = requireNode("a8e96077110c4f75");
const pubackPrepare = requireNode("5e95efe0fa96a568");
const markSent = requireNode("1432d716d576c39d");
const recoverTick = requireNode("f0c2fcd12c0677ae");
const recoverSql = requireNode("cc730d73f2747b3a");

const tab = mqttOut.z;
const broker = mqttOut.broker;
const ackInId = "stcr_gr_db_ack_in";
const ackParseId = "stcr_gr_db_ack_parse";
const recoverPrepareId = "stcr_gr_db_ack_recover_prepare";

for (const id of [ackInId, ackParseId, recoverPrepareId]) {
  const existingIndex = nodes.findIndex((node) => node.id === id);
  if (existingIndex >= 0) nodes.splice(existingIndex, 1);
}

group.name = "7 · Local Data เก็บก่อนส่ง · ยืนยันหลัง MySQL บันทึก";
group.nodes = [
  ...new Set([
    ...(group.nodes || []).filter(
      (id) => ![ackInId, ackParseId, recoverPrepareId].includes(id),
    ),
    ackInId,
    ackParseId,
    recoverPrepareId,
  ]),
];

dispatch.func = `const row = Array.isArray(msg.payload) ? msg.payload[0] : null;
if (!row) {
    flow.set("stcr_gr_v7_queue_busy", 0);
    flow.set("stcr_gr_v7_queue_inflight_id", "");
    return null;
}
flow.set("stcr_gr_v7_queue_inflight_id", String(row.message_id || ""));
msg.stcrQueueRow = row;
msg.params = {
    $message_id: row.message_id,
    $attempted_at: new Date().toISOString()
};
return msg;`;

pubackComplete.d = true;
pubackComplete.name = "ปิดใช้ · PUBACK ไม่ยืนยันการบันทึก MySQL";
pubackComplete.wires = [];
pubackPrepare.d = true;
pubackPrepare.name = "ปิดใช้ · รอ ACK จากฐานข้อมูลแทน";
pubackPrepare.wires = [];

markSent.name = "ยืนยันส่งสำเร็จหลัง MySQL บันทึก";
recoverTick.name = "กู้รายการไม่มี DB ACK · ทุก 30 วินาที";
recoverTick.wires = [[recoverPrepareId]];
recoverSql.name = "นำรายการไม่มี DB ACK กลับเข้าคิว";

nodes.push(
  {
    id: ackInId,
    type: "mqtt in",
    z: tab,
    g: group.id,
    name: "รับ ACK หลัง MySQL บันทึก",
    topic: "stcr/ack/gr",
    qos: "1",
    datatype: "auto-detect",
    broker,
    nl: false,
    rap: true,
    rh: 0,
    inputs: 0,
    x: 40,
    y: 2530,
    wires: [[ackParseId]],
  },
  {
    id: ackParseId,
    type: "function",
    z: tab,
    g: group.id,
    name: "ตรวจ DB ACK และปลดคิว",
    func: `let value = msg.payload;
if (Buffer.isBuffer(value)) value = value.toString("utf8");
if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
}
const messageId = String(value?.messageId || "").trim();
if (!/^[A-Za-z0-9._:-]{16,160}$/.test(messageId)) return null;
if (String(value?.companyId || "").toLowerCase() !== "gr") return null;
const inflightId = String(flow.get("stcr_gr_v7_queue_inflight_id") || "");
if (inflightId === messageId) {
    flow.set("stcr_gr_v7_queue_busy", 0);
    flow.set("stcr_gr_v7_queue_inflight_id", "");
}
msg.params = {
    $message_id: messageId,
    $acked_at: new Date().toISOString()
};
return msg;`,
    outputs: 1,
    timeout: 0,
    noerr: 0,
    initialize: "",
    finalize: "",
    libs: [],
    x: 300,
    y: 2530,
    wires: [[markSent.id]],
  },
  {
    id: recoverPrepareId,
    type: "function",
    z: tab,
    g: group.id,
    name: "ปลดล็อกคิวเมื่อ DB ACK หาย",
    func: `flow.set("stcr_gr_v7_queue_busy", 0);
flow.set("stcr_gr_v7_queue_inflight_id", "");
return msg;`,
    outputs: 1,
    timeout: 0,
    noerr: 0,
    initialize: "",
    finalize: "",
    libs: [],
    x: 1490,
    y: 2530,
    wires: [[recoverSql.id]],
  },
);

const ids = new Set();
for (const node of nodes) {
  if (!node.id || ids.has(node.id)) throw new Error(`Duplicate or missing node id: ${node.id}`);
  ids.add(node.id);
}
for (const node of nodes) {
  for (const output of node.wires || []) {
    for (const target of output) {
      if (!ids.has(target)) throw new Error(`Missing wire target ${target} from ${node.id}`);
    }
  }
}

if (!pubackComplete.d || pubackComplete.wires.flat().length) {
  throw new Error("Broker PUBACK path must remain disabled");
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(nodes, null, 2)}\n`, "utf8");
console.log(`Updated ${outputPath}`);
console.log("GR delivery confirmation=MySQL ACK, retry timeout=30 seconds");
