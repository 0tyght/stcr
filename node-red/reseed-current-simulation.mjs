import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const nodeRedRequire = createRequire(join(homedir(), ".node-red", "package.json"));
const mysql = nodeRedRequire("mysql2/promise");
const root = dirname(fileURLToPath(import.meta.url));
const modelSource = await readFile(join(root, "functions", "simulation-model.js"), "utf8");
const { simulationSensorValues } = new Function(
  `${modelSource}\nreturn { simulationSensorValues };`,
)();

const pool = mysql.createPool({
  host: process.env.STCR_DB_HOST || "127.0.0.1",
  port: Number(process.env.STCR_DB_PORT || 3306),
  user: process.env.STCR_DB_USER || "stcr_app",
  password: process.env.STCR_DB_PASSWORD || "",
  database: process.env.STCR_DB_NAME || "stcr",
  timezone: "Z",
  dateStrings: true,
});

const MAX_DEADLOCK_RETRIES = 6;

async function executeWithDeadlockRetry(sql, values) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await pool.query(sql, values);
    } catch (error) {
      const retryable = error.code === "ER_LOCK_DEADLOCK" || error.code === "ER_LOCK_WAIT_TIMEOUT";
      if (!retryable || attempt >= MAX_DEADLOCK_RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
    }
  }
}

try {
  const [rows] = await pool.query(
    `SELECT r.company_id, r.oven_id, r.cycle_id, r.recorded_at,
            r.cycle_phase, r.included_in_report, r.quality, r.source_timestamp,
            o.oven_number, c.state AS cycle_state,
            UNIX_TIMESTAMP(r.recorded_at) * 1000 AS recorded_ms,
            UNIX_TIMESTAMP(c.fired_at) * 1000 AS fired_ms
     FROM sensor_readings r
     JOIN oven_cycles c ON c.id=r.cycle_id
     JOIN ovens o ON o.company_id=r.company_id AND o.id=r.oven_id
     ORDER BY CASE c.state WHEN 'completed' THEN 0 ELSE 1 END, r.cycle_id, r.recorded_at`,
  );

  const rowsByCycle = Map.groupBy(rows, (row) => row.cycle_id);
  for (const cycleRows of rowsByCycle.values()) {
    for (let offset = 0; offset < cycleRows.length; offset += 300) {
      const chunk = cycleRows.slice(offset, offset + 300);
      const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
      const values = chunk.flatMap((row) => {
        const readings = simulationSensorValues(
          row.company_id,
          Number(row.oven_number),
          Number(row.recorded_ms),
          Number(row.fired_ms),
        );
        return [
          row.company_id, row.oven_id, row.cycle_id, row.recorded_at,
          readings.chamberTemp, readings.humidity, readings.furnaceTemp, readings.blowerTemp,
          row.cycle_phase, row.included_in_report, row.quality, row.source_timestamp,
        ];
      });
      await executeWithDeadlockRetry(
        `INSERT INTO sensor_readings (
          company_id, oven_id, cycle_id, recorded_at, chamber_temp, humidity,
          furnace_temp, blower_temp, cycle_phase, included_in_report, quality, source_timestamp
        ) VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE
          chamber_temp=VALUES(chamber_temp), humidity=VALUES(humidity),
          furnace_temp=VALUES(furnace_temp), blower_temp=VALUES(blower_temp)`,
        values,
      );
    }
  }

  const cycleStates = rows.reduce((counts, row) => {
    counts[row.cycle_state] = (counts[row.cycle_state] || 0) + 1;
    return counts;
  }, {});
  console.log(
    `Recalculated ${rows.length} simulation readings across all cycles: ${JSON.stringify(cycleStates)}.`,
  );
} finally {
  await pool.end();
}
