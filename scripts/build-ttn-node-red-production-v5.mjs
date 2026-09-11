import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const sourceIndex = process.argv.indexOf("--source");
const sourcePath =
  (sourceIndex >= 0 ? process.argv[sourceIndex + 1] : "") ||
  path.join(process.env.USERPROFILE || "", "Downloads", "flows (2).json");
const v4Path = path.join(root, "output", "node-red", "ttn-production-complete-v4.json");
const outputPath = path.join(root, "output", "node-red", "ttn-production-complete-v5.json");

const generated = spawnSync(
  process.execPath,
  [path.join(root, "scripts", "build-ttn-node-red-production-v4.mjs"), "--source", sourcePath],
  { cwd: root, encoding: "utf8" },
);
if (generated.status !== 0) throw new Error(generated.stderr || generated.stdout);

let raw = fs.readFileSync(v4Path, "utf8").replaceAll("stcr_v4_", "stcr_v5_");
raw = raw
  .replaceAll("stcr_ttn_production_v4", "stcr_v5_acquisition")
  .replaceAll("stcr_ttn_notify_v4", "stcr_v5_line")
  .replaceAll("(V4)", "(V5)")
  .replaceAll(" V4", " V5");
const nodes = JSON.parse(raw);
const byId = (id) => nodes.find((node) => node.id === id);
const add = (...items) => nodes.push(...items);

// Remove the V4 visual groups. V5 groups by responsibility instead.
for (let index = nodes.length - 1; index >= 0; index -= 1) {
  if (nodes[index].type === "group") nodes.splice(index, 1);
}
for (const node of nodes) delete node.g;

const tabs = {
  acquisition: "stcr_v5_acquisition",
  mqtt: "stcr_v5_mqtt",
  voltage: "stcr_v5_voltage",
  report: "stcr_v5_report",
  line: "stcr_v5_line",
};
const acquisitionTab = byId(tabs.acquisition);
const lineTab = byId(tabs.line);
acquisitionTab.label = "STCR V5 · 01 รับและตรวจข้อมูลเตา";
acquisitionTab.info =
  "จัดตามหน้าที่: กำหนดรอบอ่าน → ตรวจสถานะ → ตรวจเซนเซอร์ → ส่งออก → Retry";
lineTab.label = "STCR V5 · 05 ส่ง LINE";
lineTab.info = "รับข้อความที่ผ่านการตรวจแล้ว จัดคิว และส่ง LINE Messaging API";
add(
  {
    id: tabs.mqtt,
    type: "tab",
    label: "STCR V5 · 02 ส่งข้อมูล MQTT",
    disabled: true,
    info: "รวม Payload ที่ตรวจครบแล้วและส่ง Topic test/sensor",
    env: [],
  },
  {
    id: tabs.voltage,
    type: "tab",
    label: "STCR V5 · 03 ตรวจแรงดันไฟฟ้า",
    disabled: true,
    info: "อ่าน AB/BC/CA ตรวจช่วง แจ้งเตือน และทดสอบส่งค่า",
    env: [],
  },
  {
    id: tabs.report,
    type: "tab",
    label: "STCR V5 · 04 รายงานรายชั่วโมง",
    disabled: true,
    info: "ตรวจความสดของข้อมูล 9 เตาและแรงดัน 3 เฟสก่อนส่งสรุป",
    env: [],
  },
);

const move = (ids, tab) => {
  for (const id of ids) {
    const node = byId(id);
    if (node) node.z = tab;
  }
};
const fn = (id, tab, name, func, outputs, x, y, wires, group = "") => ({
  id,
  type: "function",
  z: tab,
  ...(group ? { g: group } : {}),
  name,
  func,
  outputs,
  timeout: 0,
  noerr: 0,
  initialize: "",
  finalize: "",
  libs: [],
  x,
  y,
  wires,
});

