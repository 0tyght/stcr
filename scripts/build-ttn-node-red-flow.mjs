import fs from "node:fs";
import path from "node:path";

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const sourcePath = path.resolve(
  argument("--source", path.join(process.env.USERPROFILE || "", "Downloads", "flows (2).json")),
);
const outputPath = path.resolve(
  argument("--output", path.join("output", "node-red", "ttn-production-ingestion-v2.json")),
);

const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const findConfig = (type, name) => source.find((node) => node.type === type && node.name === name);
const mqttOut = source.find(
  (node) => node.type === "mqtt out" && node.topic === "sensor" && node.broker,
);
const lineMessageFunction = source.find(
  (node) =>
    node.type === "function" &&
    typeof node.func === "string" &&
    node.func.includes('"messages"') &&
    node.func.includes('"to"') &&
    node.func.includes("Data for oven"),
);

const clients = {
  183: findConfig("modbus-client", "PLC123_183"),
  184: findConfig("modbus-client", "PLC456_184"),
  185: findConfig("modbus-client", "PLC789_185"),
};

if (!mqttOut) throw new Error("ไม่พบ MQTT broker ของ Topic sensor ใน Flow ต้นฉบับ");
if (!lineMessageFunction) throw new Error("ไม่พบ Function ส่งสรุป LINE ใน Flow ต้นฉบับ");
for (const unit of [183, 184, 185]) {
  if (!clients[unit]) throw new Error(`ไม่พบ Modbus client สำหรับ PLC ${unit}`);
}

const tabId = "stcr_ttn_ingestion_v2";
const runtimeClients = Object.fromEntries(
  [183, 184, 185].map((unit) => [
    unit,
    {
      ...clients[unit],
      id: `stcr_v2_modbus_client_${unit}`,
      name: `STCR V2 · PLC ${unit}`,
      commandDelay: "50",
      clientTimeout: "3000",
      reconnectOnTimeout: true,
      reconnectTimeout: "2000",
    },
  ]),
);
const nodes = [
  {
    id: tabId,
    type: "tab",
    label: "STCR - รับข้อมูล TTN (V2)",
    disabled: true,
    info:
      "Flow รับข้อมูลจริง TTN เตา 1-9 แบบอ่าน Modbus ตามลำดับและเหลื่อมเวลา\n\n" +
      "ก่อนเปิดใช้งาน: ปิด Flow DB เดิม เพื่อป้องกันการส่ง MQTT ซ้ำ แล้ว Deploy ทั้งหมด\n\n" +
      "การแจ้งเตือนเรียก Function LINE เดิม จึงใช้ Token และกลุ่มผู้รับเดิมโดยไม่คัดลอกรหัสลับ",
    env: [],
  },
  {
    id: "stcr_v2_note",
    type: "comment",
    z: tabId,
    name: "ปิด Flow DB เดิมก่อนเปิด Flow นี้ — ห้ามให้สอง Flow ส่ง Topic test/sensor พร้อมกัน",
    info: "",
    x: 420,
    y: 40,
    wires: [],
  },
  {
    id: "stcr_v2_mqtt_status",
    type: "mqtt out",
    z: tabId,
    name: "ส่งสถานะทุกเตา",
    topic: "test",
    qos: "1",
    retain: "false",
    respTopic: "",
    contentType: "application/json",
    userProps: "",
    correl: "",
    expiry: "",
    broker: mqttOut.broker,
    x: 1500,
    y: 80,
    wires: [],
  },
  {
    id: "stcr_v2_mqtt_sensor",
    type: "mqtt out",
    z: tabId,
    name: "ส่งค่าเซนเซอร์ทุกเตา",
    topic: "sensor",
    qos: "1",
    retain: "false",
    respTopic: "",
    contentType: "application/json",
    userProps: "",
    correl: "",
    expiry: "",
    broker: mqttOut.broker,
    x: 1500,
    y: 120,
    wires: [],
  },
  ...Object.values(runtimeClients),
];

function modbusGetter({ id, oven, label, unit, address, quantity, dataType, x, y, wire }) {
  return {
    id,
    type: "modbus-getter",
    z: tabId,
    name: `เตา ${oven} · ${label}`,
    showStatusActivities: false,
    showErrors: true,
    logIOActivities: false,
    unitid: String(unit),
    dataType,
    adr: String(address),
    quantity: String(quantity),
    server: runtimeClients[unit].id,
    useIOFile: false,
    ioFile: "",
    useIOForPayload: false,
    emptyMsgOnFail: false,
    keepMsgProperties: true,
    x,
    y,
    wires: [[wire], []],
  };
}

