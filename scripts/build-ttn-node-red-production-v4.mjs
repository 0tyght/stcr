import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const sourceIndex = process.argv.indexOf("--source");
const sourcePath =
  (sourceIndex >= 0 ? process.argv[sourceIndex + 1] : "") ||
  path.join(process.env.USERPROFILE || "", "Downloads", "flows (2).json");
const v3Path = path.join(root, "output", "node-red", "ttn-production-complete-v3.json");
const outputPath = path.join(root, "output", "node-red", "ttn-production-complete-v4.json");

const generated = spawnSync(
  process.execPath,
  [
    path.join(root, "scripts", "build-ttn-node-red-production-v3.mjs"),
    "--source",
    sourcePath,
    "--embed-line-secrets",
  ],
  { cwd: root, encoding: "utf8" },
);
if (generated.status !== 0) throw new Error(generated.stderr || generated.stdout);

let serialized = fs.readFileSync(v3Path, "utf8").replaceAll("stcr_v3_", "stcr_v4_");
serialized = serialized
  .replaceAll("stcr_ttn_production_v3", "stcr_ttn_production_v4")
  .replaceAll("stcr_ttn_notify_v3", "stcr_ttn_notify_v4")
  .replaceAll("(V3)", "(V4)")
  .replaceAll(" V3", " V4");
const nodes = JSON.parse(serialized);
const mainTab = "stcr_ttn_production_v4";
const notifyTab = "stcr_ttn_notify_v4";
const byId = (id) => nodes.find((node) => node.id === id);
const removeIds = new Set([
  "stcr_v4_retry_catch",
  "stcr_v4_retry_controller",
  "stcr_v4_retry_wait",
  "stcr_v4_retry_route",
  "stcr_v4_error_format",
  "stcr_v4_error_debug",
]);
for (let index = nodes.length - 1; index >= 0; index -= 1) {
  if (removeIds.has(nodes[index].id)) nodes.splice(index, 1);
}