// MQTT is a separate, very small operation tab.
const mqttIds = [
  "stcr_v5_status_in",
  "stcr_v5_sensor_in",
  "stcr_v5_mqtt_status",
  "stcr_v5_mqtt_sensor",
];
move(mqttIds, tabs.mqtt);
Object.assign(byId("stcr_v5_status_in"), { x: 220, y: 140 });
Object.assign(byId("stcr_v5_mqtt_status"), { x: 520, y: 140 });
Object.assign(byId("stcr_v5_sensor_in"), { x: 220, y: 220 });
Object.assign(byId("stcr_v5_mqtt_sensor"), { x: 520, y: 220 });
add({
  id: "stcr_v5_mqtt_group",
  type: "group",
  z: tabs.mqtt,
  name: "ส่งข้อมูลที่ตรวจครบแล้ว",
  style: { label: true, color: "#2f855a", fill: "#e8f7ef", fillOpacity: "0.45" },
  nodes: mqttIds,
  x: 80,
  y: 80,
  w: 580,
  h: 200,
});
for (const id of mqttIds) byId(id).g = "stcr_v5_mqtt_group";

// Acquisition is arranged left-to-right in functional columns.
const groups = {
  schedule: { id: "stcr_v5_group_schedule", name: "1 · กำหนดรอบอ่านและกู้ข้อมูล", x: 40, w: 470 },
  status: { id: "stcr_v5_group_status", name: "2 · อ่านและตรวจสถานะ/เลขรอบ", x: 540, w: 1040 },
  sensor: { id: "stcr_v5_group_sensor", name: "3 · อ่านและตรวจเซนเซอร์", x: 1610, w: 850 },
  output: { id: "stcr_v5_group_output", name: "4 · ส่งค่าที่ตรวจครบ", x: 2490, w: 260 },
  retry: { id: "stcr_v5_group_retry", name: "5 · จัดการ Timeout และ Retry", x: 2780, w: 1120 },
};
const groupMembers = Object.fromEntries(Object.values(groups).map((group) => [group.id, []]));
const assign = (id, group, x, y) => {
  const node = byId(id);
  if (!node) throw new Error(`ไม่พบ ${id}`);
  node.z = tabs.acquisition;
  node.g = group.id;
  node.x = x;
  node.y = y;
  groupMembers[group.id].push(id);
  return node;
};

for (let oven = 1; oven <= 9; oven += 1) {
  const p = `stcr_v5_o${oven}`;
  const y = 150 + (oven - 1) * 90;
  const ids = {
    inject: `${p}_inject`,
    watchInject: `${p}_watch_inject`,
    watchCheck: `${p}_watch_check`,
    gate: `${p}_gate`,
    statusGet: `${p}_status_get`,
    statusStore: `${p}_status_store`,
    warmGet: `${p}_warm_get`,
    warmStore: `${p}_warm_store`,
    countGet: `${p}_count_get`,
    countStore: `${p}_count_store`,
    kilnGet: `${p}_kiln_get`,
    kilnStore: `${p}_kiln_store`,
    roomGet: `${p}_humidity_get`,
    publish: `${p}_publish`,
    statusOut: `${p}_status_out`,
    sensorOut: `${p}_sensor_out`,
    alertOut: `${p}_alert_out`,
    catch: `${p}_catch`,
    retryControl: `${p}_retry_control`,
    retryWait: `${p}_retry_wait`,
    retryRoute: `${p}_retry_route`,
    errorDebug: `${p}_error_debug`,
  };

  assign(ids.inject, groups.schedule, 140, y);
  assign(ids.watchInject, groups.schedule, 140, y + 30);
  assign(ids.watchCheck, groups.schedule, 330, y + 30);
  assign(ids.gate, groups.schedule, 340, y);

  assign(ids.statusGet, groups.status, 620, y);
  assign(ids.statusStore, groups.status, 800, y);
  assign(ids.warmGet, groups.status, 980, y);
  assign(ids.warmStore, groups.status, 1160, y);
  assign(ids.countGet, groups.status, 1340, y);
  assign(ids.countStore, groups.status, 1510, y);

  assign(ids.kilnGet, groups.sensor, 1690, y);
  assign(ids.kilnStore, groups.sensor, 1900, y);
  assign(ids.roomGet, groups.sensor, 2110, y);
  assign(ids.publish, groups.sensor, 2350, y);

  assign(ids.statusOut, groups.output, 2570, y - 20);
  assign(ids.sensorOut, groups.output, 2600, y);
  assign(ids.alertOut, groups.output, 2630, y + 20);

  assign(ids.catch, groups.retry, 2860, y);
  assign(ids.retryControl, groups.retry, 3050, y);
  assign(ids.retryWait, groups.retry, 3260, y);
  assign(ids.retryRoute, groups.retry, 3460, y);
  assign(ids.errorDebug, groups.retry, 3830, y + 25);

  // Retry switch now targets nearby link nodes. Hidden links return to the getters.
  const getterIds = [
    ids.statusGet,
    ids.warmGet,
    ids.countGet,
    ids.kilnGet,
    ids.roomGet,
  ];
  const getterLabels = ["สถานะทำงาน", "สถานะอุ่น", "เลขรอบ", "เตา/Blower", "ความชื้น/ห้องอบ"];
  const retryOutIds = [];
  for (let index = 0; index < getterIds.length; index += 1) {
    const outId = `${p}_retry_${index + 1}_out`;
    const inId = `${p}_retry_${index + 1}_in`;
    retryOutIds.push(outId);
    const getterNode = byId(getterIds[index]);
    const operationGroup = index <= 2 ? groups.status : groups.sensor;
    const inX = getterNode.x - 85;
    add(
      {
        id: outId,
        type: "link out",
        z: tabs.acquisition,
        g: groups.retry.id,
        name: `Retry ${getterLabels[index]} · เตา ${oven}`,
        mode: "link",
        links: [inId],
        x: 3670,
        y: y - 24 + index * 12,
        wires: [],
      },
      {
        id: inId,
        type: "link in",
        z: tabs.acquisition,
        g: operationGroup.id,
        name: `รับ Retry · เตา ${oven}`,
        links: [outId],
        x: inX,
        y: getterNode.y + 25,
        wires: [[getterIds[index]]],
      },
    );
    groupMembers[groups.retry.id].push(outId);
    groupMembers[operationGroup.id].push(inId);
  }
  byId(ids.retryRoute).wires = retryOutIds.map((id) => [id]);
}

