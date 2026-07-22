// factory-mqtt-db-writer.js
// Realtime path:
//   - update the in-memory oven state for every MQTT message.
// Persistence path:
//   - persist status immediately only when it changes;
//   - persist oven heartbeat at most once per minute;
//   - aggregate sensor values per oven/minute and persist one graph point.

const envelope = msg._mqttEnvelope;
const isFlushTick = Boolean(msg._minuteFlushTick);

const BUCKETS_KEY = "stcrMinuteBuckets";
const FLUSH_LOCK_KEY = "stcrMinuteFlushRunning";
const PERSIST_STATE_KEY = "stcrOvenPersistState";
const SENSOR_KEYS = [
  "chamberTemp",
  "humidity",
  "furnaceTemp",
  "blowerTemp",
];
const heartbeatSeconds = Math.max(
  10,
  Number(env.get("STCR_FACTORY_MQTT_HEARTBEAT_SECONDS") || 60),
);
const flushGraceMs = Math.max(
  0,
  Number(env.get("STCR_FACTORY_MQTT_MINUTE_FLUSH_GRACE_MS") || 5000),
);
const storeRawMessages =
  String(
    env.get("STCR_FACTORY_MQTT_STORE_RAW_MESSAGES") || "false",
  ).toLowerCase() === "true";

if (!envelope && !isFlushTick) {
  return null;
}

function getPool() {
  let pool = global.get("stcrMqttDbPool");
  if (pool) return pool;

  const password = String(env.get("STCR_DB_PASSWORD") || "");
  if (!password) {
    throw new Error("STCR_DB_PASSWORD is required");
  }

  pool = mysql.createPool({
    host: env.get("STCR_DB_HOST") || "127.0.0.1",
    port: Number(env.get("STCR_DB_PORT") || 3306),
    user: env.get("STCR_DB_USER") || "stcr_app",
    password,
    database: env.get("STCR_DB_NAME") || "stcr",
    waitForConnections: true,
    connectionLimit: 4,
    timezone: "Z",
  });
  global.set("stcrMqttDbPool", pool);
  return pool;
}

function validDate(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : fallback;
}

function fallbackStatus(startOven) {
  return startOven === 1 ? "open" : "closed";
}

function findMemoryOven(value) {
  const rootState = global.get("stcrState");
  const companyState = rootState?.companies?.[value.companyId];
  const oven = companyState?.ovens?.find(
    (item) => item.id === value.ovenId,
  );
  return { rootState, companyState, oven };
}

function updateRealtimeMemory(value, receivedAtDate) {
  const { rootState, oven } = findMemoryOven(value);
  if (!rootState || !oven) return;

  const timestamp = receivedAtDate.toISOString();

  if (value.type === "test") {
    oven.status = value.ovenState === 1 ? "open" : "closed";
  } else {
    if (oven.status === "offline") {
      oven.status = fallbackStatus(value.startOven);
    }

    for (const reading of value.readings || []) {
      oven.readings ||= {};
      oven.readings[reading.sensorKey] = {
        ...(oven.readings[reading.sensorKey] || {}),
        value: reading.value,
        updatedAt: timestamp,
      };
    }
  }

  oven.lastUpdatedAt = timestamp;
  global.set("stcrState", rootState);
}

function createMetric() {
  return {
    sum: 0,
    min: null,
    max: null,
    last: null,
    count: 0,
  };
}

function addMetric(metric, value) {
  if (!Number.isFinite(value)) return;
  metric.sum += value;
  metric.min = metric.min === null ? value : Math.min(metric.min, value);
  metric.max = metric.max === null ? value : Math.max(metric.max, value);
  metric.last = value;
  metric.count += 1;
}

function metricValues(metric) {
  if (!metric || metric.count < 1) {
    return {
      avg: null,
      min: null,
      max: null,
      last: null,
      count: 0,
    };
  }

  return {
    avg: metric.sum / metric.count,
    min: metric.min,
    max: metric.max,
    last: metric.last,
    count: metric.count,
  };
}

function minuteStart(date) {
  const value = new Date(date);
  value.setUTCSeconds(0, 0);
  return value;
}

function bucketKey(value, minuteAt) {
  return `${value.companyId}|${value.ovenId}|${minuteAt.toISOString()}`;
}

