import fs from "node:fs";
import path from "node:path";

const workspace = process.cwd();
const grSource = process.argv[2] || "C:/Users/Admin/OneDrive/Documents/flows (21).json";
const ttnSource = process.argv[3] || path.join(workspace, "output/node-red/ttn-production-complete-v8.json");
const outputDir = path.join(workspace, "output/node-red");

function readFlow(file) {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(value)) throw new Error(`Flow must be an array: ${file}`);
  return value;
}

function requireNode(flow, id) {
  const node = flow.find((item) => item.id === id);
  if (!node) throw new Error(`Node not found: ${id}`);
  return node;
}

function ensureUniqueIds(flow) {
  const seen = new Set();
  for (const node of flow) {
    if (!node.id || seen.has(node.id)) throw new Error(`Duplicate or missing node id: ${node.id}`);
    seen.add(node.id);
  }
  for (const node of flow) {
    for (const output of node.wires || []) {
      for (const id of output) {
        if (!seen.has(id)) throw new Error(`Missing wire target ${id} from ${node.id}`);
      }
    }
  }
}

function extractLegacyGrCredentials(flow) {
  const headersNode = requireNode(flow, "667af4150a3e2f61");
  const reportNode = requireNode(flow, "6f57dc862dac4db1");
  const token = headersNode.func.match(/Authorization["']?\s*:\s*["']Bearer\s+([^"']+)["']/)?.[1];
  const recipient = reportNode.func.match(/["']to["']\s*:\s*["']([^"']+)["']/)?.[1];
  if (!token || !recipient) throw new Error("Cannot extract existing GR LINE credentials");
  return { token, recipient };
}

const grProfilesLiteral = JSON.stringify(Object.fromEntries([
  ...Array.from({ length: 7 }, (_, index) => [String(index + 11), ["roomtemp", "humanity"]]),
  ["18", ["oventemp", "roomtemp", "humanity"]],
  ...Array.from({ length: 8 }, (_, index) => [String(index + 19), ["oventemp", "blower", "roomtemp", "humanity"]]),
]));

function buildGr(source) {
  const flow = readFlow(source);
  const tab = "ca7ab62157754851";
  const credentials = extractLegacyGrCredentials(flow);

  const oldTrigger = requireNode(flow, "48cb6b56f72fd085");
  oldTrigger.d = true;
  oldTrigger.name = "ปิดใช้ · รายงานแบบอ่าน Modbus พร้อมกัน (V8 เดิม)";

  const voltageNodes = {
    f69bc1150dcf4686: "AB",
    b898f7c11ecae4f6: "BC",
    "6794a2db399465cf": "CA",
  };
  for (const id of Object.keys(voltageNodes)) {
    const node = requireNode(flow, id);
    if (!node.wires[0].includes("stcr_gr_v9_voltage_cache")) node.wires[0].push("stcr_gr_v9_voltage_cache");
  }

  const groupId = "stcr_gr_v9_hourly_group";
  flow.push(
    {
      id: "stcr_gr_v9_voltage_cache",
      type: "function",
      z: "90dce9570f965374",
      name: "เก็บแรงดันล่าสุดสำหรับรายงาน V9",
      func: `const value = msg.payload || {};
const cache = global.get("latest_gr_voltage") || {};
let changed = false;
for (const phase of ["AB","BC","CA"]) {
    if (value[phase] === null || value[phase] === undefined || value[phase] === "") continue;
    const number = Number(value[phase]);
    if (!Number.isFinite(number) || number < 0 || number > 500) continue;
    cache[phase] = number;
    cache[phase + "_receivedAt"] = new Date().toISOString();
    changed = true;
}
if (changed) global.set("latest_gr_voltage",cache);
return null;`,
      outputs: 1,
      timeout: 0,
      noerr: 0,
      initialize: "",
      finalize: "",
      libs: [],
      x: 3590,
      y: 1970,
      wires: [[]],
    },
    {
      id: groupId,
      type: "group",
      z: tab,
      name: "รายงานรายชั่วโมง V9 · ใช้ค่าล่าสุด รอข้อมูลครบ และลองส่งใหม่",
      style: { label: true, color: "#2e7d32", fill: "#e8f5e9", fillOpacity: "0.35" },
      nodes: [
        "stcr_gr_v9_hourly_tick",
        "stcr_gr_v9_hourly_build",
        "stcr_gr_v9_line_headers",
        "stcr_gr_v9_line_queue",
        "stcr_gr_v9_line_request",
        "stcr_gr_v9_line_verify",
        "stcr_gr_v9_line_catch",
        "stcr_gr_v9_hourly_manual",
        "stcr_gr_v9_hourly_status",
      ],
      x: 14,
      y: 799,
      w: 1192,
      h: 202,
    },
    {
      id: "stcr_gr_v9_hourly_tick",
      type: "inject",
      z: tab,
      g: groupId,
      name: "ตรวจรายงานทุก 1 นาที · รอครบได้ทั้งชั่วโมง",
      props: [{ p: "payload" }, { p: "topic", vt: "str" }],
      repeat: "60",
      crontab: "",
      once: true,
      onceDelay: "15",
      topic: "auto",
      payload: "",
      payloadType: "date",
      x: 210,
      y: 850,
      wires: [["stcr_gr_v9_hourly_build"]],
    },
    {
      id: "stcr_gr_v9_hourly_manual",
      type: "inject",
      z: tab,
      g: groupId,
      name: "ทดสอบรายงานด้วยค่าล่าสุด",
      props: [{ p: "payload" }, { p: "topic", vt: "str" }],
      repeat: "",
      crontab: "",
      once: false,
      onceDelay: 0.1,
      topic: "manual",
      payload: "",
      payloadType: "date",
      x: 220,
      y: 920,
      wires: [["stcr_gr_v9_hourly_build"]],
    },
    {
      id: "stcr_gr_v9_hourly_build",
      type: "function",
      z: tab,
      g: groupId,
      name: "สร้างรายงานจากข้อมูลจริง · รอเฉพาะเซนเซอร์ที่แต่ละเตามี",
      func: `const profiles = ${grProfilesLiteral};
const maxAgeMs = 5 * 60 * 1000;
const now = new Date();
const pad = (value) => String(value).padStart(2, "0");
const hourKey = now.getFullYear() + "-" + pad(now.getMonth()+1) + "-" + pad(now.getDate()) + "T" + pad(now.getHours());
const manual = msg.topic === "manual";
const pending = global.get("stcr_gr_v9_hourly_pending");
const sentKey = global.get("stcr_gr_v9_hourly_sent_key");
const inflight = global.get("stcr_gr_v9_hourly_inflight") || {};

if (!manual && inflight.key && Date.now() - Number(inflight.at || 0) < 120000) return null;
if (!manual && pending?.payload && pending?.key && pending.key !== sentKey) {
    global.set("stcr_gr_v9_hourly_inflight", {key: pending.key, at: Date.now()});
    return {...pending, stcrHourlyKey: pending.key, stcrHourlyCompany: "GR"};
}
if (!manual && sentKey === hourKey) {
    node.status({fill:"green",shape:"dot",text:"ส่งแล้ว " + hourKey.slice(11) + ":00"});
    return null;
}

const missing = [];
const active = [];
const report = {};
for (let oven=11; oven<=26; oven++) {
    const status = global.get("latest_gr_status_oven_" + oven);
    const statusAt = Date.parse(status?.receivedAt || "");
    if (!status || !Number.isFinite(statusAt) || Date.now()-statusAt > maxAgeMs) {
        missing.push("สถานะเตา " + oven);
        continue;
    }
    if (Number(status.oven_state) !== 1) continue;
    active.push(oven);
    const sensor = global.get("latest_gr_oven_" + oven);
    const sensorAt = Date.parse(sensor?.receivedAt || "");
    if (!sensor || !Number.isFinite(sensorAt) || Date.now()-sensorAt > maxAgeMs) {
        missing.push("เซนเซอร์เตา " + oven);
        continue;
    }
    if (Number(sensor.cycle) !== Number(status.cycle)) {
        missing.push("รอบเตา " + oven);
        continue;
    }
    const absent = profiles[String(oven)].filter((key) =>
        sensor[key] === null || sensor[key] === undefined || sensor[key] === "" ||
        !Number.isFinite(Number(sensor[key])));
    if (absent.length) {
        missing.push("เตา " + oven + " ขาด " + absent.join("/"));
        continue;
    }
    report[oven] = {...sensor, cycle: Number(status.cycle)};
}

const voltage = global.get("latest_gr_voltage") || {};
for (const phase of ["AB","BC","CA"]) {
    const at = Date.parse(voltage[phase + "_receivedAt"] || "");
    if (!Number.isFinite(Number(voltage[phase])) || !Number.isFinite(at) || Date.now()-at > maxAgeMs) {
        missing.push("แรงดัน " + phase);
    }
}

if (missing.length) {
    const lastWarn = Number(context.get("lastMissingWarn") || 0);
    if (Date.now()-lastWarn >= 5*60*1000) {
        node.warn("ยังไม่ส่งรายงาน " + hourKey + " เพราะรอข้อมูล: " + missing.join(", "));
        context.set("lastMissingWarn", Date.now());
    }
    node.status({fill:"yellow",shape:"ring",text:"รอข้อมูล " + missing.length + " รายการ"});
    return null;
}

const roomHumidity = [];
for (let oven=11; oven<=17; oven++) {
    const item = report[oven];
    if (!item) continue;
    roomHumidity.push(oven + ",    " + Math.round(item.cycle) + ",    " + Number(item.roomtemp).toFixed(2) + ",     " + Number(item.humanity).toFixed(2));
}
const oven18 = report[18]
    ? "\\nเตา,  ครั้ง,   Tห้อง,Tเตา,     %ชื้น \\n18,    " + Math.round(report[18].cycle) + ",    " + Number(report[18].roomtemp).toFixed(2) + ", " + String(Math.round(Number(report[18].oventemp))).padStart(3,"0") + "     " + Number(report[18].humanity).toFixed(2)
    : "";
const fullSensors = [];
for (let oven=19; oven<=26; oven++) {
    const item = report[oven];
    if (!item) continue;
    fullSensors.push(oven + ",    " + Math.round(item.cycle) + ",    " + Number(item.roomtemp).toFixed(2) + ", " + String(Math.round(Number(item.oventemp))).padStart(3,"0") + ", " + String(Math.round(Number(item.blower))).padStart(3,"0") + ",     " + Number(item.humanity).toFixed(2));
}
const text = "รายงานแรงดันเฟส\\n" +
    "แรงดันเฟส AB ปกติ: " + Number(voltage.AB).toFixed(2) + " V\\n" +
    "แรงดันเฟส BC ปกติ: " + Number(voltage.BC).toFixed(2) + " V\\n" +
    "แรงดันเฟส CA ปกติ: " + Number(voltage.CA).toFixed(2) + " V\\n" +
    " =======================\\n" +
    "รายงานอุณหภูมิเตา 11-18 \\n" +
    "เตา , ครั้ง,   Tห้อง,      %ชื้น \\n" + roomHumidity.join("\\n") + oven18 +
    "\\n =======================\\n" +
    "รายงานอุณหภูมิเตา 19-26 \\n" +
    "เตา, ครั้ง,  Tห้อง,Tเตา,Tโบเวอร์,  %ชื้น \\n" + fullSensors.join("\\n");

msg.payload = {to: ${JSON.stringify(credentials.recipient)}, messages:[{type:"text", text}]};
msg.stcrHourlyKey = manual ? "manual-" + Date.now() : hourKey;
msg.stcrHourlyCompany = "GR";
msg.stcrHourlyActiveOvens = active;
if (!manual) {
    global.set("stcr_gr_v9_hourly_pending", {key:hourKey, payload:msg.payload});
    global.set("stcr_gr_v9_hourly_inflight", {key:hourKey, at:Date.now()});
}
node.status({fill:"blue",shape:"dot",text:"กำลังส่ง " + active.length + " เตา"});
return msg;`,
      outputs: 1,
      timeout: 0,
      noerr: 0,
      initialize: "",
      finalize: "",
      libs: [],
      x: 570,
      y: 880,
      wires: [["stcr_gr_v9_line_headers"]],
    },
    {
      id: "stcr_gr_v9_line_headers",
      type: "function",
      z: tab,
      g: groupId,
      name: "ใส่สิทธิ์ LINE เดิมของ GR",
      func: `msg.headers = {Authorization: "Bearer " + ${JSON.stringify(credentials.token)}, "Content-Type":"application/json"};\nreturn msg;`,
      outputs: 1,
      timeout: 0,
      noerr: 0,
      initialize: "",
      finalize: "",
      libs: [],
      x: 870,
      y: 880,
      wires: [["stcr_gr_v9_line_queue"]],
    },
    {
      id: "stcr_gr_v9_line_queue",
      type: "delay",
      z: tab,
      g: groupId,
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
      x: 1100,
      y: 880,
      wires: [["stcr_gr_v9_line_request"]],
    },
    {
      id: "stcr_gr_v9_line_request",
      type: "http request",
      z: tab,
      g: groupId,
      name: "ส่ง LINE และรอผลตอบรับ",
      method: "POST",
      ret: "obj",
      paytoqs: "ignore",
      url: "https://api.line.me/v2/bot/message/push",
      tls: "",
      persist: false,
      proxy: "",
      insecureHTTPParser: false,
      authType: "",
      senderr: true,
      headers: [],
      x: 1340,
      y: 880,
      wires: [["stcr_gr_v9_line_verify"]],
    },
    {
      id: "stcr_gr_v9_line_catch",
      type: "catch",
      z: tab,
      g: groupId,
      name: "จับข้อผิดพลาด LINE V9",
      scope: ["stcr_gr_v9_line_request"],
      uncaught: false,
      x: 1080,
      y: 950,
      wires: [["stcr_gr_v9_line_verify"]],
    },
    {
      id: "stcr_gr_v9_line_verify",
      type: "function",
      z: tab,
      g: groupId,
      name: "ยืนยันเมื่อ LINE ตอบรับสำเร็จเท่านั้น",
      func: `const key = msg.stcrHourlyKey;
const manual = String(key || "").startsWith("manual-");
const ok = Number(msg.statusCode) >= 200 && Number(msg.statusCode) < 300 && !msg.error;
if (ok) {
    if (!manual && key) {
        global.set("stcr_gr_v9_hourly_sent_key", key);
        global.set("stcr_gr_v9_hourly_pending", null);
    }
    global.set("stcr_gr_v9_hourly_inflight", {});
    node.status({fill:"green",shape:"dot",text:"LINE รับแล้ว"});
    return {payload:{ok:true,key,statusCode:msg.statusCode,activeOvens:msg.stcrHourlyActiveOvens}};
}
global.set("stcr_gr_v9_hourly_inflight", {});
node.status({fill:"red",shape:"ring",text:"ส่งไม่สำเร็จ · จะลองใหม่"});
node.error("LINE ไม่ตอบรับรายงาน " + (key || "") + " status=" + (msg.statusCode || "network") + " · ระบบจะลองใหม่อัตโนมัติ", msg);
return {payload:{ok:false,key,statusCode:msg.statusCode || null,error:msg.error?.message || null}};`,
      outputs: 1,
      timeout: 0,
      noerr: 0,
      initialize: "",
      finalize: "",
      libs: [],
      x: 1590,
      y: 900,
      wires: [["stcr_gr_v9_hourly_status"]],
    },
    {
      id: "stcr_gr_v9_hourly_status",
      type: "debug",
      z: tab,
      g: groupId,
      name: "ผลรายงานรายชั่วโมง V9",
      active: true,
      tosidebar: true,
      console: false,
      tostatus: false,
      complete: "payload",
      targetType: "msg",
      statusVal: "",
      statusType: "auto",
      x: 1810,
      y: 900,
      wires: [],
    },
  );

  ensureUniqueIds(flow);
  return flow;
}

function buildTtn(source) {
  const flow = readFlow(source);
  const tab = "stcr_v8_voltage";
  const oldTrigger = requireNode(flow, "stcr_v8_hourly_inject");
  oldTrigger.d = true;
  oldTrigger.name = "ปิดใช้ · รายงานแบบยกเลิกหลังรอ 60 วินาที (V8 เดิม)";

  const lineRequest = requireNode(flow, "stcr_v8_line_request");
  lineRequest.senderr = true;
  if (!lineRequest.wires[0].includes("stcr_ttn_v9_line_verify")) lineRequest.wires[0].push("stcr_ttn_v9_line_verify");

  const groupId = "stcr_ttn_v9_hourly_group";
  flow.push(
    {
      id: groupId,
      type: "group",
      z: tab,
      name: "รายงานรายชั่วโมง V9 · ใช้ค่าล่าสุด รอข้อมูลครบ และลองส่งใหม่",
      style: { label: true, color: "#6a1b9a", fill: "#f3e5f5", fillOpacity: "0.35" },
      nodes: ["stcr_ttn_v9_hourly_tick", "stcr_ttn_v9_hourly_build", "stcr_ttn_v9_hourly_out", "stcr_ttn_v9_hourly_manual"],
      x: 14,
      y: 1159,
      w: 1032,
      h: 142,
    },
    {
      id: "stcr_ttn_v9_hourly_tick",
      type: "inject",
      z: tab,
      g: groupId,
      name: "ตรวจรายงานทุก 1 นาที · รอครบได้ทั้งชั่วโมง",
      props: [{ p: "payload" }, { p: "topic", vt: "str" }],
      repeat: "60",
      crontab: "",
      once: true,
      onceDelay: "15",
      topic: "auto",
      payload: "",
      payloadType: "date",
      x: 210,
      y: 1210,
      wires: [["stcr_ttn_v9_hourly_build"]],
    },
    {
      id: "stcr_ttn_v9_hourly_manual",
      type: "inject",
      z: tab,
      g: groupId,
      name: "ทดสอบรายงานด้วยค่าล่าสุด",
      props: [{ p: "payload" }, { p: "topic", vt: "str" }],
      repeat: "",
      crontab: "",
      once: false,
      onceDelay: 0.1,
      topic: "manual",
      payload: "",
      payloadType: "date",
      x: 220,
      y: 1260,
      wires: [["stcr_ttn_v9_hourly_build"]],
    },
    {
      id: "stcr_ttn_v9_hourly_build",
      type: "function",
      z: tab,
      g: groupId,
      name: "สร้างรายงาน TTN จากค่าล่าสุด · รอครบ ไม่ยิง Modbus ซ้ำ",
      func: `const maxAgeMs = 5 * 60 * 1000;
const now = new Date();
const pad = (value) => String(value).padStart(2,"0");
const hourKey = now.getFullYear()+"-"+pad(now.getMonth()+1)+"-"+pad(now.getDate())+"T"+pad(now.getHours());
const manual = msg.topic === "manual";
const sentKey = global.get("stcr_ttn_v9_hourly_sent_key");
const inflight = global.get("stcr_ttn_v9_hourly_inflight") || {};
const pending = global.get("stcr_ttn_v9_hourly_pending");
if (!manual && inflight.key && Date.now()-Number(inflight.at || 0) < 120000) return null;
if (!manual && pending?.payload && pending?.key && pending.key !== sentKey) {
    global.set("stcr_ttn_v9_hourly_inflight", {key:pending.key,at:Date.now()});
    return {...pending, stcrHourlyKey:pending.key, stcrHourlyCompany:"TTN"};
}
if (!manual && sentKey === hourKey) {
    node.status({fill:"green",shape:"dot",text:"ส่งแล้ว " + hourKey.slice(11) + ":00"});
    return null;
}

const output = {};
const missing = [];
for (let oven=1; oven<=9; oven++) {
    const data = global.get("latest_oven_" + oven);
    const at = Date.parse(data?.receivedAt || "");
    const values = [data?.roomtemp,data?.humanity,data?.blower,data?.oventemp,data?.cycle];
    if (!data || !Number.isFinite(at) || Date.now()-at > maxAgeMs ||
        !values.every((value)=>value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)))) {
        missing.push("เตา " + oven);
        continue;
    }
    output["oven"+oven] = {
        room_temp:Number(data.roomtemp), humidity:Number(data.humanity), count:Number(data.cycle),
        blower_temp:Number(data.blower), oven_temp:Number(data.oventemp),
        oven_state:Number(data.startoven)===1, warm_state:Boolean(data.warmState)
    };
}
const voltage = global.get("latest_voltage");
const voltageAt = Date.parse(voltage?.receivedAt || "");
if (!voltage || !Number.isFinite(voltageAt) || Date.now()-voltageAt > maxAgeMs ||
    ![voltage?.AB,voltage?.BC,voltage?.CA].every((value)=>Number.isFinite(Number(value)))) {
    missing.push("แรงดันไฟฟ้า");
} else output.voltage = {AB:Number(voltage.AB),BC:Number(voltage.BC),CA:Number(voltage.CA)};

if (missing.length) {
    const lastWarn = Number(context.get("lastMissingWarn") || 0);
    if (Date.now()-lastWarn >= 5*60*1000) {
        node.warn("ยังไม่ส่งรายงาน " + hourKey + " เพราะรอข้อมูล: " + missing.join(", "));
        context.set("lastMissingWarn",Date.now());
    }
    node.status({fill:"yellow",shape:"ring",text:"รอข้อมูล " + missing.length + " รายการ"});
    return null;
}
msg.payload = {kind:"summary",data:output};
msg.stcrHourlyKey = manual ? "manual-"+Date.now() : hourKey;
msg.stcrHourlyCompany = "TTN";
if (!manual) {
    global.set("stcr_ttn_v9_hourly_pending",{key:hourKey,payload:msg.payload});
    global.set("stcr_ttn_v9_hourly_inflight",{key:hourKey,at:Date.now()});
}
node.status({fill:"blue",shape:"dot",text:"ข้อมูลครบ · กำลังส่ง"});
return msg;`,
      outputs: 1,
      timeout: 0,
      noerr: 0,
      initialize: "",
      finalize: "",
      libs: [],
      x: 570,
      y: 1230,
      wires: [["stcr_ttn_v9_hourly_out"]],
    },
    {
      id: "stcr_ttn_v9_hourly_out",
      type: "link out",
      z: tab,
      g: groupId,
      name: "ส่งรายงานไป LINE V8 เดิม",
      mode: "link",
      links: ["stcr_v8_summary_in"],
      x: 995,
      y: 1230,
      wires: [],
    },
    {
      id: "stcr_ttn_v9_line_verify",
      type: "function",
      z: "stcr_v8_line",
      name: "ยืนยันรายงานรายชั่วโมงเมื่อ LINE ตอบรับ",
      func: `if (!msg.stcrHourlyKey || msg.stcrHourlyCompany !== "TTN") return null;
const manual = String(msg.stcrHourlyKey).startsWith("manual-");
const ok = Number(msg.statusCode)>=200 && Number(msg.statusCode)<300 && !msg.error;
if (ok) {
    if (!manual) {
        global.set("stcr_ttn_v9_hourly_sent_key",msg.stcrHourlyKey);
        global.set("stcr_ttn_v9_hourly_pending",null);
    }
    global.set("stcr_ttn_v9_hourly_inflight",{});
    node.status({fill:"green",shape:"dot",text:"LINE รับแล้ว"});
    return null;
}
global.set("stcr_ttn_v9_hourly_inflight",{});
node.status({fill:"red",shape:"ring",text:"ส่งไม่สำเร็จ · จะลองใหม่"});
node.error("LINE ไม่ตอบรับรายงาน " + msg.stcrHourlyKey + " status=" + (msg.statusCode || "network") + " · ระบบจะลองใหม่อัตโนมัติ",msg);
return null;`,
      outputs: 1,
      timeout: 0,
      noerr: 0,
      initialize: "",
      finalize: "",
      libs: [],
      x: 1160,
      y: 520,
      wires: [[]],
    },
    {
      id: "stcr_ttn_v9_line_catch",
      type: "catch",
      z: "stcr_v8_line",
      name: "จับข้อผิดพลาดส่ง LINE รายชั่วโมง",
      scope: ["stcr_v8_line_request"],
      uncaught: false,
      x: 890,
      y: 560,
      wires: [["stcr_ttn_v9_line_verify"]],
    },
  );

  ensureUniqueIds(flow);
  return flow;
}

fs.mkdirSync(outputDir, { recursive: true });
const grOutput = path.join(outputDir, "gr-production-complete-v9.json");
const ttnOutput = path.join(outputDir, "ttn-production-complete-v9.json");
fs.writeFileSync(grOutput, `${JSON.stringify(buildGr(grSource), null, 2)}\n`);
fs.writeFileSync(ttnOutput, `${JSON.stringify(buildTtn(ttnSource), null, 2)}\n`);
console.log(`Created ${grOutput}`);
console.log(`Created ${ttnOutput}`);