const acquisitionHeight = 900;
for (const group of Object.values(groups)) {
  add({
    id: group.id,
    type: "group",
    z: tabs.acquisition,
    name: group.name,
    style: {
      label: true,
      color: group.id === groups.retry.id ? "#b7791f" : "#3f6f9f",
      fill: group.id === groups.retry.id ? "#fff7df" : "#edf5ff",
      fillOpacity: "0.34",
    },
    nodes: groupMembers[group.id],
    x: group.x,
    y: 90,
    w: group.w,
    h: acquisitionHeight,
  });
}

// Voltage becomes its own responsibility tab.
const voltageIds = nodes
  .filter(
    (node) =>
      node.id.startsWith("stcr_v5_voltage_") ||
      node.id === "stcr_v5_alert_out",
  )
  .map((node) => node.id);
move(voltageIds, tabs.voltage);
const voltageGroupMap = {
  read: { id: "stcr_v5_voltage_read_group", name: "1 · อ่านแรงดัน AB → BC → CA", nodes: [] },
  check: { id: "stcr_v5_voltage_check_group", name: "2 · ตรวจช่วงและสร้าง Alarm", nodes: [] },
  retry: { id: "stcr_v5_voltage_retry_group", name: "3 · Retry เมื่ออ่านไฟฟ้าพลาด", nodes: [] },
  test: { id: "stcr_v5_voltage_test_group", name: "4 · ทดสอบและส่ง LINE", nodes: [] },
};
const voltageLayout = {
  stcr_v5_voltage_inject: [160, 150, "read"],
  stcr_v5_voltage_ab_get: [390, 150, "read"],
  stcr_v5_voltage_ab_store: [590, 150, "read"],
  stcr_v5_voltage_bc_get: [790, 150, "read"],
  stcr_v5_voltage_bc_store: [990, 150, "read"],
  stcr_v5_voltage_ca_get: [1190, 150, "read"],
  stcr_v5_voltage_ca_store: [1390, 150, "read"],
  stcr_v5_voltage_check: [250, 350, "check"],
  stcr_v5_voltage_catch: [180, 560, "retry"],
  stcr_v5_voltage_retry_control: [400, 560, "retry"],
  stcr_v5_voltage_retry_wait: [630, 560, "retry"],
  stcr_v5_voltage_retry_route: [850, 560, "retry"],
  stcr_v5_voltage_error_debug: [1080, 590, "retry"],
  stcr_v5_voltage_test_inject: [180, 770, "test"],
  stcr_v5_voltage_test_format: [440, 770, "test"],
  stcr_v5_voltage_test_debug: [730, 810, "test"],
  stcr_v5_alert_out: [880, 770, "test"],
};
for (const [id, [x, y, key]] of Object.entries(voltageLayout)) {
  const node = byId(id);
  if (!node) continue;
  node.z = tabs.voltage;
  node.g = voltageGroupMap[key].id;
  node.x = x;
  node.y = y;
  voltageGroupMap[key].nodes.push(id);
}
const voltageGroupBoxes = [
  ["read", 70, 90, 1450, 150],
  ["check", 70, 290, 1100, 150],
  ["retry", 70, 500, 1160, 150],
  ["test", 70, 710, 950, 160],
];
for (const [key, x, y, w, h] of voltageGroupBoxes) {
  const group = voltageGroupMap[key];
  add({
    id: group.id,
    type: "group",
    z: tabs.voltage,
    name: group.name,
    style: { label: true, color: "#b7791f", fill: "#fff6d8", fillOpacity: "0.4" },
    nodes: group.nodes,
    x,
    y,
    w,
    h,
  });
}