function addToMinuteBucket(value, receivedAtDate) {
  if (!(value.readings || []).length) return;

  const sourceDate = validDate(value.sourceTimestamp, receivedAtDate);
  // Use server receive time for minute buckets so a stale device clock
  // cannot force one database write per incoming message.
  const minuteAt = minuteStart(receivedAtDate);
  const key = bucketKey(value, minuteAt);
  const buckets = global.get(BUCKETS_KEY) || {};
  const bucket = buckets[key] || {
    key,
    companyId: value.companyId,
    ovenId: value.ovenId,
    ovenNumber: value.ovenNumber,
    cycleNumber: value.cycleNumber,
    minuteAt: minuteAt.toISOString(),
    firstSourceAt: sourceDate.toISOString(),
    lastSourceAt: sourceDate.toISOString(),
    firstReceivedAt: receivedAtDate.toISOString(),
    lastReceivedAt: receivedAtDate.toISOString(),
    startOven: value.startOven,
    quality: value.quality || "good",
    metrics: Object.fromEntries(
      SENSOR_KEYS.map((sensorKey) => [sensorKey, createMetric()]),
    ),
  };

  bucket.cycleNumber = value.cycleNumber;
  bucket.startOven = value.startOven;
  bucket.lastSourceAt = sourceDate.toISOString();
  bucket.lastReceivedAt = receivedAtDate.toISOString();
  if (value.quality === "suspect") {
    bucket.quality = "suspect";
  } else if (value.type === "pending" && bucket.quality === "good") {
    bucket.quality = "missing";
  }

  for (const reading of value.readings || []) {
    if (!bucket.metrics[reading.sensorKey]) continue;
    addMetric(bucket.metrics[reading.sensorKey], Number(reading.value));
  }

  buckets[key] = bucket;
  global.set(BUCKETS_KEY, buckets);
}

function mergeBuckets(target, source) {
  if (!target) return source;
  target.cycleNumber = source.cycleNumber;
  target.startOven = source.startOven;
  target.firstSourceAt =
    target.firstSourceAt < source.firstSourceAt
      ? target.firstSourceAt
      : source.firstSourceAt;
  target.lastSourceAt =
    target.lastSourceAt > source.lastSourceAt
      ? target.lastSourceAt
      : source.lastSourceAt;
  target.firstReceivedAt =
    target.firstReceivedAt < source.firstReceivedAt
      ? target.firstReceivedAt
      : source.firstReceivedAt;
  target.lastReceivedAt =
    target.lastReceivedAt > source.lastReceivedAt
      ? target.lastReceivedAt
      : source.lastReceivedAt;
  if (source.quality === "suspect") target.quality = "suspect";

  for (const sensorKey of SENSOR_KEYS) {
    const left = target.metrics[sensorKey];
    const right = source.metrics[sensorKey];
    if (!right?.count) continue;
    left.sum += right.sum;
    left.min = left.min === null ? right.min : Math.min(left.min, right.min);
    left.max = left.max === null ? right.max : Math.max(left.max, right.max);
    left.last = right.last;
    left.count += right.count;
  }
  return target;
}

function makeMessageHash(value) {
  return crypto
    .createHash("sha256")
    .update(
      [
        value.companyId,
        value.ovenId,
        value.topic,
        value.cycleNumber,
        value.sourceTimestamp,
        JSON.stringify(value.source),
      ].join("\n"),
    )
    .digest("hex");
}

async function saveRawMessage(executor, value, receivedAtDate, detail) {
  if (!storeRawMessages) return;

  await executor.execute(
    `INSERT INTO factory_mqtt_messages (
       company_id,
       oven_id,
       oven_number,
       cycle_number,
       topic,
       qos,
       retained,
       duplicate_delivery,
       source_timestamp,
       payload_json,
       message_hash,
       normalization_status,
       normalization_detail,
       received_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       duplicate_delivery = TRUE,
       received_at = VALUES(received_at),
       normalization_status = VALUES(normalization_status),
       normalization_detail = VALUES(normalization_detail)`,
    [
      value.companyId,
      value.ovenId,
      value.ovenNumber,
      value.cycleNumber,
      value.topic,
      value.qos,
      value.retained,
      value.duplicateDelivery,
      value.sourceTimestamp,
      JSON.stringify(value.source),
      makeMessageHash(value),
      value.type === "pending" ? "pending" : "normalized",
      detail,
      receivedAtDate,
    ],
  );
}

