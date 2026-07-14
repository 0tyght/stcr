const config = {
  host: env.get("STCR_DB_HOST") || "127.0.0.1",
  port: Number(env.get("STCR_DB_PORT") || 3306),
  user: env.get("STCR_DB_USER") || "stcr_app",
  password: env.get("STCR_DB_PASSWORD") || "",
  database: env.get("STCR_DB_NAME") || "stcr",
  waitForConnections: true,
  connectionLimit: 4,
  timezone: "Z",
};

const ARCHIVE_STEP_MS = 10 * 60 * 1000;
async function persistArchivedCycle(connection, companyId, oven, limits, cycle, completedBackfills) {
  await connection.execute(
    `INSERT INTO oven_cycles (
      company_id, oven_id, cycle_number, state, fired_at, report_started_at,
      stopped_at, ready_temperature, ready_hold_seconds
    ) VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      state='completed', fired_at=VALUES(fired_at), report_started_at=VALUES(report_started_at),
      stopped_at=VALUES(stopped_at), updated_at=CURRENT_TIMESTAMP(3)`,
    [
      companyId, oven.id, cycle.cycleNumber, cycle.firedAt, cycle.reportStartedAt,
      cycle.stoppedAt, limits.chamberTemp.lower, 1800,
    ],
  );

  const [cycleRows] = await connection.execute(
    `SELECT id FROM oven_cycles WHERE company_id=? AND oven_id=? AND cycle_number=? LIMIT 1`,
    [companyId, oven.id, cycle.cycleNumber],
  );
  const cycleId = cycleRows[0]?.id;
  if (!cycleId) return;

  const backfillKey = `dbArchive:${companyId}:${oven.id}:${cycle.cycleNumber}:${cycle.firedAt}`;
  if (context.get(backfillKey)) return;

  // Always repair the report boundary before deciding that an archived cycle
  // already has enough data. Older seeded rows may share the cycle id but sit
  // outside the official report window.
  await connection.execute(
    `UPDATE sensor_readings
     SET included_in_report=FALSE,
         cycle_phase=CASE WHEN recorded_at<? THEN 'ignition' ELSE 'cooldown' END
     WHERE cycle_id=? AND (recorded_at<? OR recorded_at>?)`,
    [cycle.reportStartedAt, cycleId, cycle.reportStartedAt, cycle.stoppedAt],
  );

  const [existingRows] = await connection.execute(
    `SELECT COUNT(*) AS pointCount FROM sensor_readings WHERE cycle_id=? AND included_in_report=TRUE`,
    [cycleId],
  );
  if (Number(existingRows[0]?.pointCount || 0) >= 50) {
    completedBackfills.push(backfillKey);
    return;
  }

  const firedAtMs = Date.parse(cycle.firedAt);
  const startMs = Date.parse(cycle.reportStartedAt);
  const endMs = Date.parse(cycle.stoppedAt);

  for (let chunkStart = startMs; chunkStart <= endMs; chunkStart += ARCHIVE_STEP_MS * 400) {
    const chunk = [];
    const chunkEnd = Math.min(endMs, chunkStart + ARCHIVE_STEP_MS * 399);
    for (let timestamp = chunkStart; timestamp <= chunkEnd; timestamp += ARCHIVE_STEP_MS) {
      chunk.push({
        timestamp: new Date(timestamp).toISOString(),
        ...simulationSensorValues(companyId, oven.number, timestamp, firedAtMs),
      });
    }
    if (!chunk.length) continue;

    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, 'recording', TRUE, 'good', ?)").join(",");
    const values = chunk.flatMap((point) => [
      companyId, oven.id, cycleId, point.timestamp,
      point.chamberTemp, point.humidity, point.furnaceTemp, point.blowerTemp,
      point.timestamp,
    ]);
    await connection.execute(
      `INSERT IGNORE INTO sensor_readings (
        company_id, oven_id, cycle_id, recorded_at, chamber_temp, humidity,
        furnace_temp, blower_temp, cycle_phase, included_in_report, quality, source_timestamp
      ) VALUES ${placeholders}`,
      values,
    );
  }

  completedBackfills.push(backfillKey);
}

