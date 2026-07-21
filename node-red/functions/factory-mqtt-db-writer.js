// factory-mqtt-db-writer.js
// รับ _mqttEnvelope จาก adapter แล้วเขียน MySQL โดยตรง (async node)
// ไม่ต้องผ่าน HTTP self-call เพราะทุกอย่างอยู่เครื่องเดียวกัน

const envelope = msg._mqttEnvelope;
if (!envelope) return null; // ไม่มีข้อมูลให้เขียน

function getPool() {
  let pool = global.get("stcrMqttDbPool");
  if (pool) return pool;
  const password = String(env.get("STCR_DB_PASSWORD") || "");
  if (!password) throw new Error("STCR_DB_PASSWORD is required");
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

const messageHash = crypto
  .createHash("sha256")
  .update([
    envelope.companyId, envelope.ovenId, envelope.topic,
    envelope.cycleNumber, envelope.sourceTimestamp,
    JSON.stringify(envelope.source),
  ].join("\n"))
  .digest("hex");

// ── test: อัปเดตสถานะเตา ────────────────────────────────────────────────────
if (envelope.type === "test") {
  try {
    const pool = getPool();
    await pool.execute(
      `INSERT INTO factory_mqtt_messages (
         company_id, oven_id, oven_number, cycle_number, topic, qos,
         retained, duplicate_delivery, source_timestamp, payload_json,
         message_hash, normalization_status, normalization_detail
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?)
       ON DUPLICATE KEY UPDATE duplicate_delivery=TRUE, received_at=CURRENT_TIMESTAMP(3)`,
      [
        envelope.companyId, envelope.ovenId, envelope.ovenNumber, envelope.cycleNumber,
        envelope.topic, envelope.qos, envelope.retained, envelope.duplicateDelivery,
        envelope.sourceTimestamp, JSON.stringify(envelope.source), messageHash,
        `oven_state=${envelope.ovenState}`,
      ],
    );
    await pool.execute(
      `UPDATE ovens SET status=?, last_seen_at=CURRENT_TIMESTAMP(3)
       WHERE company_id=? AND id=? AND enabled=TRUE`,
      [envelope.ovenState === 1 ? "open" : "closed", envelope.companyId, envelope.ovenId],
    );
    // อัปเดต in-memory state
    const rootState = global.get("stcrState");
    const oven = rootState?.companies?.[envelope.companyId]?.ovens?.find((o) => o.id === envelope.ovenId);
    if (oven) {
      oven.status = envelope.ovenState === 1 ? "open" : "closed";
      oven.lastUpdatedAt = new Date().toISOString();
      global.set("stcrState", rootState);
    }
  } catch (err) {
    node.warn(`MQTT test DB write failed: ${err.message}`);
  }
  return null;
}

// ── pending: บันทึกข้อมูลไม่ครบ ─────────────────────────────────────────────
if (envelope.type === "pending") {
  try {
    const pool = getPool();
    await pool.execute(
      `INSERT INTO factory_mqtt_messages (
         company_id, oven_id, oven_number, cycle_number, topic, qos,
         retained, duplicate_delivery, source_timestamp, payload_json,
         message_hash, normalization_status, normalization_detail
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
       ON DUPLICATE KEY UPDATE duplicate_delivery=TRUE, received_at=CURRENT_TIMESTAMP(3)`,
      [
        envelope.companyId, envelope.ovenId, envelope.ovenNumber, envelope.cycleNumber,
        envelope.topic, envelope.qos, envelope.retained, envelope.duplicateDelivery,
        envelope.sourceTimestamp, JSON.stringify(envelope.source), messageHash,
        `missing: ${(envelope.missingSensors || []).join(", ")}`,
      ],
    );
  } catch (err) {
    node.warn(`MQTT pending DB write failed: ${err.message}`);
  }
  return null;
}

// ── sensor: บันทึกค่า sensor ครบ ────────────────────────────────────────────
if (envelope.type === "sensor") {
  const receivedAtDate = new Date();
  const recordedAt = new Date(Date.parse(envelope.sourceTimestamp));
  const bySensor = Object.fromEntries(envelope.readings.map((r) => [r.sensorKey, r]));

  try {
    const pool = getPool();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 1. raw message
      await connection.execute(
        `INSERT INTO factory_mqtt_messages (
           company_id, oven_id, oven_number, cycle_number, topic, qos,
           retained, duplicate_delivery, source_timestamp, payload_json,
           message_hash, normalization_status, normalization_detail
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normalized', 'All four sensors normalized')
         ON DUPLICATE KEY UPDATE
           duplicate_delivery=TRUE, received_at=CURRENT_TIMESTAMP(3),
           normalization_status='normalized'`,
        [
          envelope.companyId, envelope.ovenId, envelope.ovenNumber, envelope.cycleNumber,
          envelope.topic, envelope.qos, envelope.retained, envelope.duplicateDelivery,
          envelope.sourceTimestamp, JSON.stringify(envelope.source), messageHash,
        ],
      );

      // 2. ตรวจว่าเตามีจริง
      const [ovenRows] = await connection.execute(
        `SELECT id FROM ovens WHERE company_id=? AND id=? AND enabled=TRUE LIMIT 1`,
        [envelope.companyId, envelope.ovenId],
      );
      if (!ovenRows[0]) {
        await connection.rollback();
        node.warn(`MQTT sensor: oven ${envelope.ovenId} not found`);
        return null;
      }

      // 3. cycle ปัจจุบัน
      const [cycleRows] = await connection.execute(
        `SELECT id, state FROM oven_cycles
         WHERE company_id=? AND oven_id=?
         ORDER BY cycle_number DESC LIMIT 1`,
        [envelope.companyId, envelope.ovenId],
      );
      const cycle = cycleRows[0] || null;
      const cyclePhase = cycle?.state === "recording" ? "recording"
        : cycle?.state === "ignition" ? "ignition"
        : cycle?.state === "completed" ? "cooldown" : "idle";
      const includedInReport = cyclePhase === "recording";

      // 4. telemetry_events
      for (const reading of envelope.readings) {
        await connection.execute(
          `INSERT INTO telemetry_events (
             company_id, oven_id, batch_id, topic, device_id, sensor_id, sensor_key,
             sequence_number, numeric_value, unit_symbol, quality, quality_reasons,
             source_timestamp, gateway_timestamp, received_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE received_at=VALUES(received_at)`,
          [
            envelope.companyId, envelope.ovenId, envelope.batchId,
            `stcr/${envelope.companyId}/${envelope.ovenId}/telemetry/${reading.sensorKey}`,
            envelope.deviceId, reading.sensorId, reading.sensorKey, reading.sequence,
            reading.rawValue, reading.unit, reading.quality,
            JSON.stringify(reading.qualityReasons),
            reading.sourceTimestamp, reading.sourceTimestamp, receivedAtDate,
          ],
        );
      }

      // 5. sensor_readings snapshot
      await connection.execute(
        `INSERT INTO sensor_readings (
           company_id, oven_id, cycle_id, recorded_at, chamber_temp, humidity,
           furnace_temp, blower_temp, cycle_phase, included_in_report, quality,
           source_timestamp, received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           chamber_temp=VALUES(chamber_temp), humidity=VALUES(humidity),
           furnace_temp=VALUES(furnace_temp), blower_temp=VALUES(blower_temp),
           quality=VALUES(quality), source_timestamp=VALUES(source_timestamp),
           received_at=VALUES(received_at)`,
        [
          envelope.companyId, envelope.ovenId, cycle?.id || null, recordedAt,
          bySensor.chamberTemp.value, bySensor.humidity.value,
          bySensor.furnaceTemp.value, bySensor.blowerTemp.value,
          cyclePhase, includedInReport, envelope.quality,
          recordedAt, receivedAtDate,
        ],
      );

      // 6. last_seen_at
      await connection.execute(
        `UPDATE ovens SET last_seen_at=? WHERE company_id=? AND id=?`,
        [receivedAtDate, envelope.companyId, envelope.ovenId],
      );

      await connection.commit();

      // 7. in-memory state
      const rootState = global.get("stcrState");
      const companyState = rootState?.companies?.[envelope.companyId];
      const oven = companyState?.ovens?.find((o) => o.id === envelope.ovenId);
      if (oven) {
        const timestamp = recordedAt.toISOString();
        envelope.readings.forEach((r) => {
          oven.readings[r.sensorKey] = { ...oven.readings[r.sensorKey], value: r.value, updatedAt: timestamp };
        });
        oven.lastUpdatedAt = timestamp;
        const point = {
          timestamp,
          chamberTemp: bySensor.chamberTemp.value,
          humidity:    bySensor.humidity.value,
          furnaceTemp: bySensor.furnaceTemp.value,
          blowerTemp:  bySensor.blowerTemp.value,
        };
        companyState.history[envelope.ovenId] = [
          ...(companyState.history[envelope.ovenId] || []), point,
        ].slice(-10000);
        global.set("stcrState", rootState);
      }

      node.status({ fill: "green", shape: "dot", text: `saved oven ${envelope.ovenNumber}` });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    node.warn(`MQTT sensor DB write failed: ${err.message}`);
    node.status({ fill: "red", shape: "ring", text: `DB error oven ${envelope.ovenNumber}` });
  }
}

return null;