function persistStateKey(value) {
  return `${value.companyId}|${value.ovenId}`;
}

function getPersistStates() {
  return global.get(PERSIST_STATE_KEY) || {};
}

function isHeartbeatDue(state, receivedAtDate) {
  if (!state?.lastSeenAt) return true;
  return (
    receivedAtDate.getTime() - Date.parse(state.lastSeenAt) >=
    heartbeatSeconds * 1000
  );
}

async function persistStatus(value, receivedAtDate) {
  const status = value.ovenState === 1 ? "open" : "closed";
  const states = getPersistStates();
  const key = persistStateKey(value);
  const state = states[key];

  if (state?.status === status && !isHeartbeatDue(state, receivedAtDate)) {
    return;
  }

  const pool = getPool();
  const [result] = await pool.execute(
    `UPDATE ovens
     SET status = ?, last_seen_at = ?
     WHERE company_id = ?
       AND id = ?
       AND enabled = TRUE`,
    [
      status,
      receivedAtDate,
      value.companyId,
      value.ovenId,
    ],
  );

  if (!result.affectedRows) {
    node.warn(`MQTT status: oven ${value.companyId}/${value.ovenId} not found`);
    return;
  }

  states[key] = {
    status,
    lastSeenAt: receivedAtDate.toISOString(),
  };
  global.set(PERSIST_STATE_KEY, states);

  if (storeRawMessages) {
    await saveRawMessage(
      pool,
      value,
      receivedAtDate,
      `oven_state=${value.ovenState}`,
    );
  }
}

async function persistHeartbeat(value, receivedAtDate) {
  const states = getPersistStates();
  const key = persistStateKey(value);
  const state = states[key];

  if (!isHeartbeatDue(state, receivedAtDate)) {
    return;
  }

  const currentMemoryStatus =
    findMemoryOven(value).oven?.status || fallbackStatus(value.startOven);
  const pool = getPool();
  const [result] = await pool.execute(
    `UPDATE ovens
     SET
       status = CASE
         WHEN status = 'offline' THEN ?
         ELSE status
       END,
       last_seen_at = ?
     WHERE company_id = ?
       AND id = ?
       AND enabled = TRUE`,
    [
      fallbackStatus(value.startOven),
      receivedAtDate,
      value.companyId,
      value.ovenId,
    ],
  );

  if (!result.affectedRows) {
    node.warn(`MQTT heartbeat: oven ${value.companyId}/${value.ovenId} not found`);
    return;
  }

  states[key] = {
    status: currentMemoryStatus,
    lastSeenAt: receivedAtDate.toISOString(),
  };
  global.set(PERSIST_STATE_KEY, states);
}

