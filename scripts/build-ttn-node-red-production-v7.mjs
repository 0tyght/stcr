import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const sourceIndex = process.argv.indexOf("--source");
const sourcePath =
  (sourceIndex >= 0 ? process.argv[sourceIndex + 1] : "") ||
  path.join(process.env.USERPROFILE || "", "Downloads", "flows (2).json");
const v6Path = path.join(root, "output", "node-red", "ttn-production-complete-v6.json");
const outputPath = path.join(root, "output", "node-red", "ttn-production-complete-v7.json");

const generated = spawnSync(
  process.execPath,
  [path.join(root, "scripts", "build-ttn-node-red-production-v6.mjs"), "--source", sourcePath],
  { cwd: root, encoding: "utf8" },
);
if (generated.status !== 0) throw new Error(generated.stderr || generated.stdout);

let raw = fs.readFileSync(v6Path, "utf8").replaceAll("stcr_v6_", "stcr_v7_");
raw = raw.replaceAll(" V6", " V7").replaceAll("(V6)", "(V7)");
const nodes = JSON.parse(raw);
const byId = (id) => nodes.find((node) => node.id === id);
const add = (...items) => nodes.push(...items);
const tab = "stcr_v7_acquisition";
const broker = byId("stcr_v7_mqtt_status").broker;

byId(tab).label = "STCR V7 · ข้อมูลเตา, Local Data และ MQTT";
byId(tab).info =
  "อ่าน PLC → ตรวจสอบข้อมูล → บันทึก SQLite → ส่งคิวเก่าไปใหม่ → รอ ACK จากเซิร์ฟเวอร์";

// The direct MQTT path is deliberately disconnected. Every message must be
// committed to SQLite before it is allowed to leave the factory computer.
byId("stcr_v7_status_in").wires = [["stcr_v7_queue_status_prepare"]];
byId("stcr_v7_sensor_in").wires = [["stcr_v7_queue_sensor_prepare"]];
byId("stcr_v7_mqtt_status").wires = [];
byId("stcr_v7_mqtt_sensor").wires = [];
byId("stcr_v7_mqtt_status").d = true;
byId("stcr_v7_mqtt_sensor").d = true;

const prepareFunction = (sourceTopic) => `let value = msg.payload;
if (Buffer.isBuffer(value)) value = value.toString("utf8");
if (typeof value === "string") {
    try { value = JSON.parse(value); }
    catch (error) {
        node.error("Payload ไม่ใช่ JSON ที่ถูกต้อง: " + error.message, msg);
        return null;
    }
}
if (!value || typeof value !== "object" || Array.isArray(value)) {
    node.error("Payload ต้องเป็น Object", msg);
    return null;
}
const oven = Number(value.oven);
const cycle = Number(value.cycle);
if (!Number.isSafeInteger(oven) || oven < 1 || oven > 9 ||
    !Number.isSafeInteger(cycle) || cycle < 0) {
    node.error("ข้อมูล oven หรือ cycle ไม่ถูกต้อง", msg);
    return null;
}
const createdAt = new Date().toISOString();
const messageId = [
    "ttn", ${JSON.stringify(sourceTopic)}, oven, cycle,
    Date.now(), Math.random().toString(36).slice(2, 10)
].join("-");
value._stcr_message_id = messageId;
value._stcr_captured_at = createdAt;
msg.params = {
    $message_id: messageId,
    $source_topic: ${JSON.stringify(sourceTopic)},
    $oven_number: oven,
    $cycle_number: cycle,
    $captured_at: createdAt,
    $payload_json: JSON.stringify(value)
};
msg.payload = value;
return msg;`;

const functionNode = (id, name, func, x, y, wires, group) => ({
  id,
  type: "function",
  z: tab,
  g: group,
  name,
  func,
  outputs: 1,
  timeout: 0,
  noerr: 0,
  initialize: "",
  finalize: "",
  libs: [],
  x,
  y,
  wires,
});
const sqliteNode = (id, name, sqlquery, sql, x, y, wires, group) => ({
  id,
  type: "sqlite",
  z: tab,
  g: group,
  mydb: "stcr_v7_queue_db",
  sqlquery,
  sql,
  name,
  x,
  y,
  wires,
});
const injectNode = (id, name, props, x, y, wires, group) => ({
  id,
  type: "inject",
  z: tab,
  g: group,
  name,
  props: [{ p: "payload" }, { p: "topic", vt: "str" }],
  repeat: "",
  crontab: "",
  once: false,
  onceDelay: 0.1,
  topic: "",
  payload: "",
  payloadType: "date",
  x,
  y,
  wires,
  ...props,
});

