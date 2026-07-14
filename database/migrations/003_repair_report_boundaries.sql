USE stcr;
SET time_zone = '+00:00';

-- Repair data created by older simulator backfills. A point can be used by a
-- report only when it falls inside the cycle's official report window.
UPDATE sensor_readings AS reading
JOIN oven_cycles AS cycle ON cycle.id = reading.cycle_id
SET
  reading.included_in_report = FALSE,
  reading.cycle_phase = CASE
    WHEN reading.recorded_at < cycle.report_started_at THEN 'ignition'
    ELSE 'cooldown'
  END
WHERE
  reading.included_in_report = TRUE
  AND cycle.report_started_at IS NOT NULL
  AND (
    reading.recorded_at < cycle.report_started_at
    OR (cycle.stopped_at IS NOT NULL AND reading.recorded_at > cycle.stopped_at)
  );

