// factory-mqtt-db-writer.js
// Receive msg._mqttEnvelope from the MQTT adapter and write to MySQL.

const envelope = msg._mqttEnvelope;

if (!envelope) {
  return null;
}

function getPool() {
  let pool = global.get("stcrMqttDbPool");

  if (pool) {
    return pool;
  }

  const password = String(
    env.get("STCR_DB_PASSWORD") || "",
  );

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

async function saveFactoryMessage(
  executor,
  value,
  messageHash,
  normalizationStatus,
  normalizationDetail,
  receivedAtDate,
) {
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
      messageHash,
      normalizationStatus,
      normalizationDetail,
      receivedAtDate,
    ],
  );
}

function findMemoryOven(value) {
  const rootState = global.get("stcrState");
  const companyState =
    rootState?.companies?.[value.companyId];
  const oven = companyState?.ovens?.find(
    (item) => item.id === value.ovenId,
  );

  return {
    rootState,
    companyState,
    oven,
  };
}

function fallbackStatus(startOven) {
  return startOven === 1 ? "open" : "closed";
}

const messageHash = makeMessageHash(envelope);
const receivedAtDate = envelope.receivedAt
  ? new Date(envelope.receivedAt)
  : new Date();

if (!Number.isFinite(receivedAtDate.getTime())) {
  receivedAtDate.setTime(Date.now());
}

// Topic test: update the authoritative oven state.
if (envelope.type === "test") {
  try {
    const pool = getPool();
    const status =
      envelope.ovenState === 1 ? "open" : "closed";

    const [updateResult] = await pool.execute(
      `UPDATE ovens
       SET
         status = ?,
         last_seen_at = ?
       WHERE company_id = ?
         AND id = ?
         AND enabled = TRUE`,
      [
        status,
        receivedAtDate,
        envelope.companyId,
        envelope.ovenId,
      ],
    );

    if (!updateResult.affectedRows) {
      node.warn(
        `MQTT test: oven ${envelope.companyId}/${envelope.ovenId} not found`,
      );
      return null;
    }

    await saveFactoryMessage(
      pool,
      envelope,
      messageHash,
      "normalized",
      `oven_state=${envelope.ovenState}`,
      receivedAtDate,
    );

    const {
      rootState,
      oven,
    } = findMemoryOven(envelope);

    if (oven) {
      oven.status = status;
      oven.lastUpdatedAt =
        receivedAtDate.toISOString();
      global.set("stcrState", rootState);
    }

    node.status({
      fill: "green",
      shape: "dot",
      text: `status saved oven ${envelope.ovenNumber}`,
    });
  } catch (error) {
    node.warn(
      `MQTT test DB write failed: ${error.message}`,
    );
    node.status({
      fill: "red",
      shape: "ring",
      text: `DB error oven ${envelope.ovenNumber}`,
    });
  }

  return null;
}

// Incomplete sensor message:
// keep the raw message and mark the oven as connected.
// startoven is only a fallback while the DB status is offline.
if (envelope.type === "pending") {
  try {
    const pool = getPool();
    const status = fallbackStatus(envelope.startOven);

    const [updateResult] = await pool.execute(
      `UPDATE ovens
       SET
         last_seen_at = ?,
         status = CASE
           WHEN status = 'offline' THEN ?
           ELSE status
         END
       WHERE company_id = ?
         AND id = ?
         AND enabled = TRUE`,
      [
        receivedAtDate,
        status,
        envelope.companyId,
        envelope.ovenId,
      ],
    );

    if (!updateResult.affectedRows) {
      node.warn(
        `MQTT pending: oven ${envelope.companyId}/${envelope.ovenId} not found`,
      );
      return null;
    }

    await saveFactoryMessage(
      pool,
      envelope,
      messageHash,
      "pending",
      `missing: ${(envelope.missingSensors || []).join(", ")}`,
      receivedAtDate,
    );

    const {
      rootState,
      oven,
    } = findMemoryOven(envelope);

    if (oven) {
      if (oven.status === "offline") {
        oven.status = status;
      }

      oven.lastUpdatedAt =
        receivedAtDate.toISOString();
      global.set("stcrState", rootState);
    }

    node.status({
      fill: "yellow",
      shape: "dot",
      text: `partial data oven ${envelope.ovenNumber}`,
    });
  } catch (error) {
    node.warn(
      `MQTT pending DB write failed: ${error.message}`,
    );
    node.status({
      fill: "red",
      shape: "ring",
      text: `DB error oven ${envelope.ovenNumber}`,
    });
  }

  return null;
}

