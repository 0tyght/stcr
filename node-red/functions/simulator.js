const SIMULATOR_VERSION = 1;
const OVEN_NUMBERS = Array.from({ length: 16 }, (_, index) => index + 11);
const STATUSES = [
  "closed", "closed", "closed", "closed",
  "open", "offline", "open", "open",
  "closed", "open", "open", "offline",
  "closed", "open", "open", "closed",
];
const CYCLE_COUNTS = [87, 89, 88, 85, 71, 83, 84, 83, 55, 92, 74, 66, 80, 79, 91, 0];
const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;
const HISTORY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const HISTORY_STEP_MS = 10 * 60 * 1000;
const MAX_HISTORY_POINTS = 12000;

function round(value, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createLimits() {
  return {
    chamberTemp: { sensor: "chamberTemp", lower: 30, upper: 60 },
    humidity: { sensor: "humidity", lower: 45, upper: 70 },
    furnaceTemp: { sensor: "furnaceTemp", lower: 140, upper: 450 },
    blowerTemp: { sensor: "blowerTemp", lower: 140, upper: 450 },
  };
}

function sensorValues(ovenNumber, timestamp, startedAt) {
  const elapsedHours = Math.max(0, (timestamp - startedAt) / 3600000);
  const cycleProgress = clamp(elapsedHours / 144, 0, 1);
  const phase = timestamp / 3600000 + ovenNumber * 0.73;
  const firingWave = Math.max(0, Math.sin(phase * 1.7));
  const slowWave = Math.sin(phase * 0.31);
  const chamberTarget = cycleProgress < 0.08
    ? 30 + cycleProgress / 0.08 * 18
    : 48 + Math.sin(phase * 0.18) * 2.2;
  const humidityTarget = 82 - cycleProgress * 34 + slowWave * 2.4;
  const furnaceTarget = 155 + firingWave * 95 + Math.sin(phase * 0.43) * 16;
  const blowerTarget = 58 + firingWave * 24 + Math.sin(phase * 0.57) * 7;

  const chamberTemp = ovenNumber === 20
    ? chamberTarget + 13
    : chamberTarget + Math.sin(phase) * 0.7;
  const furnaceTemp = ovenNumber === 20 ? furnaceTarget + 245 : furnaceTarget;
  const blowerTemp = ovenNumber === 18 ? Math.max(0, blowerTarget - 66) : blowerTarget;

  return {
    chamberTemp: round(clamp(chamberTemp, 20, 85)),
    humidity: round(clamp(humidityTarget, 25, 95)),
    furnaceTemp: round(clamp(furnaceTemp, 20, 560)),
    blowerTemp: round(clamp(blowerTemp, 0, 180)),
  };
}

function createReadings(values, updatedAt) {
  return {
    chamberTemp: { key: "chamberTemp", value: values.chamberTemp, unit: "C", updatedAt },
    humidity: { key: "humidity", value: values.humidity, unit: "%", updatedAt },
    furnaceTemp: { key: "furnaceTemp", value: values.furnaceTemp, unit: "C", updatedAt },
    blowerTemp: { key: "blowerTemp", value: values.blowerTemp, unit: "C", updatedAt },
  };
}

function createHistoryPoint(oven, timestamp) {
  const startedAt = Date.parse(oven.startedAt || new Date(timestamp - SIX_DAYS_MS).toISOString());
  return {
    timestamp: new Date(timestamp).toISOString(),
    ...sensorValues(oven.number, timestamp, startedAt),
  };
}

function createOven(number, index, now) {
  const status = STATUSES[index];
  const startedAtMs = now - (10 + (number * 7) % 68) * 3600000;
  const stoppedAtMs = now - (8 + number % 30) * 3600000;
  const updatedAtMs = status === "offline" ? now - (35 + number) * 60000 : now;
  const values = sensorValues(number, updatedAtMs, startedAtMs);
  const updatedAt = new Date(updatedAtMs).toISOString();

  return {
    id: `oven-${number}`,
    number,
    name: `เตา ${number}`,
    zone: number <= 18 ? "A" : "B",
    line: number <= 18 ? "Line 1" : "Line 2",
    status,
    enabled: true,
    cycleCount: CYCLE_COUNTS[index],
    ...(status === "open" ? { startedAt: new Date(startedAtMs).toISOString() } : {}),
    ...(status === "closed" ? { stoppedAt: new Date(stoppedAtMs).toISOString() } : {}),
    lastUpdatedAt: updatedAt,
    readings: createReadings(values, updatedAt),
    limits: createLimits(),
  };
}

function buildAlarms(ovens) {
  const alarms = [];

  ovens.forEach((oven) => {
    if (oven.status === "offline") {
      alarms.push({
        id: `${oven.id}-offline`,
        ovenId: oven.id,
        ovenName: oven.name,
        severity: "offline",
        status: "active",
        title: "ข้อมูลจากเตาขาดการเชื่อมต่อ",
        detail: "Node-RED ไม่ได้รับข้อมูลจากเตาตามรอบเวลาที่กำหนด",
        createdAt: oven.lastUpdatedAt,
      });
      return;
    }

    if (oven.status !== "open") return;

    Object.keys(oven.readings).forEach((sensor) => {
      if (sensor === "humidity") return;
      const reading = oven.readings[sensor];
      const limit = oven.limits[sensor];
      if (reading.value >= limit.lower && reading.value <= limit.upper) return;

      const isHigh = reading.value > limit.upper;
      alarms.push({
        id: `${oven.id}-${sensor}`,
        ovenId: oven.id,
        ovenName: oven.name,
        severity: Math.abs(reading.value - (isHigh ? limit.upper : limit.lower)) > 20 ? "danger" : "warning",
        status: "active",
        sensor,
        title: `${sensor} ${isHigh ? "สูง" : "ต่ำ"}กว่ามาตรฐาน`,
        detail: `ค่าปัจจุบัน ${reading.value} เทียบกับ ${isHigh ? "Upper" : "Lower"} ${isHigh ? limit.upper : limit.lower}`,
        value: reading.value,
        limit: isHigh ? limit.upper : limit.lower,
        createdAt: reading.updatedAt,
      });
    });
  });

  return alarms;
}

const now = Date.now();
let state = flow.get("stcrState");

if (!state || state.version !== SIMULATOR_VERSION) {
  const ovens = OVEN_NUMBERS.map((number, index) => createOven(number, index, now));
  const history = {};

  ovens.forEach((oven) => {
    const points = [];
    for (let timestamp = now - HISTORY_RETENTION_MS; timestamp <= now; timestamp += HISTORY_STEP_MS) {
      points.push(createHistoryPoint(oven, timestamp));
    }
    history[oven.id] = points;
  });

  state = {
    version: SIMULATOR_VERSION,
    ovens,
    history,
    alarms: buildAlarms(ovens),
    auditEvents: [],
  };
}

state.ovens = state.ovens.map((oven) => {
  if (oven.status !== "open") return oven;
  const cycleFinished = now - Date.parse(oven.startedAt) >= SIX_DAYS_MS;
  const currentOven = cycleFinished
    ? { ...oven, cycleCount: oven.cycleCount + 1, startedAt: new Date(now).toISOString() }
    : oven;
  const updatedAt = new Date(now).toISOString();
  const values = sensorValues(currentOven.number, now, Date.parse(currentOven.startedAt));
  const updated = {
    ...currentOven,
    lastUpdatedAt: updatedAt,
    readings: createReadings(values, updatedAt),
  };

  const points = state.history[oven.id] || [];
  const lastTimestamp = points.length ? Date.parse(points[points.length - 1].timestamp) : 0;
  if (now - lastTimestamp >= 60000) {
    points.push({ timestamp: updatedAt, ...values });
    state.history[oven.id] = points.slice(-MAX_HISTORY_POINTS);
  }

  return updated;
});

const acknowledgedAlarmIds = new Set(
  state.alarms.filter((alarm) => alarm.status === "acknowledged").map((alarm) => alarm.id),
);
state.alarms = buildAlarms(state.ovens).map((alarm) =>
  acknowledgedAlarmIds.has(alarm.id) ? { ...alarm, status: "acknowledged" } : alarm,
);
flow.set("stcrState", state);
node.status({ fill: "green", shape: "dot", text: `${state.ovens.length} ovens · ${new Date(now).toLocaleTimeString()}` });
return null;
