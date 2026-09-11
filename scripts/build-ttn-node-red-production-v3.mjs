import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const sourceIndex = process.argv.indexOf("--source");
const sourcePath =
  (sourceIndex >= 0 ? process.argv[sourceIndex + 1] : "") ||
  path.join(process.env.USERPROFILE || "", "Downloads", "flows (2).json");
const embedLineSecrets = process.argv.includes("--embed-line-secrets");
const sourceFlows = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const lineSummarySource = sourceFlows.find(
  (node) =>
    node.type === "function" &&
    typeof node.func === "string" &&
    node.func.includes("Data for oven") &&
    node.func.includes('"messages"'),
);
const sourceById = new Map(sourceFlows.map((node) => [node.id, node]));
const findBearerDownstream = (startNode) => {
  const queue = [...(startNode?.wires || []).flat()];
  const visited = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    const node = sourceById.get(id);
    if (!node) continue;
    if (
      node.type === "function" &&
      typeof node.func === "string" &&
      node.func.includes("Authorization") &&
      node.func.includes("Bearer ")
    ) {
      return node;
    }
    queue.push(...(node.wires || []).flat());
  }
  return null;
};
const lineAuthSource = findBearerDownstream(lineSummarySource);
const lineRecipient = embedLineSecrets
  ? lineSummarySource?.func?.match(/["']to["']\s*:\s*["']([^"']+)["']/)?.[1] || ""
  : "";
const lineToken = embedLineSecrets
  ? lineAuthSource?.func?.match(/Bearer\s+([^"']+)/)?.[1] || ""
  : "";
if (embedLineSecrets && (!lineRecipient || !lineToken)) {
  throw new Error("ไม่พบ LINE Token หรือรหัสผู้รับจาก Flow ต้นฉบับ");
}
const basePath = path.join(root, "output", "node-red", ".ttn-v3-base.json");
const outputPath = path.join(root, "output", "node-red", "ttn-production-complete-v3.json");
const generator = path.join(root, "scripts", "build-ttn-node-red-flow.mjs");

const generated = spawnSync(
  process.execPath,
  [generator, "--source", sourcePath, "--output", basePath],
  { cwd: root, encoding: "utf8" },
);
if (generated.status !== 0) throw new Error(generated.stderr || generated.stdout);

const nodes = JSON.parse(fs.readFileSync(basePath, "utf8"));
fs.rmSync(basePath, { force: true });
const tab = nodes.find((node) => node.type === "tab");
if (!tab) throw new Error("ไม่พบแท็บ V2 ที่ใช้เป็นฐาน");
tab.id = "stcr_ttn_production_v3";
tab.label = "STCR · รับข้อมูล TTN พร้อมแจ้งเตือน (V3)";
tab.info =
  "อ่านข้อมูล TTN เตา 1-9 แบบเรียงลำดับ ส่ง MQTT เมื่อข้อมูลครบ " +
  "และใช้ข้อมูลชุดเดียวกันตรวจสถานะ อุณหภูมิ และแรงดันไฟฟ้า";
const mainTab = tab.id;
for (const node of nodes) {
  if (node.z === "stcr_ttn_ingestion_v2") node.z = mainTab;
}

const add = (...items) => nodes.push(...items);
const fn = (id, z, name, func, outputs, x, y, wires) => ({
  id,
  type: "function",
  z,
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
const clientId = (unit) => `stcr_v2_modbus_client_${unit}`;
const getter = ({ id, name, unit, address, quantity, dataType, x, y, wire }) => ({
  id,
  type: "modbus-getter",
  z: mainTab,
  name,
  showStatusActivities: false,
  showErrors: true,
  logIOActivities: false,
  unitid: String(unit),
  dataType,
  adr: String(address),
  quantity: String(quantity),
  server: clientId(unit),
  useIOFile: false,
  ioFile: "",
  useIOForPayload: false,
  emptyMsgOnFail: false,
  keepMsgProperties: true,
  x,
  y,
  wires: [[wire], []],
});

const newGetters = [];
const retryInfo = {};
const alertLinkId = "stcr_v3_alert_out";

for (let oven = 1; oven <= 9; oven += 1) {
  const index = (oven - 1) % 3;
  const unit = 183 + Math.floor((oven - 1) / 3);
  const prefix = `stcr_v2_o${oven}`;
  const statusStore = nodes.find((node) => node.id === `${prefix}_status_store`);
  const countGet = `${prefix}_count_get`;
  const warmGet = `stcr_v3_o${oven}_warm_get`;
  const warmStore = `stcr_v3_o${oven}_warm_store`;
  const publish = nodes.find((node) => node.id === `${prefix}_publish`);
  if (!statusStore || !publish) throw new Error(`โครงสร้างเตา ${oven} ไม่ครบ`);

  statusStore.wires = [[warmGet]];
  newGetters.push(warmGet);
  retryInfo[warmGet] = { oven, label: "สถานะอุ่นเตา" };
  add(
    getter({
      id: warmGet,
      name: `เตา ${oven} · สถานะอุ่นเตา`,
      unit,
      address: 4188 + index * 1000,
      quantity: 1,
      dataType: "Input",
      x: 830,
      y: statusStore.y,
      wire: warmStore,
    }),
    fn(
      warmStore,
      mainTab,
      `ตรวจสถานะอุ่นเตา · เตา ${oven}`,
      `const value = Array.isArray(msg.payload) ? msg.payload[0] : msg.payload;
if (![true, false, 0, 1].includes(value)) {
    node.error("สถานะอุ่นเตา ${oven} ไม่ถูกต้อง", msg);
    return null;
}
msg.stcr.warmState = value === true || Number(value) === 1;
return msg;`,
      1,
      1050,
      statusStore.y,
      [[countGet]],
    ),
  );

  const original = publish.func;
  const marker = "flow.set(\"latest_oven_";
  const markerIndex = original.indexOf(marker);
  if (markerIndex < 0) throw new Error(`ไม่พบจุดตรวจเหตุการณ์เตา ${oven}`);
  const beforeLatest = original.slice(0, markerIndex);
  publish.func = `${beforeLatest}
const eventKey = "stcr_v3_event_oven_${oven}";
const previous = flow.get(eventKey);
const eventNow = Date.now();
const current = {
    ovenState: msg.stcr.ovenState,
    warmState: msg.stcr.warmState,
    roomHigh: roomTemp > 65,
    kilnZone: msg.stcr.ovenState
        ? (msg.stcr.ovenTemp >= 600 ? "high" : (msg.stcr.ovenTemp <= 100 ? "low" : "normal"))
        : "inactive",
    roomLastAlert: previous?.roomLastAlert || 0,
    kilnLastAlert: previous?.kilnLastAlert || 0
};
const alerts = [];
const alert = (text) => alerts.push({ payload: { kind: "alert", text } });
if (previous) {
    if (previous.ovenState !== current.ovenState) {
        alert((current.ovenState ? "เริ่มทำงานเตา " : "หยุดทำงานเตา ") + ${oven});
    }
    if (previous.warmState !== current.warmState) {
        alert((current.warmState ? "เริ่มอุ่นเตา " : "หยุดอุ่นเตา ") + ${oven});
    }
    if (current.roomHigh && (!previous.roomHigh ||
        eventNow - Number(previous.roomLastAlert || 0) >= 3600000)) {
        alert("อุณหภูมิห้องอบเตา ${oven} สูงกว่า 65°C = " + roomTemp.toFixed(2) + "°C");
        current.roomLastAlert = eventNow;
    } else if (!current.roomHigh && previous.roomHigh) {
        alert("อุณหภูมิห้องอบเตา ${oven} กลับสู่ช่วงปกติ = " + roomTemp.toFixed(2) + "°C");
        current.roomLastAlert = 0;
    }
    const abnormal = current.kilnZone === "high" || current.kilnZone === "low";
    const wasAbnormal = previous.kilnZone === "high" || previous.kilnZone === "low";
    if (abnormal && (current.kilnZone !== previous.kilnZone ||
        eventNow - Number(previous.kilnLastAlert || 0) >= 3600000)) {
        const condition = current.kilnZone === "high" ? "สูงตั้งแต่ 600°C" : "ต่ำกว่าหรือเท่ากับ 100°C";
        alert("อุณหภูมิเตาเผา ${oven} " + condition + " = " + msg.stcr.ovenTemp + "°C");
        current.kilnLastAlert = eventNow;
    } else if (!abnormal && wasAbnormal) {
        alert("อุณหภูมิเตาเผา ${oven} กลับสู่ช่วงปกติ = " + msg.stcr.ovenTemp + "°C");
        current.kilnLastAlert = 0;
    }
}
flow.set(eventKey, current);
flow.set("latest_oven_${oven}", {
    ...sensorPayload,
    warmState: msg.stcr.warmState,
    receivedAt: new Date().toISOString()
});
return [
    { payload: statusPayload },
    { payload: sensorPayload },
    alerts.length ? alerts : null
];`;
  publish.outputs = 3;
  publish.wires = [
    ["stcr_v2_mqtt_status"],
    ["stcr_v2_mqtt_sensor"],
    [alertLinkId],
  ];
}

const phases = [
  { name: "AB", address: 8632 },
  { name: "BC", address: 8642 },
  { name: "CA", address: 8652 },
];
add({
  id: "stcr_v3_voltage_inject",
  type: "inject",
  z: mainTab,
  name: "อ่านแรงดันไฟฟ้าทุก 1 นาที · เริ่มวินาที 52",
  props: [{ p: "payload" }, { p: "topic", vt: "str" }],
  repeat: "60",
  crontab: "",
  once: true,
  onceDelay: 52,
  topic: "",
  payload: "",
  payloadType: "date",
  x: 210,
  y: 1140,
  wires: [["stcr_v3_voltage_ab_get"]],
});
for (let index = 0; index < phases.length; index += 1) {
  const phase = phases[index];
  const getId = `stcr_v3_voltage_${phase.name.toLowerCase()}_get`;
  const storeId = `stcr_v3_voltage_${phase.name.toLowerCase()}_store`;
  const next =
    index < phases.length - 1
      ? `stcr_v3_voltage_${phases[index + 1].name.toLowerCase()}_get`
      : "stcr_v3_voltage_check";
  newGetters.push(getId);
  retryInfo[getId] = { oven: null, label: `แรงดันเฟส ${phase.name}` };
  add(
    getter({
      id: getId,
      name: `แรงดันเฟส ${phase.name}`,
      unit: 183,
      address: phase.address,
      quantity: 2,
      dataType: "InputRegister",
      x: 450 + index * 360,
      y: 1140,
      wire: storeId,
    }),
    fn(
      storeId,
      mainTab,
      `แปลงแรงดันเฟส ${phase.name}`,
      `const words = Array.isArray(msg.payload) ? msg.payload.map(Number) : [];
if (words.length < 2 || !words.every(Number.isFinite)) {
    node.error("ค่าแรงดันเฟส ${phase.name} ไม่ครบ", msg);
    return null;
}
const buffer = new ArrayBuffer(4);
const integers = new Uint16Array(buffer);
integers[0] = words[0];
integers[1] = words[1];
const value = Number(new Float32Array(buffer)[0]);
if (!Number.isFinite(value) || value < 0 || value > 1000) {
    node.error("ค่าแรงดันเฟส ${phase.name} ไม่ถูกต้อง", msg);
    return null;
}
msg.stcrVoltage = msg.stcrVoltage || {};
msg.stcrVoltage.${phase.name} = Number(value.toFixed(2));
return msg;`,
      1,
      630 + index * 360,
      1140,
      [[next]],
    ),
  );
}
add(
  fn(
    "stcr_v3_voltage_check",
    mainTab,
    "ตรวจแรงดันไฟฟ้าและแจ้งเตือน",
    `const voltage = msg.stcrVoltage || {};
if (![voltage.AB, voltage.BC, voltage.CA].every(Number.isFinite)) {
    node.error("ค่าแรงดันไฟฟ้าไม่ครบทั้ง 3 เฟส", msg);
    return null;
}
const now = Date.now();
const previous = flow.get("stcr_v3_voltage_state");
const current = { states: {}, lastAlert: { ...(previous?.lastAlert || {}) } };
const alerts = [];
for (const phase of ["AB", "BC", "CA"]) {
    const value = voltage[phase];
    const state = value > 425 ? "high" : (value < 360 ? "low" : "normal");
    current.states[phase] = state;
    if (!previous) continue;
    const oldState = previous.states?.[phase] || "normal";
    const last = Number(previous.lastAlert?.[phase] || 0);
    if (state !== "normal" && (state !== oldState || now - last >= 3600000)) {
        const condition = state === "high" ? "สูงกว่า 425 V" : "ต่ำกว่า 360 V";
        alerts.push({ payload: { kind: "alert", text: "แรงดันเฟส " + phase + " " + condition + " = " + value.toFixed(2) + " V" } });
        current.lastAlert[phase] = now;
    } else if (state === "normal" && oldState !== "normal") {
        alerts.push({ payload: { kind: "alert", text: "แรงดันเฟส " + phase + " กลับสู่ช่วงปกติ = " + value.toFixed(2) + " V" } });
        current.lastAlert[phase] = 0;
    }
}
flow.set("stcr_v3_voltage_state", current);
flow.set("latest_voltage", { ...voltage, receivedAt: new Date().toISOString() });
return alerts.length ? alerts : null;`,
    1,
    1600,
    1140,
    [[alertLinkId]],
  ),
  {
    id: "stcr_v3_voltage_test_inject",
    type: "inject",
    z: mainTab,
    name: "ทดสอบส่งแรงดัน AB/BC/CA ทันที",
    props: [{ p: "payload" }],
    repeat: "",
    crontab: "",
    once: false,
    onceDelay: 0.1,
    payload: "",
    payloadType: "date",
    x: 230,
    y: 1180,
    wires: [["stcr_v3_voltage_test_format"]],
  },
  fn(
    "stcr_v3_voltage_test_format",
    mainTab,
    "ตรวจค่าสดและสร้างข้อความทดสอบแรงดัน",
    `const voltage = flow.get("latest_voltage");
const receivedAt = Date.parse(voltage?.receivedAt || "");
const age = Date.now() - receivedAt;
if (!voltage || !Number.isFinite(receivedAt) || age > 120000 ||
    ![voltage.AB, voltage.BC, voltage.CA].every(Number.isFinite)) {
    msg.payload = {
        ok: false,
        message: "ยังไม่มีค่าแรงดัน AB/BC/CA ที่ครบและใหม่ภายใน 2 นาที",
        receivedAt: voltage?.receivedAt || null
    };
    node.warn(msg.payload.message);
    return [null, msg];
}
msg.payload = {
    kind: "alert",
    text: "ทดสอบค่าแรงดันไฟฟ้า STCR V3" +
        "\\nAB: " + Number(voltage.AB).toFixed(2) + " V" +
        "\\nBC: " + Number(voltage.BC).toFixed(2) + " V" +
        "\\nCA: " + Number(voltage.CA).toFixed(2) + " V"
};
return [msg, null];`,
    2,
    540,
    1180,
    [[alertLinkId], ["stcr_v3_voltage_test_debug"]],
  ),
  {
    id: "stcr_v3_voltage_test_debug",
    type: "debug",
    z: mainTab,
    name: "ผลทดสอบแรงดันไฟฟ้า",
    active: true,
    tosidebar: true,
    console: false,
    tostatus: false,
    complete: "payload",
    targetType: "msg",
    statusVal: "",
    statusType: "auto",
    x: 820,
    y: 1180,
    wires: [],
  },
);

const hourly = nodes.find((node) => node.id === "stcr_v2_hourly_format");
if (!hourly) throw new Error("ไม่พบ Function สรุปรายชั่วโมง");
hourly.name = "รอข้อมูลครบ 9 เตาและแรงดัน 3 เฟส";
hourly.func = hourly.func
  .replace(
    "msg.payload = output;",
    `const voltage = flow.get("latest_voltage");
const voltageAt = Date.parse(voltage?.receivedAt || "");
if (!voltage || !Number.isFinite(voltageAt) || now - voltageAt > 90000) {
    missing.push("แรงดันไฟฟ้า");
} else {
    output.voltage = { AB: Number(voltage.AB), BC: Number(voltage.BC), CA: Number(voltage.CA) };
}
if (missing.length > 0) {
    msg.summaryAttempt = Number(msg.summaryAttempt || 0) + 1;
    if (msg.summaryAttempt <= 6) return [null, msg];
    node.error("ยกเลิกสรุป: ข้อมูลไม่ครบ " + missing.join(", "), msg);
    return [null, null];
}
msg.payload = { kind: "summary", data: output };`,
  )
  .replace(
    /output\["oven" \+ oven\] = \{([\s\S]*?)\n    \};/,
    `output["oven" + oven] = {$1,
        warm_state: Boolean(data.warmState)
    };`,
  );
const oldSummaryOut = nodes.find((node) => node.id === "stcr_v2_line_link_out");
oldSummaryOut.id = "stcr_v3_summary_out";
oldSummaryOut.name = "ส่งสรุปไป LINE V3";
oldSummaryOut.links = ["stcr_v3_summary_in"];
hourly.wires[0] = ["stcr_v3_summary_out"];
add({
  id: alertLinkId,
  type: "link out",
  z: mainTab,
  name: "ส่งแจ้งเตือนไป LINE V3",
  mode: "link",
  links: ["stcr_v3_alert_in"],
  x: 1800,
  y: 1080,
  wires: [],
});

const retryCatch = nodes.find((node) => node.id === "stcr_v2_retry_catch");
const retryController = nodes.find((node) => node.id === "stcr_v2_retry_controller");
const retryRoute = nodes.find((node) => node.id === "stcr_v2_retry_route");
retryCatch.scope.push(...newGetters);
for (const getterId of newGetters) {
  retryRoute.rules.push({ t: "eq", v: getterId, vt: "str" });
  retryRoute.wires.push([getterId]);
}
retryRoute.outputs = retryRoute.wires.length;
const oldMapMatch = retryController.func.match(/const metadata = ([\s\S]*?);\nconst target/);
const oldMap = oldMapMatch ? JSON.parse(oldMapMatch[1]) : {};
retryController.func = `const metadata = ${JSON.stringify({ ...oldMap, ...retryInfo })};
const target = msg.error?.source?.id || "";
const detail = metadata[target];
if (!detail) return [null, msg];
const previous = msg.stcrRetry || {};
const attempt = previous.target === target ? Number(previous.attempt || 0) + 1 : 1;
const errorMessage = msg.error?.message || "Modbus read failed";
delete msg.error;
const label = (detail.oven ? "เตา " + detail.oven + " · " : "") + detail.label;
if (attempt <= 2) {
    msg.stcrRetry = { target, attempt };
    msg.stcrRetryTarget = target;
    node.warn("Retry " + attempt + "/2 · " + label);
    return [msg, null];
}
msg.payload = {
    time: new Date().toISOString(),
    nodeId: target,
    nodeName: label,
    oven: detail.oven || null,
    attempts: attempt,
    message: errorMessage
};
delete msg.stcrRetry;
delete msg.stcrRetryTarget;
return [null, msg];`;

const errorFormat = nodes.find((node) => node.id === "stcr_v2_error_format");
if (!errorFormat) throw new Error("ไม่พบ Function สรุปข้อผิดพลาด");
errorFormat.name = "บันทึกข้อผิดพลาดและแจ้ง LINE";
errorFormat.func = `const value = msg.payload || {};
node.warn(JSON.stringify(value));
const key = "stcr_v3_modbus_error_" + (value.nodeId || "unknown");
const now = Date.now();
const last = Number(flow.get(key) || 0);
if (now - last >= 900000) {
    flow.set(key, now);
    const text = "ขาดการเชื่อมต่อ Modbus: " + (value.nodeName || "ไม่ทราบจุด") +
        "\\nลองอ่านแล้ว " + (value.attempts || 3) + " ครั้ง\\n" + (value.message || "");
    return [msg, { payload: { kind: "alert", text } }];
}
return [msg, null];`;
errorFormat.outputs = 2;
errorFormat.wires = [["stcr_v2_error_debug"], [alertLinkId]];

// Clean LINE sender tab. Credentials are entered as tab environment values, not copied into this file.
const notifyTab = "stcr_ttn_notify_v3";
add(
  {
    id: notifyTab,
    type: "tab",
    label: "STCR · ส่ง LINE (V3)",
    disabled: true,
    info:
      "ไม่มีการอ่าน Modbus ซ้ำ เปิด Properties > Environment Variables แล้วใส่ STCR_LINE_TOKEN และ STCR_LINE_TO",
    env: [
      { name: "STCR_LINE_TOKEN", value: lineToken, type: "str" },
      { name: "STCR_LINE_TO", value: lineRecipient, type: "str" },
    ],
  },
  {
    id: "stcr_v3_alert_in",
    type: "link in",
    z: notifyTab,
    name: "รับแจ้งเตือนจาก STCR V3",
    links: [alertLinkId],
    x: 125,
    y: 120,
    wires: [["stcr_v3_line_prepare"]],
  },
  {
    id: "stcr_v3_summary_in",
    type: "link in",
    z: notifyTab,
    name: "รับสรุปรายชั่วโมงจาก STCR V3",
    links: ["stcr_v3_summary_out"],
    x: 125,
    y: 180,
    wires: [["stcr_v3_line_prepare"]],
  },
  {
    id: "stcr_v3_line_test",
    type: "inject",
    z: notifyTab,
    name: "ทดสอบส่ง LINE ทันที",
    props: [{ p: "payload" }],
    repeat: "",
    crontab: "",
    once: false,
    onceDelay: 0.1,
    payload: '{"kind":"alert","text":"ทดสอบระบบแจ้งเตือน STCR V3 สำเร็จ"}',
    payloadType: "json",
    x: 210,
    y: 240,
    wires: [["stcr_v3_line_prepare"]],
  },
  fn(
    "stcr_v3_line_prepare",
    notifyTab,
    "ตรวจค่าตั้งและสร้างข้อความ LINE",
    `const token = env.get("STCR_LINE_TOKEN");
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
    const lines = [
        "รายงานแรงดันเฟส",
        "AB: " + Number(voltage.AB).toFixed(2) + " V",
        "BC: " + Number(voltage.BC).toFixed(2) + " V",
        "CA: " + Number(voltage.CA).toFixed(2) + " V",
        "=======================",
        "เตา, รอบ, Tห้อง, Tเตา, TBlower, %ชื้น, ทำงาน, อุ่น"
    ];
    for (let oven = 1; oven <= 9; oven += 1) {
        const item = data["oven" + oven];
        if (!item) continue;
        lines.push([
            oven, Number(item.count), Number(item.room_temp).toFixed(2),
            Number(item.oven_temp).toFixed(1), Number(item.blower_temp).toFixed(1),
            Number(item.humidity).toFixed(2), item.oven_state ? "เปิด" : "ปิด",
            item.warm_state ? "เปิด" : "ปิด"
        ].join(", "));
    }
    text = lines.join("\\n");
}
if (!text) return null;
msg.payload = { to: recipient, messages: [{ type: "text", text }] };
msg.headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
return msg;`,
    1,
    430,
    160,
    [["stcr_v3_line_queue"]],
  ),
  {
    id: "stcr_v3_line_queue",
    type: "delay",
    z: notifyTab,
    name: "คิว LINE · 1 ข้อความต่อวินาที",
    pauseType: "rate",
    timeout: "1",
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
    x: 690,
    y: 160,
    wires: [["stcr_v3_line_request"]],
  },
  {
    id: "stcr_v3_line_request",
    type: "http request",
    z: notifyTab,
    name: "ส่ง LINE Messaging API",
    method: "POST",
    ret: "obj",
    paytoqs: "ignore",
    url: "https://api.line.me/v2/bot/message/push",
    persist: false,
    authType: "",
    senderr: false,
    headers: [],
    x: 940,
    y: 160,
    wires: [["stcr_v3_line_result"]],
  },
  {
    id: "stcr_v3_line_result",
    type: "debug",
    z: notifyTab,
    name: "ผลการส่ง LINE V3",
    active: true,
    tosidebar: true,
    console: false,
    tostatus: false,
    complete: "payload",
    targetType: "msg",
    statusVal: "",
    statusType: "auto",
    x: 1170,
    y: 160,
    wires: [],
  },
);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const serialized = JSON.stringify(nodes, null, 2).replaceAll("stcr_v2_", "stcr_v3_");
fs.writeFileSync(outputPath, `${serialized}\n`, "utf8");
console.log(`Created ${outputPath}`);
console.log(`Nodes=${nodes.length}, added getters=${newGetters.length}`);
console.log(`LINE settings=${embedLineSecrets ? "embedded" : "empty"}`);