const queueGroup = "stcr_v7_local_queue_group";
const queueIds = [
  "stcr_v7_queue_status_prepare",
  "stcr_v7_queue_sensor_prepare",
  "stcr_v7_queue_insert",
  "stcr_v7_queue_poll",
  "stcr_v7_queue_select",
  "stcr_v7_queue_dispatch",
  "stcr_v7_queue_mark_inflight",
  "stcr_v7_queue_build_mqtt",
  "stcr_v7_queue_mqtt_out",
  "stcr_v7_queue_ack_in",
  "stcr_v7_queue_ack_parse",
  "stcr_v7_queue_mark_sent",
  "stcr_v7_queue_recover",
  "stcr_v7_queue_recover_sql",
  "stcr_v7_queue_cleanup",
  "stcr_v7_queue_cleanup_sql",
  "stcr_v7_queue_debug",
];

add(
  {
    id: queueGroup,
    type: "group",
    z: tab,
    name: "Local Data · เก็บก่อนส่งและส่งย้อนหลังอัตโนมัติ",
    style: { label: true, color: "#72540f", fill: "#fff4cf", fillOpacity: "0.55" },
    nodes: queueIds,
    x: 2480,
    y: 1260,
    w: 1380,
    h: 390,
  },
  {
    id: "stcr_v7_queue_db",
    type: "sqlitedb",
    db: "C:\\STCR\\data\\stcr-buffer.db",
    mode: "RWC",
  },
  functionNode(
    "stcr_v7_queue_status_prepare",
    "เตรียมสถานะลง Local Data",
    prepareFunction("test"),
    2610,
    1330,
    [["stcr_v7_queue_insert"]],
    queueGroup,
  ),
  functionNode(
    "stcr_v7_queue_sensor_prepare",
    "เตรียมเซนเซอร์ลง Local Data",
    prepareFunction("sensor"),
    2610,
    1380,
    [["stcr_v7_queue_insert"]],
    queueGroup,
  ),
  sqliteNode(
    "stcr_v7_queue_insert",
    "บันทึก SQLite ก่อนส่ง",
    "prepared",
    `INSERT OR IGNORE INTO stcr_outbox
      (message_id, source_topic, oven_number, cycle_number, captured_at, payload_json, status, attempts, created_at)
     VALUES
      ($message_id, $source_topic, $oven_number, $cycle_number, $captured_at, $payload_json, 'pending', 0, datetime('now'))`,
    2870,
    1355,
    [],
    queueGroup,
  ),
  injectNode(
    "stcr_v7_queue_poll",
    "ส่งคิวเก่าก่อน · ทุก 0.5 วินาที",
    { repeat: "0.5", once: true, onceDelay: 5 },
    2600,
    1470,
    [["stcr_v7_queue_select"]],
    queueGroup,
  ),
  sqliteNode(
    "stcr_v7_queue_select",
    "อ่านรายการค้างเก่าสุด",
    "fixed",
    `SELECT id, message_id, source_topic, payload_json
       FROM stcr_outbox
      WHERE status = 'pending'
      ORDER BY id ASC
      LIMIT 1`,
    2820,
    1470,
    [["stcr_v7_queue_dispatch"]],
    queueGroup,
  ),
  functionNode(
    "stcr_v7_queue_dispatch",
    "ล็อกรายการก่อนส่ง",
    `const row = Array.isArray(msg.payload) ? msg.payload[0] : null;
if (!row) return null;
msg.stcrQueueRow = row;
msg.params = {
    $message_id: row.message_id,
    $attempted_at: new Date().toISOString()
};
return msg;`,
    3020,
    1470,
    [["stcr_v7_queue_mark_inflight"]],
    queueGroup,
  ),
  sqliteNode(
    "stcr_v7_queue_mark_inflight",
    "เปลี่ยนเป็นกำลังส่ง",
    "prepared",
    `UPDATE stcr_outbox
        SET status = 'inflight',
            attempts = attempts + 1,
            last_attempt_at = $attempted_at
      WHERE message_id = $message_id
        AND status = 'pending'`,
    3210,
    1470,
    [["stcr_v7_queue_build_mqtt"]],
    queueGroup,
  ),
  functionNode(
    "stcr_v7_queue_build_mqtt",
    "สร้างข้อความ MQTT จากคิว",
    `const row = msg.stcrQueueRow;
if (!row) return null;
msg.topic = row.source_topic;
msg.qos = 1;
msg.retain = false;
msg.payload = row.payload_json;
return msg;`,
    3405,
    1470,
    [["stcr_v7_queue_mqtt_out"]],
    queueGroup,
  ),
  {
    id: "stcr_v7_queue_mqtt_out",
    type: "mqtt out",
    z: tab,
    g: queueGroup,
    name: "ส่ง MQTT ตามลำดับ",
    topic: "",
    qos: "1",
    retain: "false",
    respTopic: "",
    contentType: "application/json",
    userProps: "",
    correl: "",
    expiry: "",
    broker,
    x: 3620,
    y: 1470,
    wires: [],
  },
  {
    id: "stcr_v7_queue_ack_in",
    type: "mqtt in",
    z: tab,
    g: queueGroup,
    name: "รับ ACK หลังเซิร์ฟเวอร์บันทึก",
    topic: "stcr/ack/ttn",
    qos: "1",
    datatype: "auto-detect",
    broker,
    nl: false,
    rap: true,
    rh: 0,
    inputs: 0,
    x: 2605,
    y: 1550,
    wires: [["stcr_v7_queue_ack_parse"]],
  },
  functionNode(
    "stcr_v7_queue_ack_parse",
    "ตรวจ ACK",
    `let value = msg.payload;
if (Buffer.isBuffer(value)) value = value.toString("utf8");
if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
}
const messageId = String(value?.messageId || "").trim();
if (!/^[A-Za-z0-9._:-]{16,160}$/.test(messageId)) return null;
msg.params = {
    $message_id: messageId,
    $acked_at: new Date().toISOString()
};
return msg;`,
    2820,
    1550,
    [["stcr_v7_queue_mark_sent"]],
    queueGroup,
  ),
  sqliteNode(
    "stcr_v7_queue_mark_sent",
    "ยืนยันส่งสำเร็จ",
    "prepared",
    `UPDATE stcr_outbox
        SET status = 'sent',
            acked_at = $acked_at,
            last_error = NULL
      WHERE message_id = $message_id`,
    3020,
    1550,
    [["stcr_v7_queue_debug"]],
    queueGroup,
  ),
  injectNode(
    "stcr_v7_queue_recover",
    "กู้รายการค้าง · ทุก 30 วินาที",
    { repeat: "30", once: true, onceDelay: 3 },
    3290,
    1550,
    [["stcr_v7_queue_recover_sql"]],
    queueGroup,
  ),
  sqliteNode(
    "stcr_v7_queue_recover_sql",
    "นำรายการไม่มี ACK กลับเข้าคิว",
    "fixed",
    `UPDATE stcr_outbox
        SET status = 'pending'
      WHERE status = 'inflight'
        AND datetime(last_attempt_at) < datetime('now', '-30 seconds')`,
    3540,
    1550,
    [],
    queueGroup,
  ),
  injectNode(
    "stcr_v7_queue_cleanup",
    "ลบข้อมูลส่งแล้ว · ทุก 1 ชั่วโมง",
    { repeat: "3600", once: true, onceDelay: 30 },
    3300,
    1610,
    [["stcr_v7_queue_cleanup_sql"]],
    queueGroup,
  ),
  sqliteNode(
    "stcr_v7_queue_cleanup_sql",
    "เก็บข้อมูลส่งแล้ว 7 วัน",
    "fixed",
    `DELETE FROM stcr_outbox
      WHERE status = 'sent'
        AND datetime(acked_at) < datetime('now', '-7 days')`,
    3540,
    1610,
    [],
    queueGroup,
  ),
  {
    id: "stcr_v7_queue_debug",
    type: "debug",
    z: tab,
    g: queueGroup,
    name: "ผล ACK Local Data",
    active: false,
    tosidebar: true,
    console: false,
    tostatus: true,
    complete: "payload",
    targetType: "msg",
    statusVal: "payload",
    statusType: "auto",
    x: 3240,
    y: 1605,
    wires: [],
  },
);