const add = (...items) => nodes.push(...items);
const fn = (id, name, func, outputs, x, y, wires, group = "") => ({
  id,
  type: "function",
  z: mainTab,
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
const linkOut = (id, name, links, x, y, group = "") => ({
  id,
  type: "link out",
  z: mainTab,
  ...(group ? { g: group } : {}),
  name,
  mode: "link",
  links,
  x,
  y,
  wires: [],
});

const tab = byId(mainTab);
tab.label = "STCR · TTN Production V4";
tab.info =
  "จัดกลุ่มเตา 1-9 แยกชัดเจน ใช้ Link ลดเส้นไขว้ มี Retry และ Watchdog เฉพาะเตาที่ข้อมูลขาด";

// Shared receivers keep long MQTT wires out of every oven group.
const statusMqtt = byId("stcr_v4_mqtt_status");
const sensorMqtt = byId("stcr_v4_mqtt_sensor");
statusMqtt.x = 1540;
statusMqtt.y = 60;
sensorMqtt.x = 1540;
sensorMqtt.y = 100;
add(
  {
    id: "stcr_v4_status_in",
    type: "link in",
    z: mainTab,
    name: "รวมสถานะจาก 9 เตา",
    links: [],
    x: 1305,
    y: 60,
    wires: [["stcr_v4_mqtt_status"]],
  },
  {
    id: "stcr_v4_sensor_in",
    type: "link in",
    z: mainTab,
    name: "รวมเซนเซอร์จาก 9 เตา",
    links: [],
    x: 1305,
    y: 100,
    wires: [["stcr_v4_mqtt_sensor"]],
  },
);

const mainNote = byId("stcr_v4_note");
mainNote.name = "V4 · ปิด DB / notify / V2 / V3 เดิมก่อนเปิดใช้งาน";
mainNote.x = 390;
mainNote.y = 40;

const allStatusLinks = [];
const allSensorLinks = [];
const allAlertLinks = [];

for (let oven = 1; oven <= 9; oven += 1) {
  const prefix = `stcr_v4_o${oven}`;
  const groupId = `${prefix}_group`;
  const top = 150 + (oven - 1) * 235;
  const ids = {
    inject: `${prefix}_inject`,
    statusGet: `${prefix}_status_get`,
    statusStore: `${prefix}_status_store`,
    warmGet: `${prefix}_warm_get`,
    warmStore: `${prefix}_warm_store`,
    countGet: `${prefix}_count_get`,
    countStore: `${prefix}_count_store`,
    kilnGet: `${prefix}_kiln_get`,
    kilnStore: `${prefix}_kiln_store`,
    roomGet: `${prefix}_humidity_get`,
    publish: `${prefix}_publish`,
  };
  const ordered = [
    ids.statusGet,
    ids.warmGet,
    ids.countGet,
    ids.kilnGet,
    ids.roomGet,
  ];
  const positions = {
    [ids.inject]: [140, top + 45],
    [ids.statusGet]: [480, top + 45],
    [ids.statusStore]: [660, top + 45],
    [ids.warmGet]: [840, top + 45],
    [ids.warmStore]: [1020, top + 45],
    [ids.countGet]: [1200, top + 45],
    [ids.countStore]: [1380, top + 45],
    [ids.kilnGet]: [390, top + 95],
    [ids.kilnStore]: [620, top + 95],
    [ids.roomGet]: [860, top + 95],
    [ids.publish]: [1130, top + 95],
  };
  const groupNodes = [];
  for (const [id, [x, y]] of Object.entries(positions)) {
    const node = byId(id);
    if (!node) throw new Error(`ไม่พบ ${id}`);
    node.x = x;
    node.y = y;
    node.g = groupId;
    groupNodes.push(id);
  }

  const publish = byId(ids.publish);
  const gateId = `${prefix}_gate`;
  byId(ids.inject).wires = [[gateId]];
  publish.func = publish.func.replace(
    "\nreturn [\n    { payload: statusPayload }",
    `\nflow.set("stcr_v4_busy_oven_${oven}", 0);\nreturn [\n    { payload: statusPayload }`,
  );
  add(
    fn(
      gateId,
      `ล็อกคิวอ่าน · เตา ${oven}`,
      `const key = "stcr_v4_busy_oven_${oven}";
const now = Date.now();
const busySince = Number(flow.get(key) || 0);
if (busySince > 0 && now - busySince < 15000) {
    node.warn("ข้ามคำสั่งอ่านซ้ำเตา ${oven}: รอบเดิมยังทำงาน");
    return null;
}
flow.set(key, now);
return msg;`,
      1,
      300,
      top + 45,
      [[ids.statusGet]],
      groupId,
    ),
  );
  groupNodes.push(gateId);
  const statusOut = `${prefix}_status_out`;
  const sensorOut = `${prefix}_sensor_out`;
  const alertOut = `${prefix}_alert_out`;
  publish.wires = [[statusOut], [sensorOut], [alertOut]];
  allStatusLinks.push(statusOut);
  allSensorLinks.push(sensorOut);
  allAlertLinks.push(alertOut);
  add(
    linkOut(statusOut, `สถานะเตา ${oven}`, ["stcr_v4_status_in"], 1430, top + 82, groupId),
    linkOut(sensorOut, `เซนเซอร์เตา ${oven}`, ["stcr_v4_sensor_in"], 1480, top + 102, groupId),
    linkOut(alertOut, `แจ้งเตือนเตา ${oven}`, ["stcr_v4_alert_in"], 1530, top + 122, groupId),
  );
  groupNodes.push(statusOut, sensorOut, alertOut);

  // A quiet watchdog retries only an oven that has not produced a complete sample.
  const primaryDelay = Number(byId(ids.inject).onceDelay);
  const watchInject = `${prefix}_watch_inject`;
  const watchCheck = `${prefix}_watch_check`;
  add(
    {
      id: watchInject,
      type: "inject",
      z: mainTab,
      g: groupId,
      name: `กู้ข้อมูลเตา ${oven} เฉพาะเมื่อขาด`,
      props: [{ p: "payload" }],
      repeat: "60",
      crontab: "",
      once: true,
      onceDelay: primaryDelay + 10,
      payload: String(oven),
      payloadType: "num",
      x: 190,
      y: top + 145,
      wires: [[watchCheck]],
    },
    fn(
      watchCheck,
      `ตรวจข้อมูลล่าสุด · เตา ${oven}`,
      `const latest = flow.get("latest_oven_${oven}");
const receivedAt = Date.parse(latest?.receivedAt || "");
if (!latest || !Number.isFinite(receivedAt) || Date.now() - receivedAt > 65000) {
    node.warn("กู้ข้อมูลเตา ${oven}: ยังไม่มีข้อมูลครบในรอบล่าสุด");
    msg.stcrWatchdog = true;
    return msg;
}
return null;`,
      1,
      440,
      top + 145,
      [[gateId]],
      groupId,
    ),
  );
  groupNodes.push(watchInject, watchCheck);

  // Retry is local to the oven, so its five wires never cross other oven groups.
  const catchId = `${prefix}_catch`;
  const retryControl = `${prefix}_retry_control`;
  const retryWait = `${prefix}_retry_wait`;
  const retryRoute = `${prefix}_retry_route`;
  const errorDebug = `${prefix}_error_debug`;
  const metadata = Object.fromEntries(
    ordered.map((id, index) => [
      id,
      ["สถานะทำงาน", "สถานะอุ่นเตา", "เลขรอบ", "อุณหภูมิเตา/Blower", "ความชื้น/ห้องอบ"][index],
    ]),
  );
  add(
    {
      id: catchId,
      type: "catch",
      z: mainTab,
      g: groupId,
      name: `จับ Timeout · เตา ${oven}`,
      scope: ordered,
      uncaught: false,
      x: 700,
      y: top + 150,
      wires: [[retryControl]],
    },
    fn(
      retryControl,
      `Retry เตา ${oven} สูงสุด 2 ครั้ง`,
      `const metadata = ${JSON.stringify(metadata)};
const target = msg.error?.source?.id || "";
const label = metadata[target];
if (!label) return [null, msg];
const old = msg.stcrRetry || {};
const attempt = old.target === target ? Number(old.attempt || 0) + 1 : 1;
const errorMessage = msg.error?.message || "Modbus read failed";
delete msg.error;
if (attempt <= 2) {
    msg.stcrRetry = { target, attempt };
    msg.stcrRetryTarget = target;
    node.warn("Retry " + attempt + "/2 · เตา ${oven} · " + label);
    return [msg, null];
}
msg.payload = {
    kind: "alert",
    text: "ขาดการเชื่อมต่อ Modbus: เตา ${oven} · " + label +
        "\\nลองอ่านแล้ว " + attempt + " ครั้ง\\n" + errorMessage,
    oven: ${oven}, nodeId: target, nodeName: label,
    attempts: attempt, message: errorMessage, time: new Date().toISOString()
};
delete msg.stcrRetry;
delete msg.stcrRetryTarget;
flow.set("stcr_v4_busy_oven_${oven}", 0);
const alertKey = "stcr_v4_modbus_error_oven_${oven}_" + target;
const now = Date.now();
const lastAlert = Number(flow.get(alertKey) || 0);
if (now - lastAlert >= 900000) {
    flow.set(alertKey, now);
    return [null, msg, { ...msg }];
}
return [null, msg, null];`,
      3,
      900,
      top + 150,
      [[retryWait], [errorDebug], [alertOut]],
      groupId,
    ),
    {
      id: retryWait,
      type: "delay",
      z: mainTab,
      g: groupId,
      name: "รอ Retry 1.5 วินาที",
      pauseType: "delay",
      timeout: "1.5",
      timeoutUnits: "seconds",
      rate: "1",
      nbRateUnits: "1",
      rateUnits: "second",
      randomFirst: "1",
      randomLast: "5",
      randomUnits: "seconds",
      drop: false,
      allowrate: false,
      outputs: 1,
      x: 1110,
      y: top + 150,
      wires: [[retryRoute]],
    },
    {
      id: retryRoute,
      type: "switch",
      z: mainTab,
      g: groupId,
      name: `กลับจุดที่พลาด · เตา ${oven}`,
      property: "stcrRetryTarget",
      propertyType: "msg",
      rules: ordered.map((id) => ({ t: "eq", v: id, vt: "str" })),
      checkall: "true",
      repair: false,
      outputs: ordered.length,
      x: 1310,
      y: top + 150,
      wires: ordered.map((id) => [id]),
    },
    {
      id: errorDebug,
      type: "debug",
      z: mainTab,
      g: groupId,
      name: `ข้อผิดพลาดเตา ${oven}`,
      active: true,
      tosidebar: true,
      console: false,
      tostatus: false,
      complete: "payload",
      targetType: "msg",
      x: 1510,
      y: top + 165,
      wires: [],
    },
  );
  groupNodes.push(catchId, retryControl, retryWait, retryRoute, errorDebug);
  add({
    id: groupId,
    type: "group",
    z: mainTab,
    name: `เตา ${oven} · PLC ${183 + Math.floor((oven - 1) / 3)}`,
    style: {
      label: true,
      color: "#3fadb5",
      fill: "#e8f5f6",
      fillOpacity: "0.32",
    },
    nodes: groupNodes,
    x: 60,
    y: top,
    w: 1540,
    h: 205,
  });
}

byId("stcr_v4_status_in").links = allStatusLinks;
byId("stcr_v4_sensor_in").links = allSensorLinks;
const alertIn = byId("stcr_v4_alert_in");
alertIn.links = [...new Set([...(alertIn.links || []), ...allAlertLinks])];

// Electrical group: move it between the first and second oven polling windows.
const voltageInject = byId("stcr_v4_voltage_inject");
voltageInject.onceDelay = 17;
voltageInject.name = "อ่านแรงดันทุก 1 นาที · เริ่มวินาที 17";
const voltageIds = [
  "stcr_v4_voltage_inject",
  "stcr_v4_voltage_ab_get",
  "stcr_v4_voltage_ab_store",
  "stcr_v4_voltage_bc_get",
  "stcr_v4_voltage_bc_store",
  "stcr_v4_voltage_ca_get",
  "stcr_v4_voltage_ca_store",
  "stcr_v4_voltage_check",
  "stcr_v4_voltage_test_inject",
  "stcr_v4_voltage_test_format",
  "stcr_v4_voltage_test_debug",
  "stcr_v4_voltage_catch",
  "stcr_v4_voltage_retry_control",
  "stcr_v4_voltage_retry_wait",
  "stcr_v4_voltage_retry_route",
  "stcr_v4_voltage_error_debug",
  "stcr_v4_alert_out",
];
const voltageTop = 2280;
const voltagePositions = [
  [150, voltageTop + 55], [390, voltageTop + 55], [590, voltageTop + 55],
  [790, voltageTop + 55], [990, voltageTop + 55], [1190, voltageTop + 55],
  [1390, voltageTop + 55], [1580, voltageTop + 55],
  [190, voltageTop + 120], [500, voltageTop + 120], [820, voltageTop + 120],
];
for (let index = 0; index < voltageIds.length; index += 1) {
  const node = byId(voltageIds[index]);
  if (!node) continue;
  if (voltagePositions[index]) {
    node.x = voltagePositions[index][0];
    node.y = voltagePositions[index][1];
  }
  node.g = "stcr_v4_voltage_group";
}
const voltageAlertOut = byId("stcr_v4_alert_out");
voltageAlertOut.name = "ส่งแจ้งเตือนไฟฟ้าไป LINE";
voltageAlertOut.x = 900;
voltageAlertOut.y = voltageTop + 155;
const voltageGetters = [
  "stcr_v4_voltage_ab_get",
  "stcr_v4_voltage_bc_get",
  "stcr_v4_voltage_ca_get",
];
add(
  {
    id: "stcr_v4_voltage_catch",
    type: "catch",
    z: mainTab,
    g: "stcr_v4_voltage_group",
    name: "จับ Timeout · แรงดันไฟฟ้า",
    scope: voltageGetters,
    uncaught: false,
    x: 1030,
    y: voltageTop + 120,
    wires: [["stcr_v4_voltage_retry_control"]],
  },
  fn(
    "stcr_v4_voltage_retry_control",
    "Retry แรงดันสูงสุด 2 ครั้ง",
    `const labels = {
    stcr_v4_voltage_ab_get: "แรงดันเฟส AB",
    stcr_v4_voltage_bc_get: "แรงดันเฟส BC",
    stcr_v4_voltage_ca_get: "แรงดันเฟส CA"
};
const target = msg.error?.source?.id || "";
const label = labels[target];
if (!label) return [null, msg];
const old = msg.stcrRetry || {};
const attempt = old.target === target ? Number(old.attempt || 0) + 1 : 1;
const errorMessage = msg.error?.message || "Modbus read failed";
delete msg.error;
if (attempt <= 2) {
    msg.stcrRetry = { target, attempt };
    msg.stcrRetryTarget = target;
    node.warn("Retry " + attempt + "/2 · " + label);
    return [msg, null];
}
msg.payload = {
    kind: "alert",
    text: "ขาดการเชื่อมต่อ Modbus: " + label +
        "\\nลองอ่านแล้ว " + attempt + " ครั้ง\\n" + errorMessage,
    nodeId: target, nodeName: label, attempts: attempt,
    message: errorMessage, time: new Date().toISOString()
};
delete msg.stcrRetry;
delete msg.stcrRetryTarget;
const alertKey = "stcr_v4_modbus_error_voltage_" + target;
const now = Date.now();
const lastAlert = Number(flow.get(alertKey) || 0);
if (now - lastAlert >= 900000) {
    flow.set(alertKey, now);
    return [null, msg, { ...msg }];
}
return [null, msg, null];`,
    3,
    1210,
    voltageTop + 120,
    [["stcr_v4_voltage_retry_wait"], ["stcr_v4_voltage_error_debug"], ["stcr_v4_alert_out"]],
    "stcr_v4_voltage_group",
  ),
  {
    id: "stcr_v4_voltage_retry_wait",
    type: "delay",
    z: mainTab,
    g: "stcr_v4_voltage_group",
    name: "รอ Retry 1.5 วินาที",
    pauseType: "delay",
    timeout: "1.5",
    timeoutUnits: "seconds",
    rate: "1",
    nbRateUnits: "1",
    rateUnits: "second",
    randomFirst: "1",
    randomLast: "5",
    randomUnits: "seconds",
    drop: false,
    allowrate: false,
    outputs: 1,
    x: 1390,
    y: voltageTop + 120,
    wires: [["stcr_v4_voltage_retry_route"]],
  },
  {
    id: "stcr_v4_voltage_retry_route",
    type: "switch",
    z: mainTab,
    g: "stcr_v4_voltage_group",
    name: "กลับเฟสที่พลาด",
    property: "stcrRetryTarget",
    propertyType: "msg",
    rules: voltageGetters.map((id) => ({ t: "eq", v: id, vt: "str" })),
    checkall: "true",
    repair: false,
    outputs: 3,
    x: 1560,
    y: voltageTop + 120,
    wires: voltageGetters.map((id) => [id]),
  },
  {
    id: "stcr_v4_voltage_error_debug",
    type: "debug",
    z: mainTab,
    g: "stcr_v4_voltage_group",
    name: "ข้อผิดพลาดแรงดันไฟฟ้า",
    active: true,
    tosidebar: true,
    console: false,
    tostatus: false,
    complete: "payload",
    targetType: "msg",
    x: 1590,
    y: voltageTop + 155,
    wires: [],
  },
);
add({
  id: "stcr_v4_voltage_group",
  type: "group",
  z: mainTab,
  name: "แรงดันไฟฟ้า 3 เฟส · PLC 183",
  style: { label: true, color: "#d6a700", fill: "#fff5cc", fillOpacity: "0.35" },
  nodes: voltageIds.filter((id) => byId(id)),
  x: 60,
  y: voltageTop,
  w: 1580,
  h: 215,
});

// Hourly summary is visually isolated at the bottom.
const summaryIds = [
  "stcr_v4_hourly_inject",
  "stcr_v4_hourly_format",
  "stcr_v4_summary_wait",
  "stcr_v4_summary_out",
];
for (let index = 0; index < summaryIds.length; index += 1) {
  const node = byId(summaryIds[index]);
  if (!node) continue;
  node.x = 220 + index * 280;
  node.y = 2580 + (index === 2 ? 50 : 0);
  node.g = "stcr_v4_summary_group";
}
add({
  id: "stcr_v4_summary_group",
  type: "group",
  z: mainTab,
  name: "รายงานสรุปรายชั่วโมง",
  style: { label: true, color: "#8a6fd1", fill: "#f0ebff", fillOpacity: "0.35" },
  nodes: summaryIds.filter((id) => byId(id)),
  x: 60,
  y: 2540,
  w: 1200,
  h: 150,
});

const notify = byId(notifyTab);
notify.label = "STCR · ส่ง LINE (V4)";
notify.info = "ชุดส่ง LINE V4 พร้อมคิว 1 ข้อความต่อวินาที ไม่มีการอ่าน Modbus";

// Remove any membership referring to nodes that no longer exist.
const allIds = new Set(nodes.map((node) => node.id));
for (const node of nodes.filter((item) => item.type === "group")) {
  node.nodes = (node.nodes || []).filter((id) => allIds.has(id));
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(nodes, null, 2)}\n`, "utf8");
console.log(`Created ${outputPath}`);
console.log(`Nodes=${nodes.length}, groups=${nodes.filter((node) => node.type === "group").length}`);
