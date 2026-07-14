const SIMULATOR_VERSION = 8;
const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;
const CYCLE_GAP_MS = 12 * 60 * 60 * 1000;
const ARCHIVED_CYCLE_COUNT = 6;
const IGNITION_GRACE_MS = 3 * 60 * 60 * 1000;
const REPORT_READY_HOLD_MS = 30 * 60 * 1000;
const HISTORY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const HISTORY_STEP_MS = 10 * 60 * 1000;
const LIVE_POINT_INTERVAL_MS = 5000;
const MAX_HISTORY_POINTS = 18000;

const COMPANY_SOURCES = {
  gr: {
    companyId: "gr",
    numbers: Array.from({ length: 16 }, (_, index) => index + 11),
    statuses: [
      "closed", "closed", "closed", "closed", "open", "offline", "open", "open",
      "closed", "open", "open", "offline", "closed", "open", "open", "closed",
    ],
    cycleCounts: [87, 89, 88, 85, 71, 83, 84, 83, 55, 92, 74, 66, 80, 79, 91, 0],
    zone: (number) => (number <= 18 ? "A" : "B"),
    line: (number) => (number <= 18 ? "Line 1" : "Line 2"),
  },
  ttn: {
    companyId: "ttn",
    numbers: Array.from({ length: 10 }, (_, index) => index + 1),
    statuses: ["open", "open", "closed", "open", "closed", "open", "offline", "open", "closed", "open"],
    cycleCounts: [42, 38, 51, 46, 33, 55, 29, 48, 36, 44],
    zone: () => "TTN",
    line: (number) => (number <= 5 ? "Smoking Line A" : "Smoking Line B"),
  },
};