function functionNode(id, name, code, outputs, x, y, wires) {
  return {
    id,
    type: "function",
    z: tabId,
    name,
    func: code,
    outputs,
    timeout: 0,
    noerr: 0,
    initialize: "",
    finalize: "",
    libs: [],
    x,
    y,
    wires,
  };
}

const getterIds = [];
const retryDefinitions = [];
const schedules = [
  { ovens: [1, 4, 7], delay: 2 },
  { ovens: [2, 5, 8], delay: 22 },
  { ovens: [3, 6, 9], delay: 42 },
];
const ovenSchedule = new Map(
  schedules.flatMap(({ ovens, delay }) => ovens.map((oven) => [oven, delay])),
);

for (let oven = 1; oven <= 9; oven += 1) {
  const groupIndex = Math.floor((oven - 1) / 3);
  const registerIndex = (oven - 1) % 3;
  const unit = 183 + groupIndex;
  const server = clients[unit];
  const startAddress = 4172 + registerIndex * 1000;
  const kilnAddress = 1632 + registerIndex * 2;
  const humidityAddress = 1832 + registerIndex * 2;
  const countAddress = 1912 + registerIndex;
  const baseY = 180 + (oven - 1) * 100;
  const prefix = `stcr_v2_o${oven}`;
  const injectId = `${prefix}_inject`;
  const statusGetId = `${prefix}_status_get`;
  const statusStoreId = `${prefix}_status_store`;
  const countGetId = `${prefix}_count_get`;
  const countStoreId = `${prefix}_count_store`;
  const kilnGetId = `${prefix}_kiln_get`;
  const kilnStoreId = `${prefix}_kiln_store`;
  const humidityGetId = `${prefix}_humidity_get`;
  const publishId = `${prefix}_publish`;
  getterIds.push(statusGetId, countGetId, kilnGetId, humidityGetId);
  retryDefinitions.push(
    { id: statusGetId, oven, label: "สถานะเปิด/ปิด", y: baseY },
    { id: countGetId, oven, label: "เลขรอบ", y: baseY },
    { id: kilnGetId, oven, label: "อุณหภูมิเตาและ Blower", y: baseY + 34 },
    { id: humidityGetId, oven, label: "ความชื้นและอุณหภูมิห้องอบ", y: baseY + 34 },
  );

  nodes.push(
    {
      id: injectId,
      type: "inject",
      z: tabId,
      name: `อ่านเตา ${oven} ทุก 1 นาที · เริ่มวินาที ${ovenSchedule.get(oven)}`,
      props: [{ p: "payload" }, { p: "topic", vt: "str" }],
      repeat: "60",
      crontab: "",
      once: true,
      onceDelay: ovenSchedule.get(oven),
      topic: "",
      payload: String(oven),
      payloadType: "num",
      x: 190,
      y: baseY,
      wires: [[statusGetId]],
    },
    modbusGetter({
      id: statusGetId,
      oven,
      label: "สถานะเปิด/ปิด",
      unit,
      address: startAddress,
      quantity: 1,
      dataType: "Input",
      x: 470,
      y: baseY,
      wire: statusStoreId,
    }),
    functionNode(
      statusStoreId,
      `ตรวจสถานะเตา ${oven}`,
      `const value = Array.isArray(msg.payload) ? msg.payload[0] : msg.payload;
if (value !== true && value !== false && value !== 0 && value !== 1) {
    node.error("สถานะเตา ${oven} ไม่ถูกต้อง", msg);
    return null;
}
msg.stcr = {
    oven: ${oven},
    ovenState: value === true || Number(value) === 1,
    readStartedAt: new Date().toISOString()
};
return msg;`,
      1,
      700,
      baseY,
      [[countGetId]],
    ),
    modbusGetter({
      id: countGetId,
      oven,
      label: "เลขรอบ",
      unit,
      address: countAddress,
      quantity: 1,
      dataType: "InputRegister",
      x: 900,
      y: baseY,
      wire: countStoreId,
    }),
    functionNode(
      countStoreId,
      `เก็บเลขรอบและอ่านค่าต่อ · เตา ${oven}`,
      `const values = Array.isArray(msg.payload) ? msg.payload : [];
const cycle = Number(values[0]);
if (!Number.isFinite(cycle) || cycle < 0) {
    node.error("เลขรอบเตา ${oven} ไม่ถูกต้อง", msg);
    return null;
}
msg.stcr.cycle = cycle;
return msg;`,
      1,
      1160,
      baseY,
      [[kilnGetId]],
    ),
    modbusGetter({
      id: kilnGetId,
      oven,
      label: "อุณหภูมิเตาและ Blower",
      unit,
      address: kilnAddress,
      quantity: 2,
      dataType: "InputRegister",
      x: 470,
      y: baseY + 34,
      wire: kilnStoreId,
    }),
    functionNode(
      kilnStoreId,
      `เก็บค่าเตาและ Blower · เตา ${oven}`,
      `const values = Array.isArray(msg.payload) ? msg.payload.map(Number) : [];
if (values.length < 2 || !values.every(Number.isFinite)) {
    node.error("ค่าเตา/Blower เตา ${oven} ไม่ครบ", msg);
    return null;
}
msg.stcr.ovenTemp = values[0];
msg.stcr.blowerTemp = values[1];
return msg;`,
      1,
      760,
      baseY + 34,
      [[humidityGetId]],
    ),
    modbusGetter({
      id: humidityGetId,
      oven,
      label: "ความชื้นและอุณหภูมิห้องอบ",
      unit,
      address: humidityAddress,
      quantity: 2,
      dataType: "InputRegister",
      x: 1020,
      y: baseY + 34,
      wire: publishId,
    }),
    functionNode(
      publishId,
      `ตรวจและส่งเซนเซอร์ · เตา ${oven}`,
      `const values = Array.isArray(msg.payload) ? msg.payload.map(Number) : [];
if (values.length < 2 || !values.every(Number.isFinite)) {
    node.error("ค่าความชื้น/ห้องอบ เตา ${oven} ไม่ครบ", msg);
    return null;
}
const humidity = values[0] / 100;
const roomTemp = values[1] / 100;
if (humidity < 0 || humidity > 100 || roomTemp < -40 || roomTemp > 150 ||
    msg.stcr.ovenTemp < -40 || msg.stcr.ovenTemp > 1000 ||
    msg.stcr.blowerTemp < -40 || msg.stcr.blowerTemp > 600) {
    node.error("ค่าเซนเซอร์เตา ${oven} อยู่นอกช่วง", msg);
    return null;
}
const now = new Date();
now.setMinutes(now.getMinutes() + 420);
const sensorPayload = {
    startoven: msg.stcr.ovenState ? 1 : 0,
    oven: ${oven},
    cycle: msg.stcr.cycle,
    oventemp: msg.stcr.ovenTemp,
    blower: msg.stcr.blowerTemp,
    roomtemp: roomTemp,
    humanity: humidity,
    page: 1,
    time_stamp: now.toISOString()
};
const statusPayload = {
    oven: ${oven},
    cycle: msg.stcr.cycle,
    oven_state: msg.stcr.ovenState,
    time_stamp: now.toISOString()
};
flow.set("latest_oven_${oven}", { ...sensorPayload, receivedAt: new Date().toISOString() });
return [
    { payload: statusPayload },
    { payload: sensorPayload }
];`,
      2,
      1320,
      baseY + 34,
      [["stcr_v2_mqtt_status"], ["stcr_v2_mqtt_sensor"]],
    ),
  );
}