// Complete sensor message.
if (envelope.type === "sensor") {
  const recordedAt =
    new Date(envelope.sourceTimestamp);
  const bySensor = Object.fromEntries(
    envelope.readings.map((reading) => [
      reading.sensorKey,
      reading,
    ]),
  );

  try {
    const pool = getPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [ovenRows] = await connection.execute(
        `SELECT id, status
         FROM ovens
         WHERE company_id = ?
           AND id = ?
           AND enabled = TRUE
         LIMIT 1`,
        [
          envelope.companyId,
          envelope.ovenId,
        ],
      );

      if (!ovenRows[0]) {
        await connection.rollback();
        node.warn(
          `MQTT sensor: oven ${envelope.companyId}/${envelope.ovenId} not found`,
        );
        return null;
      }

      await saveFactoryMessage(
        connection,
        envelope,
        messageHash,
        "normalized",
        "All four sensors normalized",
        receivedAtDate,
      );

      const [cycleRows] = await connection.execute(
        `SELECT id, state
         FROM oven_cycles
         WHERE company_id = ?
           AND oven_id = ?
           AND cycle_number = ?
         LIMIT 1`,
        [
          envelope.companyId,
          envelope.ovenId,
          envelope.cycleNumber,
        ],
      );

      const cycle = cycleRows[0] || null;

      const cyclePhase =
        cycle?.state === "recording"
          ? "recording"
          : cycle?.state === "ignition"
            ? "ignition"
            : cycle?.state === "completed"
              ? "cooldown"
              : "idle";

      const includedInReport =
        cyclePhase === "recording";

      for (const reading of envelope.readings) {
        await connection.execute(
          `INSERT INTO telemetry_events (
             company_id,
             oven_id,
             batch_id,
             topic,
             device_id,
             sensor_id,
             sensor_key,
             sequence_number,
             numeric_value,
             unit_symbol,
             quality,
             quality_reasons,
             source_timestamp,
             gateway_timestamp,
             received_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             numeric_value = VALUES(numeric_value),
             quality = VALUES(quality),
             quality_reasons = VALUES(quality_reasons),
             gateway_timestamp = VALUES(gateway_timestamp),
             received_at = VALUES(received_at)`,
          [
            envelope.companyId,
            envelope.ovenId,
            envelope.batchId,
            `stcr/${envelope.companyId}/${envelope.ovenId}/telemetry/${reading.sensorKey}`,
            envelope.deviceId,
            reading.sensorId,
            reading.sensorKey,
            reading.sequence,
            reading.rawValue,
            reading.unit,
            reading.quality,
            JSON.stringify(reading.qualityReasons),
            reading.sourceTimestamp,
            receivedAtDate,
            receivedAtDate,
          ],
        );
      }

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
          envelope.companyId,
          envelope.ovenId,
          cycle?.id || null,
          recordedAt,
          bySensor.chamberTemp.value,
          bySensor.humidity.value,
          bySensor.furnaceTemp.value,
          bySensor.blowerTemp.value,
          cyclePhase,
          includedInReport,
          envelope.quality,
          recordedAt,
          receivedAtDate,
        ],
      );

      const fallback =
        fallbackStatus(envelope.startOven);

      await connection.execute(
        `UPDATE ovens
         SET
           last_seen_at = ?,
           status = CASE
             WHEN status = 'offline' THEN ?
             ELSE status
           END
         WHERE company_id = ?
           AND id = ?
           AND enabled = TRUE`,
        [
          receivedAtDate,
          fallback,
          envelope.companyId,
          envelope.ovenId,
        ],
      );

      await connection.commit();

      const {
        rootState,
        companyState,
        oven,
      } = findMemoryOven(envelope);

      if (oven) {
        const timestamp =
          recordedAt.toISOString();

        for (const reading of envelope.readings) {
          oven.readings[reading.sensorKey] = {
            ...oven.readings[reading.sensorKey],
            value: reading.value,
            updatedAt: timestamp,
          };
        }

        if (oven.status === "offline") {
          oven.status = fallback;
        }

        oven.lastUpdatedAt =
          receivedAtDate.toISOString();

        const point = {
          timestamp,
          chamberTemp:
            bySensor.chamberTemp.value,
          humidity:
            bySensor.humidity.value,
          furnaceTemp:
            bySensor.furnaceTemp.value,
          blowerTemp:
            bySensor.blowerTemp.value,
        };

        companyState.history[envelope.ovenId] = [
          ...(companyState.history[envelope.ovenId] || []),
          point,
        ].slice(-10000);

        global.set("stcrState", rootState);
      }

      node.status({
        fill: "green",
        shape: "dot",
        text: `saved oven ${envelope.ovenNumber}`,
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    node.warn(
      `MQTT sensor DB write failed: ${error.message}`,
    );
    node.status({
      fill: "red",
      shape: "ring",
      text: `DB error oven ${envelope.ovenNumber}`,
    });
  }

  return null;
}

node.warn(
  `Unknown MQTT envelope type: ${String(envelope.type)}`,
);

return null;
