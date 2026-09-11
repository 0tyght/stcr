import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const sourceIndex = process.argv.indexOf("--source");
const sourcePath =
  (sourceIndex >= 0 ? process.argv[sourceIndex + 1] : "") ||
  path.join(process.env.USERPROFILE || "", "Downloads", "flows (2).json");
const v5Path = path.join(root, "output", "node-red", "ttn-production-complete-v5.json");
const outputPath = path.join(root, "output", "node-red", "ttn-production-complete-v6.json");

const generated = spawnSync(
  process.execPath,
  [path.join(root, "scripts", "build-ttn-node-red-production-v5.mjs"), "--source", sourcePath],
  { cwd: root, encoding: "utf8" },
);
if (generated.status !== 0) throw new Error(generated.stderr || generated.stdout);

let raw = fs.readFileSync(v5Path, "utf8").replaceAll("stcr_v5_", "stcr_v6_");
raw = raw
  .replaceAll(" V5", " V6")
  .replaceAll("(V5)", "(V6)");
const nodes = JSON.parse(raw);
const byId = (id) => nodes.find((node) => node.id === id);
const removeId = (id) => {
  const index = nodes.findIndex((node) => node.id === id);
  if (index >= 0) nodes.splice(index, 1);
};

const tabs = {
  main: "stcr_v6_acquisition",
  mqtt: "stcr_v6_mqtt",
  operations: "stcr_v6_voltage",
  report: "stcr_v6_report",
  line: "stcr_v6_line",
};
const mainTab = byId(tabs.main);
const operationsTab = byId(tabs.operations);
const lineTab = byId(tabs.line);
mainTab.label = "STCR V6 · 01 ข้อมูลเตาและ MQTT";
mainTab.info =
  "รอบอ่าน → ตรวจสถานะ → ตรวจเซนเซอร์ → ส่งค่า → Retry และส่ง MQTT ในแท็บเดียว";
operationsTab.label = "STCR V6 · 02 ไฟฟ้าและรายงาน";
operationsTab.info =
  "อ่านแรงดัน ตรวจ Alarm Retry ทดสอบค่า และรายงานรายชั่วโมงในแท็บเดียว";
lineTab.label = "STCR V6 · 03 ส่ง LINE";
lineTab.info = "รับข้อความ จัดคิว ส่ง LINE Messaging API และตรวจผล";

// Keep the hourly LINE report compact and compatible with the factory's
// established message format. Only ovens that are currently open are listed.
byId("stcr_v6_line_prepare").func = `const token = env.get("STCR_LINE_TOKEN");
const recipient = env.get("STCR_LINE_TO");
if (!token || !recipient) {
    node.error("ยังไม่ได้ตั้ง STCR_LINE_TOKEN หรือ STCR_LINE_TO", msg);
    return null;
}
const input = msg.payload || {};
let text = "";
if (input.kind === "alert") {
    text = String(input.text || "");
} else if (input.kind === "summary") {
    const data = input.data || {};
    const voltage = data.voltage || {};
    const voltageStatus = (value) => value > 425 ? "สูง" : (value < 360 ? "ต่ำ" : "ปกติ");
    const formatVoltage = (phase) => {
        const value = Number(voltage[phase]);
        return "แรงดันเฟส " + phase + " " + voltageStatus(value) + ": " + value.toFixed(2) + " V";
    };
    const formatThreeDigits = (value) => String(Math.round(Number(value))).padStart(3, "0");
    const lines = [
        "รายงานแรงดันเฟส",
        formatVoltage("AB"),
        formatVoltage("BC"),
        formatVoltage("CA"),
        "=======================",
        "เตา,ครั้ง,Tห้อง,Tเตา,Tโบเวอร์,%ชื้น"
    ];
    for (let oven = 1; oven <= 9; oven += 1) {
        const item = data["oven" + oven];
        if (!item || item.oven_state !== true) continue;
        lines.push([
            oven,
            Math.round(Number(item.count)),
            Number(item.room_temp).toFixed(2),
            formatThreeDigits(item.oven_temp),
            formatThreeDigits(item.blower_temp),
            Number(item.humidity).toFixed(2)
        ].join(","));
    }
    text = lines.join("\\n");
}
if (!text) return null;
msg.payload = { to: recipient, messages: [{ type: "text", text }] };
msg.headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
return msg;`;

// MQTT remains a separate visual group but moves into the main tab.
const mqttGroup = byId("stcr_v6_mqtt_group");
const mqttIds = mqttGroup.nodes;
for (const id of mqttIds) {
  const node = byId(id);
  node.z = tabs.main;
}
mqttGroup.z = tabs.main;
mqttGroup.x = 2490;
mqttGroup.y = 1030;
mqttGroup.w = 650;
mqttGroup.h = 220;
Object.assign(byId("stcr_v6_status_in"), { x: 2630, y: 1110 });
Object.assign(byId("stcr_v6_mqtt_status"), { x: 2940, y: 1110 });
Object.assign(byId("stcr_v6_sensor_in"), { x: 2630, y: 1190 });
Object.assign(byId("stcr_v6_mqtt_sensor"), { x: 2940, y: 1190 });

// Report remains a separate visual group but moves into the electricity tab.
const reportGroup = byId("stcr_v6_report_group");
const reportIds = reportGroup.nodes;
for (const id of reportIds) {
  const node = byId(id);
  node.z = tabs.operations;
}
reportGroup.z = tabs.operations;
reportGroup.x = 70;
reportGroup.y = 930;
reportGroup.w = 1120;
reportGroup.h = 220;
const reportPositions = [
  [180, 1010],
  [460, 1010],
  [750, 1070],
  [1010, 1010],
];
for (let index = 0; index < reportIds.length; index += 1) {
  Object.assign(byId(reportIds[index]), {
    x: reportPositions[index][0],
    y: reportPositions[index][1],
  });
}

// Remove the two extra tab declarations after moving their nodes.
removeId(tabs.mqtt);
removeId(tabs.report);

// Keep exactly three tab declarations first and in the intended order.
const desiredTabs = [tabs.main, tabs.operations, tabs.line];
const orderedTabs = desiredTabs.map((id) => byId(id));
const nonTabs = nodes.filter((node) => node.type !== "tab");
nodes.length = 0;
nodes.push(...orderedTabs, ...nonTabs);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(nodes, null, 2)}\n`, "utf8");
console.log(`Created ${outputPath}`);
console.log(`Tabs=${orderedTabs.length}, groups=${nodes.filter((node) => node.type === "group").length}`);