const retryMetadataJson = JSON.stringify(
  Object.fromEntries(
    retryDefinitions.map((item) => [
      item.id,
      { oven: item.oven, label: item.label },
    ]),
  ),
);

nodes.push(
  {
    id: "stcr_v2_hourly_inject",
    type: "inject",
    z: tabId,
    name: "ส่งสรุปทุกต้นชั่วโมง",
    props: [{ p: "payload" }, { p: "topic", vt: "str" }],
    repeat: "",
    crontab: "1 * * * *",
    once: false,
    onceDelay: 0.1,
    topic: "",
    payload: "",
    payloadType: "date",
    x: 220,
    y: 1160,
    wires: [["stcr_v2_hourly_format"]],
  },
  functionNode(
    "stcr_v2_hourly_format",
    "รอข้อมูลครบ 9 เตาก่อนสร้างสรุป",
    `const output = {};
const now = Date.now();
const missing = [];
for (let oven = 1; oven <= 9; oven += 1) {
    const data = flow.get("latest_oven_" + oven);
    const receivedAt = Date.parse(data?.receivedAt || "");
    if (!data || !Number.isFinite(receivedAt) || now - receivedAt > 90000) {
        missing.push(oven);
        continue;
    }
    output["oven" + oven] = {
        room_temp: Number(data.roomtemp),
        humidity: Number(data.humanity),
        count: Number(data.cycle),
        blower_temp: Number(data.blower),
        oven_temp: Number(data.oventemp),
        oven_state: Number(data.startoven) === 1
    };
}
if (missing.length > 0) {
    msg.summaryAttempt = Number(msg.summaryAttempt || 0) + 1;
    msg.missingOvens = missing;
    if (msg.summaryAttempt <= 6) {
        node.warn("รอข้อมูลเตา " + missing.join(", ") + " · ครั้งที่ " + msg.summaryAttempt + "/6");
        return [null, msg];
    }
    node.error("ยกเลิกสรุปรายชั่วโมง: ข้อมูลไม่ครบ เตา " + missing.join(", "), msg);
    return [null, null];
}
msg.payload = output;
delete msg.summaryAttempt;
delete msg.missingOvens;
return [msg, null];`,
    2,
    540,
    1160,
    [["stcr_v2_line_link_out"], ["stcr_v2_summary_wait"]],
  ),
  {
    id: "stcr_v2_summary_wait",
    type: "delay",
    z: tabId,
    name: "รอข้อมูลที่ขาด 10 วินาที",
    pauseType: "delay",
    timeout: "10",
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
    x: 550,
    y: 1200,
    wires: [["stcr_v2_hourly_format"]],
  },
  {
    id: "stcr_v2_line_link_out",
    type: "link out",
    z: tabId,
    name: "ส่งเข้าชุด LINE เดิม",
    mode: "link",
    links: ["stcr_v2_line_bridge_in"],
    x: 850,
    y: 1160,
    wires: [],
  },
  {
    id: "stcr_v2_retry_catch",
    type: "catch",
    z: tabId,
    name: "จับ Timeout จาก Modbus ทุกจุด",
    scope: getterIds,
    uncaught: false,
    x: 230,
    y: 1260,
    wires: [["stcr_v2_retry_controller"]],
  },
  functionNode(
    "stcr_v2_retry_controller",
    "ควบคุม Retry สูงสุด 2 ครั้ง",
    `const metadata = ${retryMetadataJson};
const target = msg.error?.source?.id || "";
const detail = metadata[target];
if (!detail) {
    msg.payload = {
        time: new Date().toISOString(),
        nodeId: target || null,
        nodeName: msg.error?.source?.name || null,
        message: msg.error?.message || "Modbus read failed"
    };
    return [null, msg];
}
const previous = msg.stcrRetry || {};
const attempt = previous.target === target ? Number(previous.attempt || 0) + 1 : 1;
const errorMessage = msg.error?.message || "Modbus read failed";
delete msg.error;
if (attempt <= 2) {
    msg.stcrRetry = { target, attempt };
    msg.stcrRetryTarget = target;
    node.warn("Retry " + attempt + "/2 · เตา " + detail.oven + " · " + detail.label);
    return [msg, null];
}
msg.payload = {
    time: new Date().toISOString(),
    nodeId: target,
    nodeName: "เตา " + detail.oven + " · " + detail.label,
    oven: detail.oven,
    attempts: attempt,
    message: errorMessage
};
delete msg.stcrRetry;
delete msg.stcrRetryTarget;
return [null, msg];`,
    2,
    500,
    1260,
    [["stcr_v2_retry_wait"], ["stcr_v2_error_format"]],
  ),
  {
    id: "stcr_v2_retry_wait",
    type: "delay",
    z: tabId,
    name: "รอก่อน Retry 1.5 วินาที",
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
    x: 760,
    y: 1260,
    wires: [["stcr_v2_retry_route"]],
  },
  {
    id: "stcr_v2_retry_route",
    type: "switch",
    z: tabId,
    name: "ส่งกลับไปยังจุดที่ Timeout",
    property: "stcrRetryTarget",
    propertyType: "msg",
    rules: getterIds.map((id) => ({ t: "eq", v: id, vt: "str" })),
    checkall: "true",
    repair: false,
    outputs: getterIds.length,
    x: 1030,
    y: 1260,
    wires: getterIds.map((id) => [id]),
  },
  functionNode(
    "stcr_v2_error_format",
    "สรุปข้อผิดพลาด",
    `if (!msg.payload || typeof msg.payload !== "object" || !msg.payload.time) {
    const source = msg.error?.source || {};
    msg.payload = {
        time: new Date().toISOString(),
        nodeId: source.id || null,
        nodeName: source.name || null,
        message: msg.error?.message || "Modbus read failed"
    };
}
node.warn(JSON.stringify(msg.payload));
return msg;`,
    1,
    530,
    1210,
    [["stcr_v2_error_debug"]],
  ),
  {
    id: "stcr_v2_error_debug",
    type: "debug",
    z: tabId,
    name: "ข้อผิดพลาด STCR",
    active: true,
    tosidebar: true,
    console: false,
    tostatus: false,
    complete: "payload",
    targetType: "msg",
    statusVal: "",
    statusType: "auto",
    x: 790,
    y: 1210,
    wires: [],
  },
);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(nodes, null, 2)}\n`, "utf8");
console.log(`Created ${outputPath}`);
console.log("The generated tab is disabled. Disable the old DB tab before enabling this one.");