async function resolveCycleLifecycle(
  connection,
  bucket,
  ovenRow,
  firstSourceAt,
) {
  if (!Number.isSafeInteger(bucket.cycleNumber) || bucket.cycleNumber < 1) {
    return null;
  }

  if (bucket.startOven === 1) {
    // A new cycle number is authoritative. Close an older active cycle first.
    await connection.execute(
      `UPDATE oven_cycles
       SET state = 'completed',
           stopped_at = COALESCE(stopped_at, ?)
       WHERE company_id = ?
         AND oven_id = ?
         AND cycle_number <> ?
         AND state IN ('ignition', 'recording')`,
      [
        firstSourceAt,
        bucket.companyId,
        bucket.ovenId,
        bucket.cycleNumber,
      ],
    );

    await connection.execute(
      `INSERT INTO oven_cycles (
         company_id,
         oven_id,
         cycle_number,
         state,
         fired_at,
         report_started_at,
         ready_temperature,
         ready_hold_seconds
       ) VALUES (?, ?, ?, 'recording', ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE
         cycle_number = VALUES(cycle_number)`,
      [
        bucket.companyId,
        bucket.ovenId,
        bucket.cycleNumber,
        firstSourceAt,
        firstSourceAt,
        Number(ovenRow.chamberLower),
      ],
    );

    // Business rule: an open oven starts report recording immediately.
    await connection.execute(
      `UPDATE oven_cycles
       SET state = 'recording',
           report_started_at = COALESCE(report_started_at, fired_at)
       WHERE company_id = ?
         AND oven_id = ?
         AND cycle_number = ?
         AND state = 'ignition'`,
      [bucket.companyId, bucket.ovenId, bucket.cycleNumber],
    );
  } else if (bucket.startOven === 0) {
    await connection.execute(
      `UPDATE oven_cycles
       SET state = 'completed',
           stopped_at = COALESCE(stopped_at, ?)
       WHERE company_id = ?
         AND oven_id = ?
         AND cycle_number = ?
         AND state IN ('ignition', 'recording')`,
      [
        firstSourceAt,
        bucket.companyId,
        bucket.ovenId,
        bucket.cycleNumber,
      ],
    );
  }

  const [cycleRows] = await connection.execute(
    `SELECT id, state, fired_at AS firedAt,
            report_started_at AS reportStartedAt,
            stopped_at AS stoppedAt
     FROM oven_cycles
     WHERE company_id = ?
       AND oven_id = ?
       AND cycle_number = ?
     LIMIT 1
     FOR UPDATE`,
    [bucket.companyId, bucket.ovenId, bucket.cycleNumber],
  );

  const cycle = cycleRows[0] || null;
  if (!cycle || cycle.state !== "recording" || !cycle.reportStartedAt) {
    return cycle;
  }
  const reportMinuteAt = minuteStart(validDate(cycle.reportStartedAt));

  // Backfill points already received for this same cycle after the oven opened.
  await connection.execute(
    `UPDATE sensor_minute_aggregates
     SET cycle_id = ?,
         cycle_phase = 'recording',
         included_in_report = TRUE
     WHERE company_id = ?
       AND oven_id = ?
       AND cycle_number = ?
       AND minute_at >= ?`,
    [
      cycle.id,
      bucket.companyId,
      bucket.ovenId,
      bucket.cycleNumber,
      reportMinuteAt,
    ],
  );
  await connection.execute(
    `UPDATE sensor_readings
     SET cycle_id = ?,
         cycle_phase = 'recording',
         included_in_report = TRUE
     WHERE company_id = ?
       AND oven_id = ?
       AND recorded_at >= ?
       AND (cycle_id IS NULL OR cycle_id = ?)`,
    [
      cycle.id,
      bucket.companyId,
      bucket.ovenId,
      reportMinuteAt,
      cycle.id,
    ],
  );

  return cycle;
}

function syncCycleMemory(bucket, cycle) {
  if (!cycle) return;
  const { rootState, oven } = findMemoryOven(bucket);
  if (!rootState || !oven) return;

  oven.cycleCount = bucket.cycleNumber;
  oven.firedAt = validDate(cycle.firedAt).toISOString();

  if (cycle.reportStartedAt) {
    oven.reportStartedAt = validDate(cycle.reportStartedAt).toISOString();
    oven.startedAt = oven.reportStartedAt;
  } else {
    delete oven.reportStartedAt;
    delete oven.startedAt;
  }

  if (cycle.stoppedAt) {
    oven.stoppedAt = validDate(cycle.stoppedAt).toISOString();
  } else {
    delete oven.stoppedAt;
  }

  global.set("stcrState", rootState);
}

