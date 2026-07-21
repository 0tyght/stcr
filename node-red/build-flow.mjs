import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const router = await readFile(join(root, "functions", "api-router.js"), "utf8");
const subscriberInit = await readFile(join(root, "functions", "factory-mqtt-subscriber-init.js"), "utf8");
const subscriberFinalize = await readFile(join(root, "functions", "factory-mqtt-subscriber-finalize.js"), "utf8");
const adapter = await readFile(join(root, "functions", "factory-mqtt-adapter.js"), "utf8");
const inspection = await readFile(join(root, "functions", "factory-mqtt-inspection.js"), "utf8");

const platformTabId = "stcr-platform-tab";
const mqttTabId = "stcr-factory-mqtt-tab";
const routerId = "stcr-api-router";
const responseId = "stcr-http-response";
const endpoints = [
  ["get", "/stcr/api/health", "ตรวจสอบสถานะระบบ"],
  ["post", "/stcr/api/auth/login", "เข้าสู่ระบบ"],
  ["post", "/stcr/api/auth/logout", "ออกจากระบบ"],
  ["post", "/stcr/api/telemetry", "รับข้อมูล IoT ด้วย API Key"],
  ["post", "/stcr/api/factory-mqtt/raw", "เก็บ Payload MQTT ต้นฉบับ"],
  ["get", "/stcr/api/ovens", "ข้อมูลเตาทั้งหมด"],
  ["get", "/stcr/api/ovens/:ovenId", "รายละเอียดเตา"],
  ["get", "/stcr/api/ovens/:ovenId/history", "ข้อมูลย้อนหลัง"],
  ["get", "/stcr/api/ovens/:ovenId/export.csv", "ส่งออก CSV"],
  ["get", "/stcr/api/ovens/:ovenId/cycles/:cycleNumber/report-meta", "ข้อมูลรอบรายงาน"],
  ["get", "/stcr/api/alarms", "รายการแจ้งเตือน"],
  ["get", "/stcr/api/audit-events", "ประวัติการใช้งาน"],
  ["get", "/stcr/api/report-document-meta", "อ่านข้อมูลเอกสารรายงาน"],
  ["put", "/stcr/api/report-document-meta", "บันทึกข้อมูลเอกสารรายงาน"],
  ["put", "/stcr/api/ovens/:ovenId/cycles/:cycleNumber/report-meta", "บันทึกข้อมูลรอบรายงาน"],
  ["put", "/stcr/api/ovens/:ovenId/limits", "บันทึกค่าขอบเขต"],
  ["patch", "/stcr/api/ovens/:ovenId", "แก้ไขข้อมูลเตา"],
  ["post", "/stcr/api/ovens", "เพิ่มเตา"],
  ["post", "/stcr/api/alarms/:alarmId/acknowledge", "รับทราบ Alarm"],
];

function functionNode({ id, z, name, func, x, y, wires, libs = [], outputs = 1, initialize = "", finalize = "" }) {
  return { id, type: "function", z, name, func, outputs, timeout: 0, noerr: 0, initialize, finalize, libs, x, y, wires };
}

const nodes = [
  { id: platformTabId, type: "tab", label: "01 ฐานข้อมูลและ API", disabled: false, info: "อ่านและบันทึกข้อมูลจริงใน MariaDB พร้อมให้บริการ HTTP API" },
  { id: mqttTabId, type: "tab", label: "02 รับข้อมูล MQTT โรงงาน", disabled: false, info: "รับข้อมูลจริงจาก MQTT ตรวจสอบและส่งเข้า STCR API" },
  { id: "stcr-platform-note", type: "comment", z: platformTabId, name: "ฐานข้อมูลจริงและ API สำหรับเว็บไซต์", info: "เมื่อไม่ได้รับข้อมูลจริง ระบบจะแสดงสถานะขาดการเชื่อมต่อ", x: 350, y: 40, wires: [] },
  ...endpoints.map(([method, url, name], index) => ({
    id: `stcr-http-${index + 1}`, type: "http in", z: platformTabId, name, url, method,
    upload: false, swaggerDoc: "", x: 180, y: 100 + index * 42, wires: [[routerId]],
  })),
  functionNode({
    id: routerId, z: platformTabId, name: "จัดเส้นทาง STCR API และอ่านเขียน MariaDB",
    func: router, x: 570, y: 440, wires: [[responseId]],
    libs: [{ var: "mysql", module: "mysql2/promise" }, { var: "crypto", module: "crypto" }],
  }),
  { id: responseId, type: "http response", z: platformTabId, name: "ส่งผลลัพธ์ HTTP กลับเว็บไซต์", statusCode: "", headers: {}, x: 880, y: 440, wires: [] },
  { id: "stcr-factory-mqtt-note", type: "comment", z: mqttTabId, name: "รับข้อมูลจริงจาก MQTT ของโรงงาน TTN", info: "รับ Topic test และ sensor เก็บ Payload ต้นฉบับ และไม่สร้างค่าทดแทนเมื่อเซนเซอร์ขาด", x: 320, y: 60, wires: [] },
  functionNode({
    id: "stcr-factory-mqtt-subscriber", z: mqttTabId, name: "รับ MQTT โรงงาน: test และ sensor",
    func: "return null;", initialize: subscriberInit, finalize: subscriberFinalize,
    libs: [{ var: "mqtt", module: "mqtt" }], x: 230, y: 160, wires: [["stcr-factory-mqtt-adapter"]],
  }),
  functionNode({
    id: "stcr-factory-mqtt-adapter", z: mqttTabId, name: "ตรวจสอบและแปลงข้อมูล MQTT ให้ตรงกับ API",
    func: adapter, outputs: 2, x: 600, y: 160,
    wires: [["stcr-factory-mqtt-http"], ["stcr-factory-mqtt-inspection"]],
  }),
  {
    id: "stcr-factory-mqtt-http", type: "http request", z: mqttTabId,
    name: "ส่งข้อมูลจริงที่ตรวจผ่านเข้า STCR API", method: "use", ret: "obj",
    paytoqs: "ignore", url: "", tls: "", persist: false, proxy: "",
    insecureHTTPParser: false, authType: "", senderr: false, headers: [],
    x: 980, y: 130, wires: [[]],
  },
  functionNode({
    id: "stcr-factory-mqtt-inspection", z: mqttTabId, name: "แสดงผลตรวจสอบข้อมูล MQTT",
    func: inspection, x: 970, y: 210, wires: [[]],
  }),
];

await writeFile(join(root, "flows.json"), `${JSON.stringify(nodes, null, 2)}\n`, "utf8");
console.log(`Generated node-red/flows.json with ${nodes.length} nodes across 2 tabs.`);