function createLimits() {
  return {
    chamberTemp: { sensor: "chamberTemp", lower: 35, upper: 60 },
    humidity: { sensor: "humidity", lower: 45, upper: 85 },
    furnaceTemp: { sensor: "furnaceTemp", lower: 450, upper: 550 },
    blowerTemp: { sensor: "blowerTemp", lower: 330, upper: 400 },
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

function createHistoryPoint(source, oven, timestamp) {
  const firedAt = Date.parse(oven.firedAt || oven.startedAt || new Date(timestamp - SIX_DAYS_MS).toISOString());
  return { timestamp: new Date(timestamp).toISOString(), ...simulationSensorValues(source.companyId, oven.number, timestamp, firedAt) };
}

function createArchivedCycleMetadata(oven) {
  if (oven.cycleCount <= 0 || oven.status === "offline") return [];

  const latestCompletedCycle = oven.status === "open" ? oven.cycleCount - 1 : oven.cycleCount;
  if (latestCompletedCycle <= 0) return [];

  const baseEnd = Date.parse(
    oven.status === "open"
      ? oven.reportStartedAt || oven.firedAt
      : oven.stoppedAt || oven.lastUpdatedAt,
  );

  return Array.from(
    { length: Math.min(ARCHIVED_CYCLE_COUNT, latestCompletedCycle) },
    (_, offset) => {
      const cycleNumber = latestCompletedCycle - offset;

      if (oven.status === "closed" && offset === 0 && oven.reportStartedAt && oven.stoppedAt) {
        return {
          cycleNumber,
          firedAt: oven.firedAt,
          reportStartedAt: oven.reportStartedAt,
          stoppedAt: oven.stoppedAt,
        };
      }

      const stoppedAtMs = baseEnd - offset * (SIX_DAYS_MS + CYCLE_GAP_MS);
      const durationHours = 96 + ((oven.number + cycleNumber) % 8) * 6;
      const reportStartedAtMs = stoppedAtMs - durationHours * 3600000;
      const firedAtMs = reportStartedAtMs - (8 + (oven.number + cycleNumber) % 5) * 3600000;

      return {
        cycleNumber,
        firedAt: new Date(firedAtMs).toISOString(),
        reportStartedAt: new Date(reportStartedAtMs).toISOString(),
        stoppedAt: new Date(stoppedAtMs).toISOString(),
      };
    },
  );
}

function findReportStartedAt(source, number, firedAtMs) {
  const lower = createLimits().chamberTemp.lower;
  const stepMs = 5 * 60 * 1000;
  let readySince = null;

  for (let timestamp = firedAtMs; timestamp <= firedAtMs + 24 * 60 * 60 * 1000; timestamp += stepMs) {
    const chamberTemp = simulationSensorValues(source.companyId, number, timestamp, firedAtMs).chamberTemp;
    if (chamberTemp >= lower) {
      readySince ??= timestamp;
      if (timestamp - readySince >= REPORT_READY_HOLD_MS) return readySince;
    } else {
      readySince = null;
    }
  }

  return firedAtMs + 24 * 60 * 60 * 1000;
}

function createOven(source, number, index, now) {
  const status = source.statuses[index];
  const elapsedCycleHours = index === 0 ? 1 : 1 + (number * 11) % 116;
  const firedAtMs = now - elapsedCycleHours * 3600000;
  const reportStartedAtMs = findReportStartedAt(source, number, firedAtMs);
  const stoppedAtMs = now - (8 + number % 30) * 3600000;
  const completedDurationMs = (96 + (number % 8) * 6) * 3600000;
  const completedReportStartedAtMs = stoppedAtMs - completedDurationMs;
  const completedFiredAtMs = completedReportStartedAtMs - (8 + number % 5) * 3600000;
  const updatedAtMs = status === "offline" ? now - (35 + number) * 60000 : now;
  const values = status === "open"
    ? simulationSensorValues(source.companyId, number, updatedAtMs, firedAtMs)
    : { chamberTemp: 30, humidity: 68, furnaceTemp: 0, blowerTemp: 0 };
  const updatedAt = new Date(updatedAtMs).toISOString();

  return {
    id: `oven-${number}`,
    number,
    name: `เตา ${number}`,
    zone: source.zone(number),
    line: source.line(number),
    status,
    enabled: true,
    cycleCount: source.cycleCounts[index],
    ...(status === "open" ? { firedAt: new Date(firedAtMs).toISOString() } : {}),
    ...(status === "open" && reportStartedAtMs <= now
      ? {
          reportStartedAt: new Date(reportStartedAtMs).toISOString(),
          startedAt: new Date(reportStartedAtMs).toISOString(),
        }
      : {}),
    ...(status === "closed" && source.cycleCounts[index] > 0
      ? {
          firedAt: new Date(completedFiredAtMs).toISOString(),
          reportStartedAt: new Date(completedReportStartedAtMs).toISOString(),
          startedAt: new Date(completedReportStartedAtMs).toISOString(),
          stoppedAt: new Date(stoppedAtMs).toISOString(),
        }
      : status === "closed"
        ? { stoppedAt: new Date(stoppedAtMs).toISOString() }
        : {}),
    lastUpdatedAt: updatedAt,
    readings: createReadings(values, updatedAt),
    limits: createLimits(),
  };
}

function isInIgnitionGrace(oven, now) {
  return oven.status === "open" && oven.startedAt && now - Date.parse(oven.startedAt) < IGNITION_GRACE_MS;
}

function isSensorReadyForAlarm(oven, sensor, now) {
  if (!oven.startedAt) return false;
  const elapsedMs = now - Date.parse(oven.startedAt);
  const warmupMs = sensor === "chamberTemp" ? 18 * 60 * 60 * 1000 : IGNITION_GRACE_MS;
  return elapsedMs >= warmupMs;
}

function buildAlarms(companyState, now) {
  const alarms = [];

  companyState.ovens.forEach((oven) => {
    if (oven.status === "offline") {
      alarms.push({
        id: `${oven.id}-offline`, ovenId: oven.id, ovenName: oven.name, severity: "offline", status: "active",
        title: "ขาดการเชื่อมต่อ", detail: "ไม่ได้รับข้อมูลจากเตาตามรอบเวลาที่กำหนด", createdAt: oven.lastUpdatedAt,
      });
      return;
    }

    // During ignition all temperature sensors rise from zero by design.
    if (oven.status !== "open" || isInIgnitionGrace(oven, now)) return;

    ["chamberTemp", "furnaceTemp", "blowerTemp"].forEach((sensor) => {
      if (!isSensorReadyForAlarm(oven, sensor, now)) return;
      const reading = oven.readings[sensor];
      const limit = oven.limits[sensor];
      if (reading.value >= limit.lower && reading.value <= limit.upper) return;
      const isHigh = reading.value > limit.upper;
      alarms.push({
        id: `${oven.id}-${sensor}`, ovenId: oven.id, ovenName: oven.name,
        severity: Math.abs(reading.value - (isHigh ? limit.upper : limit.lower)) > 25 ? "danger" : "warning",
        status: "active", sensor,
        title: `${sensor} ${isHigh ? "สูง" : "ต่ำ"}กว่ามาตรฐาน`,
        detail: `ค่าปัจจุบัน ${reading.value} เทียบกับ ${isHigh ? "Upper" : "Lower"} ${isHigh ? limit.upper : limit.lower}`,
        value: reading.value, limit: isHigh ? limit.upper : limit.lower, createdAt: reading.updatedAt,
      });
    });
  });

  return alarms;
}

function createCompanyState(source, now) {
  const ovens = source.numbers.map((number, index) => createOven(source, number, index, now));
  const history = {};

  ovens.forEach((oven) => {
    const points = [];
    const seedStart = oven.reportStartedAt
      ? Math.max(Date.parse(oven.reportStartedAt), now - HISTORY_RETENTION_MS)
      : now - HISTORY_RETENTION_MS;
    const seedEnd = oven.status === "closed" && oven.stoppedAt ? Date.parse(oven.stoppedAt) : now;
    for (let timestamp = seedStart; timestamp <= seedEnd; timestamp += HISTORY_STEP_MS) {
      points.push(createHistoryPoint(source, oven, timestamp));
    }
    history[oven.id] = points;
  });

  const archivedCycles = Object.fromEntries(
    ovens.map((oven) => [oven.id, createArchivedCycleMetadata(oven)]),
  );

  const companyState = {
    companyId: source.companyId,
    ovens,
    history,
    archivedCycles,
    alarms: [],
    auditEvents: [],
  };
  companyState.alarms = buildAlarms(companyState, now);
  return companyState;
}

function updateCompanyState(source, companyState, now) {
  companyState.ovens = companyState.ovens.map((oven) => {
    if (oven.status !== "open") return oven;
    const cycleFinished = oven.reportStartedAt && now - Date.parse(oven.reportStartedAt) >= SIX_DAYS_MS;
    const currentOven = cycleFinished
      ? {
          ...oven,
          cycleCount: oven.cycleCount + 1,
          firedAt: new Date(now).toISOString(),
          reportStartedAt: undefined,
          startedAt: undefined,
        }
      : oven;
    if (cycleFinished) companyState.history[oven.id] = [];

    const updatedAt = new Date(now).toISOString();
    const firedAt = Date.parse(currentOven.firedAt);
    const values = simulationSensorValues(source.companyId, currentOven.number, now, firedAt);
    if (!currentOven.reportStartedAt) {
      const candidate = findReportStartedAt(source, currentOven.number, firedAt);
      if (candidate <= now) {
        currentOven.reportStartedAt = new Date(candidate).toISOString();
        currentOven.startedAt = currentOven.reportStartedAt;
      }
    }
    const points = companyState.history[oven.id] || [];
    const lastTimestamp = points.length ? Date.parse(points[points.length - 1].timestamp) : 0;
    if (currentOven.reportStartedAt && now - lastTimestamp >= LIVE_POINT_INTERVAL_MS) {
      points.push({ timestamp: updatedAt, ...values });
      companyState.history[oven.id] = points.slice(-MAX_HISTORY_POINTS);
    }

    return { ...currentOven, lastUpdatedAt: updatedAt, readings: createReadings(values, updatedAt) };
  });

  const previousById = new Map(companyState.alarms.map((alarm) => [alarm.id, alarm]));
  const activeAlarms = buildAlarms(companyState, now).map((alarm) => {
    const previous = previousById.get(alarm.id);
    return previous?.status === "acknowledged"
      ? { ...alarm, status: "acknowledged", createdAt: previous.createdAt }
      : alarm;
  });
  const activeIds = new Set(activeAlarms.map((alarm) => alarm.id));
  const newlyResolved = companyState.alarms
    .filter((alarm) => alarm.status !== "resolved" && !activeIds.has(alarm.id))
    .map((alarm) => ({ ...alarm, status: "resolved", resolvedAt: new Date(now).toISOString() }));
  const retainedResolved = companyState.alarms.filter(
    (alarm) => alarm.status === "resolved" && !activeIds.has(alarm.id),
  );
  companyState.alarms = [...activeAlarms, ...newlyResolved, ...retainedResolved]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 200);
}

const now = Date.now();
let state = global.get("stcrState");

if (!state || state.version !== SIMULATOR_VERSION || !state.companies) {
  state = {
    version: SIMULATOR_VERSION,
    companies: Object.fromEntries(
      Object.entries(COMPANY_SOURCES).map(([companyId, source]) => [companyId, createCompanyState(source, now)]),
    ),
  };
}

Object.entries(COMPANY_SOURCES).forEach(([companyId, source]) => {
  updateCompanyState(source, state.companies[companyId], now);
});

global.set("stcrState", state);
const ovenCount = Object.values(state.companies).reduce((total, company) => total + company.ovens.length, 0);
state.telemetrySequence = Math.max((state.telemetrySequence || 0) + 1, now);
const batchId = `${now}-${state.telemetrySequence}`;
const sensorKeys = ["chamberTemp", "humidity", "furnaceTemp", "blowerTemp"];
const units = { chamberTemp: "C", humidity: "%", furnaceTemp: "C", blowerTemp: "C" };
const outputs = sensorKeys.map(() => []);
const connectedOvens = Object.values(state.companies)
  .flatMap((company) => company.ovens.map((oven) => ({ companyId: company.companyId, oven })))
  .filter(({ oven }) => oven.enabled && oven.status !== "offline");
const expectedTelemetryByCompany = Object.fromEntries(
  Object.keys(state.companies).map((companyId) => [
    companyId,
    connectedOvens.filter((item) => item.companyId === companyId).length * sensorKeys.length,
  ]),
);

connectedOvens.forEach(({ companyId, oven }) => {
  sensorKeys.forEach((sensorKey, outputIndex) => {
    const reading = oven.readings[sensorKey];
    outputs[outputIndex].push({
      topic: `stcr/${companyId}/${oven.id}/telemetry/${sensorKey}`,
      payload: {
        schemaVersion: 1,
        batchId,
        expectedTelemetryCount: expectedTelemetryByCompany[companyId],
        companyId,
        deviceId: `${companyId}-${oven.id}-gateway`,
        ovenId: oven.id,
        sensorId: `${companyId}-${oven.id}-${sensorKey}`,
        sensorKey,
        sequence: state.telemetrySequence,
        value: reading.value,
        unit: units[sensorKey],
        sourceTimestamp: new Date(now).toISOString(),
        receivedTimestamp: new Date(now).toISOString(),
      },
    });
  });
});

global.set("stcrState", state);
node.status({ fill: "green", shape: "dot", text: `${ovenCount} ovens / seq ${state.telemetrySequence}` });
return outputs;