async function persistMinuteBucket(bucket) {
  const pool = getPool();
  const connection = await pool.getConnection();

  const chamber = metricValues(bucket.metrics.chamberTemp);
  const humidity = metricValues(bucket.metrics.humidity);
  const furnace = metricValues(bucket.metrics.furnaceTemp);
  const blower = metricValues(bucket.metrics.blowerTemp);
  const minuteAt = validDate(bucket.minuteAt);
  const firstSourceAt = validDate(bucket.firstSourceAt, minuteAt);
  const lastSourceAt = validDate(bucket.lastSourceAt, minuteAt);
  const firstReceivedAt = validDate(bucket.firstReceivedAt, minuteAt);
  const lastReceivedAt = validDate(bucket.lastReceivedAt, minuteAt);

  try {
    await connection.beginTransaction();

    const [ovenRows] = await connection.execute(
      `SELECT id, chamber_lower AS chamberLower
       FROM ovens
       WHERE company_id = ?
         AND id = ?
         AND enabled = TRUE
       LIMIT 1`,
      [bucket.companyId, bucket.ovenId],
    );

    if (!ovenRows[0]) {
      throw new Error(
        `Oven ${bucket.companyId}/${bucket.ovenId} not found`,
      );
    }

    const cycle = await resolveCycleLifecycle(
      connection,
      bucket,
      ovenRows[0],
      firstSourceAt,
    );
    const cyclePhase =
      cycle?.state === "recording"
        ? "recording"
        : cycle?.state === "ignition"
          ? "ignition"
          : cycle?.state === "completed"
            ? "cooldown"
            : "idle";
    const includedInReport = cyclePhase === "recording";

    await connection.execute(
      `INSERT INTO sensor_minute_aggregates (
         company_id,
         oven_id,
         cycle_id,
         cycle_number,
         minute_at,
         chamber_temp_avg,
         chamber_temp_min,
         chamber_temp_max,
         chamber_temp_last,
         chamber_temp_count,
         humidity_avg,
         humidity_min,
         humidity_max,
         humidity_last,
         humidity_count,
         furnace_temp_avg,
         furnace_temp_min,
         furnace_temp_max,
         furnace_temp_last,
         furnace_temp_count,
         blower_temp_avg,
         blower_temp_min,
         blower_temp_max,
         blower_temp_last,
         blower_temp_count,
         cycle_phase,
         included_in_report,
         quality,
         first_source_at,
         last_source_at,
         first_received_at,
         last_received_at,
         created_at,
         updated_at
       )
       VALUES (
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?, ?
       )
       ON DUPLICATE KEY UPDATE
         cycle_id = VALUES(cycle_id),
         cycle_number = VALUES(cycle_number),
         chamber_temp_avg = VALUES(chamber_temp_avg),
         chamber_temp_min = VALUES(chamber_temp_min),
         chamber_temp_max = VALUES(chamber_temp_max),
         chamber_temp_last = VALUES(chamber_temp_last),
         chamber_temp_count = VALUES(chamber_temp_count),
         humidity_avg = VALUES(humidity_avg),
         humidity_min = VALUES(humidity_min),
         humidity_max = VALUES(humidity_max),
         humidity_last = VALUES(humidity_last),
         humidity_count = VALUES(humidity_count),
         furnace_temp_avg = VALUES(furnace_temp_avg),
         furnace_temp_min = VALUES(furnace_temp_min),
         furnace_temp_max = VALUES(furnace_temp_max),
         furnace_temp_last = VALUES(furnace_temp_last),
         furnace_temp_count = VALUES(furnace_temp_count),
         blower_temp_avg = VALUES(blower_temp_avg),
         blower_temp_min = VALUES(blower_temp_min),
         blower_temp_max = VALUES(blower_temp_max),
         blower_temp_last = VALUES(blower_temp_last),
         blower_temp_count = VALUES(blower_temp_count),
         cycle_phase = VALUES(cycle_phase),
         included_in_report = VALUES(included_in_report),
         quality = VALUES(quality),
         first_source_at = VALUES(first_source_at),
         last_source_at = VALUES(last_source_at),
         first_received_at = VALUES(first_received_at),
         last_received_at = VALUES(last_received_at),
         updated_at = VALUES(updated_at)`,
      [
        bucket.companyId,
        bucket.ovenId,
        cycle?.id || null,
        bucket.cycleNumber,
        minuteAt,
        chamber.avg,
        chamber.min,
        chamber.max,
        chamber.last,
        chamber.count,
        humidity.avg,
        humidity.min,
        humidity.max,
        humidity.last,
        humidity.count,
        furnace.avg,
        furnace.min,
        furnace.max,
        furnace.last,
        furnace.count,
        blower.avg,
        blower.min,
        blower.max,
        blower.last,
        blower.count,
        cyclePhase,
        includedInReport,
        bucket.quality || "good",
        firstSourceAt,
        lastSourceAt,
        firstReceivedAt,
        lastReceivedAt,
        lastReceivedAt,
        lastReceivedAt,
      ],
    );

    // Keep the existing history API compatible: one average point per minute.
    // The three core values are required by the current sensor_readings schema.
    if (
      chamber.count > 0 &&
      humidity.count > 0 &&
      furnace.count > 0
    ) {
      await connection.execute(
        `INSERT INTO sensor_readings (
           company_id,
           oven_id,
           cycle_id,
           recorded_at,
           chamber_temp,
           humidity,
           furnace_temp,
           blower_temp,
           cycle_phase,
           included_in_report,
           quality,
           source_timestamp,
           received_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           cycle_id = VALUES(cycle_id),
           chamber_temp = VALUES(chamber_temp),
           humidity = VALUES(humidity),
           furnace_temp = VALUES(furnace_temp),
           blower_temp = VALUES(blower_temp),
           cycle_phase = VALUES(cycle_phase),
           included_in_report = VALUES(included_in_report),
           quality = VALUES(quality),
           source_timestamp = VALUES(source_timestamp),
           received_at = VALUES(received_at)`,
        [
          bucket.companyId,
          bucket.ovenId,
          cycle?.id || null,
          minuteAt,
          chamber.avg,
          humidity.avg,
          furnace.avg,
          blower.avg,
          cyclePhase,
          includedInReport,
          bucket.quality || "good",
          lastSourceAt,
          lastReceivedAt,
        ],
      );
    }

    await connection.commit();
    syncCycleMemory(bucket, cycle);

    const { rootState, companyState, oven } = findMemoryOven(bucket);
    if (rootState && companyState && oven && chamber.count && humidity.count && furnace.count) {
      const point = {
        timestamp: minuteAt.toISOString(),
        chamberTemp: chamber.avg,
        humidity: humidity.avg,
        furnaceTemp: furnace.avg,
        blowerTemp: blower.avg,
      };
      companyState.history ||= {};
      companyState.history[bucket.ovenId] = [
        ...(companyState.history[bucket.ovenId] || []).filter(
          (item) => item.timestamp !== point.timestamp,
        ),
        point,
      ].slice(-10000);
      global.set("stcrState", rootState);
    }

    node.status({
      fill: "green",
      shape: "dot",
      text: `minute saved oven ${bucket.ovenNumber}`,
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function flushCompletedBuckets(referenceDate) {
  if (global.get(FLUSH_LOCK_KEY)) return;
  global.set(FLUSH_LOCK_KEY, true);

  const cutoffMs = referenceDate.getTime() - flushGraceMs;
  const buckets = global.get(BUCKETS_KEY) || {};
  const ready = [];

  for (const [key, bucket] of Object.entries(buckets)) {
    const minuteEndMs = validDate(bucket.minuteAt).getTime() + 60_000;
    if (minuteEndMs <= cutoffMs) {
      ready.push(bucket);
      delete buckets[key];
    }
  }
  global.set(BUCKETS_KEY, buckets);

  try {
    ready.sort((left, right) =>
      left.minuteAt.localeCompare(right.minuteAt),
    );

    for (const bucket of ready) {
      try {
        await persistMinuteBucket(bucket);
      } catch (error) {
        node.warn(
          `Minute aggregate write failed for ${bucket.companyId}/${bucket.ovenId}/${bucket.minuteAt}: ${error.message}`,
        );
        const current = global.get(BUCKETS_KEY) || {};
        current[bucket.key] = mergeBuckets(current[bucket.key], bucket);
        global.set(BUCKETS_KEY, current);
      }
    }
  } finally {
    global.set(FLUSH_LOCK_KEY, false);
  }
}

const referenceDate = isFlushTick
  ? validDate(msg.factoryMqtt?.receivedAt, new Date())
  : validDate(envelope.receivedAt, new Date());

if (isFlushTick) {
  await flushCompletedBuckets(referenceDate);
  return null;
}

updateRealtimeMemory(envelope, referenceDate);

try {
  if (envelope.type === "test") {
    await persistStatus(envelope, referenceDate);
    await flushCompletedBuckets(referenceDate);
    return null;
  }

  if (envelope.type === "sensor" || envelope.type === "pending") {
    addToMinuteBucket(envelope, referenceDate);
    await persistHeartbeat(envelope, referenceDate);

    if (storeRawMessages && envelope.type === "pending") {
      await saveRawMessage(
        getPool(),
        envelope,
        referenceDate,
        `missing: ${(envelope.missingSensors || []).join(", ")}`,
      );
    }

    await flushCompletedBuckets(referenceDate);
    return null;
  }

  node.warn(`Unknown MQTT envelope type: ${String(envelope.type)}`);
} catch (error) {
  node.warn(`MQTT processing failed: ${error.message}`);
  node.status({
    fill: "red",
    shape: "ring",
    text: `DB error oven ${envelope.ovenNumber}`,
  });
}

return null;
