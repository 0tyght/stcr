import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceIndex = process.argv.indexOf("--source");
const sourcePath =
  (sourceIndex >= 0 ? process.argv[sourceIndex + 1] : "") ||
  path.join(root, "output", "node-red", "ttn-production-complete-v9.json");
const outputPath = path.join(root, "output", "node-red", "ttn-production-complete-v10.json");

const nodes = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const byId = (id) => nodes.find((node) => node.id === id);

function replaceSection(source, start, end, replacement, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0) throw new Error(`Cannot patch ${label}`);
  return source.slice(0, startIndex) + replacement + source.slice(endIndex);
}

for (let oven = 1; oven <= 9; oven += 1) {
  const kilnStore = byId(`stcr_v8_o${oven}_kiln_store`);
  const publish = byId(`stcr_v8_o${oven}_publish`);
  const catchNode = byId(`stcr_v8_o${oven}_catch`);
  const retryControl = byId(`stcr_v8_o${oven}_retry_control`);
  if (!kilnStore || !publish || !catchNode || !retryControl) {
    throw new Error(`Missing TTN oven ${oven} nodes`);
  }

  kilnStore.name = `กรองค่าศูนย์และเก็บค่าเตา/Blower · เตา ${oven}`;
  kilnStore.func = `const values = Array.isArray(msg.payload) ? msg.payload.map(Number) : [];
if (values.length < 2 || !values.every(Number.isFinite)) {
    node.error("ค่าเตา/Blower เตา ${oven} ไม่ครบ", msg);
    return null;
}
const ovenTemp = values[0];
const blowerTemp = values[1];
if (ovenTemp < -40 || ovenTemp > 1000 || blowerTemp < -40 || blowerTemp > 600) {
    node.error("ค่าเตา/Blower เตา ${oven} อยู่นอกช่วง", msg);
    return null;
}
// ค่า 0 ขณะเตาเปิดเป็นค่าขาด/ค่าชั่วคราวจาก PLC ไม่ใช่อุณหภูมิจริง
// ทิ้งทั้งชุดและคงค่าล่าสุดที่เชื่อถือได้ไว้ ไม่ส่ง MQTT และไม่สร้าง Alarm
if (msg.stcr?.ovenState === true && ovenTemp === 0) {
    node.error("อุณหภูมิเตา ${oven} = 0°C ขณะเตาเปิด ต้องอ่านใหม่", msg);
    return null;
}
msg.stcr.ovenTemp = ovenTemp;
msg.stcr.blowerTemp = blowerTemp;
return msg;`;

  const start = `const eventKey = "stcr_v8_event_oven_${oven}";`;
  const end = `flow.set(eventKey, current);`;
  const debounce = `const eventKey = "stcr_v8_event_oven_${oven}";
const previous = flow.get(eventKey);
const eventNow = Date.now();
const observedKilnZone = msg.stcr.ovenState
    ? (msg.stcr.ovenTemp >= 600 ? "high" : (msg.stcr.ovenTemp <= 100 ? "low" : "normal"))
    : "inactive";

// ยืนยันการเปลี่ยนช่วงอุณหภูมิ 2 รอบติดต่อกันก่อนแจ้ง LINE
// ป้องกันค่ากระโดดชั่วคราวทำให้แจ้งต่ำและกลับปกติสลับกัน
let confirmedKilnZone = previous?.kilnZone || (msg.stcr.ovenState ? "normal" : "inactive");
let kilnCandidate = previous?.kilnCandidate || null;
let kilnCandidateCount = Number(previous?.kilnCandidateCount || 0);
if (!msg.stcr.ovenState) {
    confirmedKilnZone = "inactive";
    kilnCandidate = null;
    kilnCandidateCount = 0;
} else if (observedKilnZone === confirmedKilnZone) {
    kilnCandidate = null;
    kilnCandidateCount = 0;
} else {
    if (kilnCandidate === observedKilnZone) kilnCandidateCount += 1;
    else {
        kilnCandidate = observedKilnZone;
        kilnCandidateCount = 1;
    }
    if (kilnCandidateCount >= 2) {
        confirmedKilnZone = observedKilnZone;
        kilnCandidate = null;
        kilnCandidateCount = 0;
    }
}

const current = {
    ovenState: msg.stcr.ovenState,
    warmState: msg.stcr.warmState,
    roomHigh: roomTemp > 65,
    kilnZone: confirmedKilnZone,
    kilnCandidate,
    kilnCandidateCount,
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
    } else if (current.kilnZone === "normal" && wasAbnormal) {
        alert("อุณหภูมิเตาเผา ${oven} กลับสู่ช่วงปกติ = " + msg.stcr.ovenTemp + "°C");
        current.kilnLastAlert = 0;
    }
}
`;
  publish.func = replaceSection(publish.func, start, end, debounce, `oven ${oven} alert debounce`);
  publish.name = `ตรวจ ส่ง และยืนยัน Alarm 2 รอบ · เตา ${oven}`;

  const validationTargets = {
    [`stcr_v8_o${oven}_status_get`]: [`stcr_v8_o${oven}_status_get`, "สถานะทำงาน"],
    [`stcr_v8_o${oven}_status_store`]: [`stcr_v8_o${oven}_status_get`, "สถานะทำงาน"],
    [`stcr_v8_o${oven}_warm_get`]: [`stcr_v8_o${oven}_warm_get`, "สถานะอุ่นเตา"],
    [`stcr_v8_o${oven}_warm_store`]: [`stcr_v8_o${oven}_warm_get`, "สถานะอุ่นเตา"],
    [`stcr_v8_o${oven}_count_get`]: [`stcr_v8_o${oven}_count_get`, "เลขรอบ"],
    [`stcr_v8_o${oven}_count_store`]: [`stcr_v8_o${oven}_count_get`, "เลขรอบ"],
    [`stcr_v8_o${oven}_kiln_get`]: [`stcr_v8_o${oven}_kiln_get`, "อุณหภูมิเตา/Blower"],
    [`stcr_v8_o${oven}_kiln_store`]: [`stcr_v8_o${oven}_kiln_get`, "อุณหภูมิเตา/Blower"],
    [`stcr_v8_o${oven}_humidity_get`]: [`stcr_v8_o${oven}_humidity_get`, "ความชื้น/ห้องอบ"],
    [`stcr_v8_o${oven}_publish`]: [`stcr_v8_o${oven}_humidity_get`, "ความชื้น/ห้องอบ"],
  };
  catchNode.name = `จับค่าผิดและ Timeout · เตา ${oven}`;
  catchNode.scope = Object.keys(validationTargets);
  retryControl.name = `อ่านใหม่ทันทีสูงสุด 5 ครั้ง · เตา ${oven}`;
  retryControl.func = `const targets = ${JSON.stringify(validationTargets)};
const source = msg.error?.source?.id || "";
const mapping = targets[source];
if (!mapping) return [null, msg, null];
const target = mapping[0];
const label = mapping[1];
const old = msg.stcrRetry || {};
const attempt = old.target === target ? Number(old.attempt || 0) + 1 : 1;
const errorMessage = msg.error?.message || "อ่านข้อมูลไม่สำเร็จ";
delete msg.error;
if (attempt <= 5) {
    msg.stcrRetry = {target, attempt};
    msg.stcrRetryTarget = target;
    node.warn("อ่านใหม่ " + attempt + "/5 · เตา ${oven} · " + label);
    return [msg, null, null];
}
// ไม่ส่ง null, ข้อมูลไม่ครบ, Timeout หรือรายละเอียดเทคนิคไป LINE
// ปลดล็อกให้ Watchdog กลับมาลองใหม่ทุกนาทีจนกว่าจะอ่านได้
delete msg.stcrRetry;
delete msg.stcrRetryTarget;
flow.set("stcr_v8_busy_oven_${oven}", 0);
msg.payload = {
    oven: ${oven}, source, target, label,
    attempts: attempt, message: errorMessage,
    time: new Date().toISOString()
};
node.status({fill:"yellow",shape:"ring",text:"ยังอ่าน " + label + " ไม่ได้ · รอลองใหม่"});
return [null, msg, null];`;
  // Output ที่สามเคยต่อไป LINE แจ้งข้อผิดพลาด ปิดไว้ตามข้อกำหนดใหม่
  retryControl.wires = [[`stcr_v8_o${oven}_retry_wait`], [`stcr_v8_o${oven}_error_debug`], []];
}

for (const tab of nodes.filter((node) => node.type === "tab")) tab.disabled = true;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(nodes, null, 2)}\n`, "utf8");
console.log(`Created ${outputPath}`);
console.log("Rejected active-oven 0°C samples=9, debounced kiln alarms=9");