const initGroup = "stcr_v7_local_init_group";
const initIds = [
  "stcr_v7_queue_init",
  "stcr_v7_queue_pragma_wal",
  "stcr_v7_queue_pragma_sync",
  "stcr_v7_queue_create",
  "stcr_v7_queue_index",
  "stcr_v7_queue_startup_recover",
];
add(
  {
    id: initGroup,
    type: "group",
    z: tab,
    name: "เริ่ม Local Data อัตโนมัติเมื่อ Node-RED เปิด",
    style: { label: true, color: "#2f855a", fill: "#e8f7ef", fillOpacity: "0.55" },
    nodes: initIds,
    x: 2480,
    y: 1680,
    w: 1380,
    h: 130,
  },
  injectNode(
    "stcr_v7_queue_init",
    "เริ่มฐานคิวเมื่อเปิด Node-RED",
    { once: true, onceDelay: 0.5 },
    2610,
    1745,
    [["stcr_v7_queue_pragma_wal"]],
    initGroup,
  ),
  sqliteNode(
    "stcr_v7_queue_pragma_wal",
    "เปิด WAL",
    "fixed",
    "PRAGMA journal_mode=WAL",
    2800,
    1745,
    [["stcr_v7_queue_pragma_sync"]],
    initGroup,
  ),
  sqliteNode(
    "stcr_v7_queue_pragma_sync",
    "ป้องกันข้อมูลหายเมื่อไฟดับ",
    "fixed",
    "PRAGMA synchronous=FULL",
    2985,
    1745,
    [["stcr_v7_queue_create"]],
    initGroup,
  ),
  sqliteNode(
    "stcr_v7_queue_create",
    "สร้างตาราง Local Data",
    "fixed",
    `CREATE TABLE IF NOT EXISTS stcr_outbox (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       message_id TEXT NOT NULL UNIQUE,
       source_topic TEXT NOT NULL,
       oven_number INTEGER NOT NULL,
       cycle_number INTEGER NOT NULL,
       captured_at TEXT NOT NULL,
       payload_json TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'pending',
       attempts INTEGER NOT NULL DEFAULT 0,
       last_attempt_at TEXT,
       acked_at TEXT,
       last_error TEXT,
       created_at TEXT NOT NULL
     )`,
    3180,
    1745,
    [["stcr_v7_queue_index"]],
    initGroup,
  ),
  sqliteNode(
    "stcr_v7_queue_index",
    "สร้างดัชนีคิว",
    "fixed",
    "CREATE INDEX IF NOT EXISTS idx_stcr_outbox_status_id ON stcr_outbox(status, id)",
    3375,
    1745,
    [["stcr_v7_queue_startup_recover"]],
    initGroup,
  ),
  sqliteNode(
    "stcr_v7_queue_startup_recover",
    "กู้คิวหลังรีสตาร์ต",
    "fixed",
    "UPDATE stcr_outbox SET status = 'pending' WHERE status = 'inflight'",
    3570,
    1745,
    [],
    initGroup,
  ),
);

// Expand the main tab groups list and keep legacy direct MQTT nodes visible but disabled.
const mqttGroup = byId("stcr_v7_mqtt_group");
mqttGroup.name = "ทางส่งตรงเดิม · ปิดไว้เพราะ V7 ใช้ Local Data";

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(nodes, null, 2)}\n`, "utf8");
console.log(`Created ${outputPath}`);
console.log(`Nodes=${nodes.length}, SQLite nodes=${nodes.filter((node) => node.type === "sqlite").length}`);