// Cross-tab report reads globally shared complete samples.
for (const oven of Array.from({ length: 9 }, (_, index) => index + 1)) {
  const publish = byId(`stcr_v5_o${oven}_publish`);
  publish.func = publish.func.replace(
    `flow.set("latest_oven_${oven}",`,
    `global.set("latest_oven_${oven}",`,
  );
}
const voltageCheck = byId("stcr_v5_voltage_check");
voltageCheck.func = voltageCheck.func.replace(
  'flow.set("latest_voltage",',
  'global.set("latest_voltage",',
);
const voltageTest = byId("stcr_v5_voltage_test_format");
voltageTest.func = voltageTest.func.replace(
  'flow.get("latest_voltage")',
  'global.get("latest_voltage")',
);

const reportIds = [
  "stcr_v5_hourly_inject",
  "stcr_v5_hourly_format",
  "stcr_v5_summary_wait",
  "stcr_v5_summary_out",
];
move(reportIds, tabs.report);
const reportFunction = byId("stcr_v5_hourly_format");
reportFunction.func = reportFunction.func
  .replaceAll('flow.get("latest_oven_', 'global.get("latest_oven_')
  .replace('flow.get("latest_voltage")', 'global.get("latest_voltage")');
const reportPositions = [
  [180, 170], [450, 170], [730, 230], [980, 170],
];
for (let index = 0; index < reportIds.length; index += 1) {
  const node = byId(reportIds[index]);
  node.g = "stcr_v5_report_group";
  node.x = reportPositions[index][0];
  node.y = reportPositions[index][1];
}
add({
  id: "stcr_v5_report_group",
  type: "group",
  z: tabs.report,
  name: "ตรวจข้อมูลครบ → รอข้อมูลที่ขาด → ส่งสรุป LINE",
  style: { label: true, color: "#805ad5", fill: "#f3edff", fillOpacity: "0.4" },
  nodes: reportIds,
  x: 70,
  y: 90,
  w: 1050,
  h: 210,
});

// LINE tab is grouped by message pipeline.
const lineIds = nodes
  .filter((node) => node.z === tabs.line && node.type !== "tab")
  .map((node) => node.id);
for (const id of lineIds) {
  const node = byId(id);
  node.g = "stcr_v5_line_group";
}
add({
  id: "stcr_v5_line_group",
  type: "group",
  z: tabs.line,
  name: "รับข้อความ → สร้าง Payload → จัดคิว → ส่ง LINE → ตรวจผล",
  style: { label: true, color: "#7b5bb5", fill: "#f1edfa", fillOpacity: "0.4" },
  nodes: lineIds,
  x: 60,
  y: 40,
  w: 1210,
  h: 280,
});

// Validate group membership after moving nodes.
const allIds = new Set(nodes.map((node) => node.id));
for (const group of nodes.filter((node) => node.type === "group")) {
  group.nodes = (group.nodes || []).filter((id) => allIds.has(id) && byId(id).z === group.z);
}

const tabOrder = [
  tabs.acquisition,
  tabs.mqtt,
  tabs.voltage,
  tabs.report,
  tabs.line,
];
const orderedTabs = tabOrder.map((id) => byId(id));
const nonTabs = nodes.filter((node) => node.type !== "tab");
nodes.length = 0;
nodes.push(...orderedTabs, ...nonTabs);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(nodes, null, 2)}\n`, "utf8");
console.log(`Created ${outputPath}`);
console.log(`Tabs=${nodes.filter((node) => node.type === "tab").length}, groups=${nodes.filter((node) => node.type === "group").length}`);
