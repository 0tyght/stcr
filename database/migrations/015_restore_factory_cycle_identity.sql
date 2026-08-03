USE stcr;
SET time_zone = '+00:00';

-- The production round number is owned by the factory PLC. Earlier runtime
-- logic created synthetic numbers when startoven changed from 0 back to 1
-- while the PLC counter stayed unchanged. Preserve those rows for audit, but
-- move their data back to the official factory cycle and hide them as
-- cancelled so no sensor history is deleted.
CREATE TEMPORARY TABLE stcr_cycle_merge_map (
  synthetic_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  target_id BIGINT UNSIGNED NOT NULL,
  official_cycle_number INT NOT NULL
) ENGINE=InnoDB;

START TRANSACTION;

INSERT INTO stcr_cycle_merge_map (
  synthetic_id,
  target_id,
  official_cycle_number
)
SELECT
  synthetic.id,
  official.id,
  synthetic.source_cycle_number
FROM oven_cycles AS synthetic
JOIN oven_cycles AS official
  ON official.company_id = synthetic.company_id
 AND official.oven_id = synthetic.oven_id
 AND official.cycle_number = synthetic.source_cycle_number
WHERE synthetic.source_cycle_number IS NOT NULL
  AND synthetic.cycle_number <> synthetic.source_cycle_number;

CREATE TEMPORARY TABLE stcr_cycle_merge_members (
  member_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  target_id BIGINT UNSIGNED NOT NULL
) ENGINE=InnoDB;

INSERT INTO stcr_cycle_merge_members (member_id, target_id)
SELECT synthetic_id, target_id
FROM stcr_cycle_merge_map;

INSERT IGNORE INTO stcr_cycle_merge_members (member_id, target_id)
SELECT target_id, target_id
FROM stcr_cycle_merge_map;

CREATE TEMPORARY TABLE stcr_cycle_merge_summary AS
SELECT
  members.target_id,
  MIN(cycle.fired_at) AS fired_at,
  MIN(cycle.report_started_at) AS report_started_at,
  CASE
    WHEN SUM(cycle.state IN ('ignition', 'recording')) > 0 THEN 'recording'
    WHEN SUM(cycle.state = 'completed') > 0 THEN 'completed'
    ELSE 'cancelled'
  END AS state,
  CASE
    WHEN SUM(cycle.state IN ('ignition', 'recording')) > 0 THEN NULL
    ELSE MAX(cycle.stopped_at)
  END AS stopped_at,
  MAX(cycle.input_weight_kg) AS input_weight_kg,
  MAX(cycle.output_weight_kg) AS output_weight_kg,
  MAX(cycle.firewood_weight_kg) AS firewood_weight_kg,
  MAX(cycle.rubber_type) AS rubber_type,
  MAX(cycle.smoking_period_status) AS smoking_period_status,
  MAX(cycle.temperature_control_status) AS temperature_control_status,
  MAX(cycle.report_reason) AS report_reason
FROM stcr_cycle_merge_members AS members
JOIN oven_cycles AS cycle ON cycle.id = members.member_id
GROUP BY members.target_id;

UPDATE sensor_minute_aggregates AS minute
JOIN stcr_cycle_merge_map AS merge_map
  ON merge_map.synthetic_id = minute.cycle_id
SET minute.cycle_id = merge_map.target_id,
    minute.cycle_number = merge_map.official_cycle_number;

UPDATE alarms AS alarm
JOIN stcr_cycle_merge_map AS merge_map
  ON merge_map.synthetic_id = alarm.cycle_id
SET alarm.cycle_id = merge_map.target_id;

UPDATE oven_cycles AS synthetic
JOIN stcr_cycle_merge_map AS merge_map
  ON merge_map.synthetic_id = synthetic.id
SET synthetic.state = 'cancelled',
    synthetic.stopped_at = COALESCE(synthetic.stopped_at, UTC_TIMESTAMP(3));

UPDATE oven_cycles AS official
JOIN stcr_cycle_merge_summary AS summary
  ON summary.target_id = official.id
SET official.source_cycle_number = official.cycle_number,
    official.state = summary.state,
    official.fired_at = summary.fired_at,
    official.report_started_at = summary.report_started_at,
    official.stopped_at = summary.stopped_at,
    official.input_weight_kg = COALESCE(
      official.input_weight_kg,
      summary.input_weight_kg
    ),
    official.output_weight_kg = COALESCE(
      official.output_weight_kg,
      summary.output_weight_kg
    ),
    official.firewood_weight_kg = COALESCE(
      official.firewood_weight_kg,
      summary.firewood_weight_kg
    ),
    official.rubber_type = COALESCE(
      official.rubber_type,
      summary.rubber_type
    ),
    official.smoking_period_status = COALESCE(
      official.smoking_period_status,
      summary.smoking_period_status
    ),
    official.temperature_control_status = COALESCE(
      official.temperature_control_status,
      summary.temperature_control_status
    ),
    official.report_reason = COALESCE(
      official.report_reason,
      summary.report_reason
    );

UPDATE oven_cycles
SET source_cycle_number = cycle_number
WHERE source_cycle_number IS NULL;

COMMIT;

DROP TEMPORARY TABLE stcr_cycle_merge_summary;
DROP TEMPORARY TABLE stcr_cycle_merge_members;
DROP TEMPORARY TABLE stcr_cycle_merge_map;