let pool = context.get("stcrDbPool");
if (!pool) {
  pool = mysql.createPool(config);
  context.set("stcrDbPool", pool);
}

const snapshot = msg.payload;
if (!snapshot || !snapshot.companies) return null;
const updatedOvenIds = new Set(snapshot.updatedOvenIds || []);
const persistenceScope = Object.keys(snapshot.companies).sort().join(",");
const persistenceLockKey = `stcrDbPersisting:${persistenceScope}`;
if (context.get(persistenceLockKey)) return null;
context.set(persistenceLockKey, true);

const maxPersistenceAttempts = 3;

for (let attempt = 1; attempt <= maxPersistenceAttempts; attempt += 1) {
  let connection;
  const completedBackfills = [];

  try {
    connection = await pool.getConnection();
  await connection.query("SET time_zone = '+00:00'");
  await connection.beginTransaction();

  for (const [companyId, companyState] of Object.entries(snapshot.companies)) {
    const companyName = companyId === "gr" ? "Grand Rubber" : companyId === "ttn" ? "TTN Rubber" : companyId;
    await connection.execute(
      `INSERT INTO companies (id, name, data_source_key)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name), data_source_key=VALUES(data_source_key)`,
      [companyId, companyName, `${companyId}-node-red`],
    );

    for (const oven of companyState.ovens) {
      const limits = oven.limits;
      await connection.execute(
        `INSERT INTO ovens (
          id, company_id, oven_number, name, zone_name, line_name, status, enabled,
          chamber_lower, chamber_upper, furnace_lower, furnace_upper,
          blower_lower, blower_upper, humidity_lower, humidity_upper, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          oven_number=VALUES(oven_number), name=VALUES(name), zone_name=VALUES(zone_name),
          line_name=VALUES(line_name), status=VALUES(status), enabled=VALUES(enabled),
          chamber_lower=VALUES(chamber_lower), chamber_upper=VALUES(chamber_upper),
          furnace_lower=VALUES(furnace_lower), furnace_upper=VALUES(furnace_upper),
          blower_lower=VALUES(blower_lower), blower_upper=VALUES(blower_upper),
          humidity_lower=VALUES(humidity_lower), humidity_upper=VALUES(humidity_upper),
          last_seen_at=VALUES(last_seen_at)`,
        [
          oven.id, companyId, oven.number, oven.name, oven.zone, oven.line, oven.status, oven.enabled,
          limits.chamberTemp.lower, limits.chamberTemp.upper,
          limits.furnaceTemp.lower, limits.furnaceTemp.upper,
          limits.blowerTemp.lower, limits.blowerTemp.upper,
          limits.humidity.lower, limits.humidity.upper, oven.lastUpdatedAt,
        ],
      );

      let cycleId = null;
      if (oven.status === "open" && oven.firedAt && oven.cycleCount > 0) {
        const cycleState = oven.reportStartedAt ? "recording" : "ignition";
        await connection.execute(
          `INSERT INTO oven_cycles (
            company_id, oven_id, cycle_number, state, fired_at, report_started_at,
            stopped_at, ready_temperature, ready_hold_seconds
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            state=VALUES(state), fired_at=VALUES(fired_at),
            report_started_at=VALUES(report_started_at),
            stopped_at=VALUES(stopped_at),
            updated_at=CURRENT_TIMESTAMP(3)`,
          [
            companyId, oven.id, oven.cycleCount, cycleState, oven.firedAt,
            oven.reportStartedAt || null, oven.stoppedAt || null,
            limits.chamberTemp.lower, 1800,
          ],
        );
        const [cycleRows] = await connection.execute(
          `SELECT id FROM oven_cycles WHERE company_id=? AND oven_id=? AND cycle_number=? LIMIT 1`,
          [companyId, oven.id, oven.cycleCount],
        );
        cycleId = cycleRows[0]?.id || null;
        if (cycleId) {
          if (oven.reportStartedAt) {
            await connection.execute(
              `UPDATE sensor_readings
               SET included_in_report=FALSE, cycle_phase='ignition'
               WHERE cycle_id=? AND recorded_at<?`,
              [cycleId, oven.reportStartedAt],
            );
          } else {
            await connection.execute(
              `UPDATE sensor_readings
               SET included_in_report=FALSE, cycle_phase='ignition'
               WHERE cycle_id=?`,
              [cycleId],
            );
          }
        }
      }

      const backfillKey = `dbBackfill:${companyId}:${oven.id}:${oven.cycleCount}:${oven.firedAt || "none"}`;
      if (cycleId && oven.firedAt && !context.get(backfillKey)) {
        const firedAtMs = Date.parse(oven.firedAt);
        const reportStartMs = oven.reportStartedAt ? Date.parse(oven.reportStartedAt) : Number.POSITIVE_INFINITY;
        const stoppedAtMs = oven.stoppedAt ? Date.parse(oven.stoppedAt) : Number.POSITIVE_INFINITY;
        const history = (companyState.history[oven.id] || []).filter(
          (point) => {
            const timestamp = Date.parse(point.timestamp);
            return timestamp >= firedAtMs && timestamp <= stoppedAtMs;
          },
        );

        for (let offset = 0; offset < history.length; offset += 400) {
          const chunk = history.slice(offset, offset + 400);
          if (!chunk.length) continue;
          const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'good', ?)").join(",");
          const values = chunk.flatMap((point) => {
            const includedInReport = Date.parse(point.timestamp) >= reportStartMs;
            return [
              companyId, oven.id, cycleId, point.timestamp,
              point.chamberTemp, point.humidity, point.furnaceTemp, point.blowerTemp,
              includedInReport ? "recording" : "ignition", includedInReport,
              point.timestamp,
            ];
          });
          await connection.execute(
            `INSERT INTO sensor_readings (
              company_id, oven_id, cycle_id, recorded_at, chamber_temp, humidity,
              furnace_temp, blower_temp, cycle_phase, included_in_report, quality, source_timestamp
            ) VALUES ${placeholders}
            ON DUPLICATE KEY UPDATE
              cycle_id=VALUES(cycle_id), chamber_temp=VALUES(chamber_temp),
              humidity=VALUES(humidity), furnace_temp=VALUES(furnace_temp),
              blower_temp=VALUES(blower_temp), cycle_phase=VALUES(cycle_phase),
              included_in_report=VALUES(included_in_report), quality=VALUES(quality),
              source_timestamp=VALUES(source_timestamp)`,
            values,
          );
        }
        completedBackfills.push(backfillKey);
      }

      if (oven.status === "open" && updatedOvenIds.has(oven.id)) {
        const reading = oven.readings;
        const includedInReport = Boolean(oven.reportStartedAt);
        const sensorSet = snapshot.telemetrySamples?.[`${companyId}:${oven.id}`] || {};
        const quality = Object.values(sensorSet).some((sample) => sample.quality !== "good") ? "suspect" : "good";
        const sourceTimestamp = sensorSet.chamberTemp?.sourceTimestamp || oven.lastUpdatedAt;
        await connection.execute(
          `INSERT INTO sensor_readings (
            company_id, oven_id, cycle_id, recorded_at, chamber_temp, humidity,
            furnace_temp, blower_temp, cycle_phase, included_in_report, quality, source_timestamp
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            chamber_temp=VALUES(chamber_temp), humidity=VALUES(humidity),
            furnace_temp=VALUES(furnace_temp), blower_temp=VALUES(blower_temp),
            cycle_id=VALUES(cycle_id), cycle_phase=VALUES(cycle_phase),
            included_in_report=VALUES(included_in_report), source_timestamp=VALUES(source_timestamp)`,
          [
            companyId, oven.id, cycleId, oven.lastUpdatedAt,
            reading.chamberTemp.value, reading.humidity.value,
            reading.furnaceTemp.value, reading.blowerTemp.value,
            includedInReport ? "recording" : "ignition", includedInReport, quality,
            sourceTimestamp,
          ],
        );
      }

      for (const cycle of companyState.archivedCycles?.[oven.id] || []) {
        await persistArchivedCycle(connection, companyId, oven, limits, cycle, completedBackfills);
      }
    }

    for (const alarm of companyState.alarms) {
      await connection.execute(
        `INSERT INTO alarms (
          id, company_id, oven_id, sensor_key, severity, status, title, detail,
          measured_value, limit_value, created_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          status=VALUES(status), title=VALUES(title), detail=VALUES(detail),
          measured_value=VALUES(measured_value), limit_value=VALUES(limit_value),
          resolved_at=VALUES(resolved_at)`,
        [
          `${companyId}-${alarm.id}`, companyId, alarm.ovenId, alarm.sensor || null,
          alarm.severity, alarm.status, alarm.title, alarm.detail,
          alarm.value ?? null, alarm.limit ?? null, alarm.createdAt, alarm.resolvedAt || null,
        ],
      );
    }

    const unresolvedAlarmIds = companyState.alarms
      .filter((alarm) => alarm.status === "active" || alarm.status === "acknowledged")
      .map((alarm) => `${companyId}-${alarm.id}`);
    const unresolvedClause = unresolvedAlarmIds.length
      ? ` AND id NOT IN (${unresolvedAlarmIds.map(() => "?").join(",")})`
      : "";
    await connection.execute(
      `UPDATE alarms
       SET status='resolved', resolved_at=COALESCE(resolved_at, ?)
       WHERE company_id=? AND status IN ('active','acknowledged')${unresolvedClause}`,
      [snapshot.capturedAt, companyId, ...unresolvedAlarmIds],
    );

    const companySamples = Object.values(snapshot.telemetrySamples || {})
      .flatMap((sensorSet) => Object.values(sensorSet))
      .filter((sample) => sample.companyId === companyId);

    for (const sample of companySamples) {
      await connection.execute(
        `INSERT INTO telemetry_events (
          company_id, oven_id, batch_id, topic, device_id, sensor_id, sensor_key,
          sequence_number, numeric_value, unit_symbol, quality, quality_reasons,
          source_timestamp, gateway_timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          numeric_value=VALUES(numeric_value), quality=VALUES(quality),
          quality_reasons=VALUES(quality_reasons), source_timestamp=VALUES(source_timestamp),
          gateway_timestamp=VALUES(gateway_timestamp), received_at=CURRENT_TIMESTAMP(3)`,
        [
          sample.companyId, sample.ovenId, sample.batchId, sample.topic,
          sample.deviceId, sample.sensorId, sample.sensorKey, sample.sequence,
          sample.rawValue ?? sample.value, sample.unit, sample.quality,
          JSON.stringify(sample.qualityReasons || []), sample.sourceTimestamp,
          sample.gatewayTimestamp,
        ],
      );
    }
  }

    await connection.commit();
    completedBackfills.forEach((key) => context.set(key, true));
    node.status({ fill: "green", shape: "dot", text: `DB ${snapshot.capturedAt}` });
    break;
  } catch (error) {
    if (connection) await connection.rollback();
    const retryable = error.code === "ER_LOCK_DEADLOCK" || error.errno === 1213;
    if (retryable && attempt < maxPersistenceAttempts) {
      node.warn(`Database deadlock; retrying persistence (${attempt}/${maxPersistenceAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      continue;
    }
    node.status({ fill: "red", shape: "ring", text: `DB ${error.code || "error"}` });
    node.error(`STCR database persistence failed: ${error.message}`, msg);
    break;
  } finally {
    connection?.release();
  }
}

context.set(persistenceLockKey, false);

return null;
