USE stcr;
SET time_zone = '+00:00';

-- Current business rule: an open oven starts its report immediately.
UPDATE oven_cycles
SET state = 'recording',
    report_started_at = COALESCE(report_started_at, fired_at),
    ready_hold_seconds = 0
WHERE state = 'ignition';

UPDATE sensor_minute_aggregates a
JOIN oven_cycles c ON c.id = a.cycle_id
SET a.cycle_phase = 'recording',
    a.included_in_report = TRUE
WHERE c.state = 'recording'
  AND c.report_started_at IS NOT NULL
  AND a.minute_at >= DATE_FORMAT(c.report_started_at, '%Y-%m-%d %H:%i:00');

UPDATE sensor_readings r
JOIN oven_cycles c ON c.id = r.cycle_id
SET r.cycle_phase = 'recording',
    r.included_in_report = TRUE
WHERE c.state = 'recording'
  AND c.report_started_at IS NOT NULL
  AND r.recorded_at >= DATE_FORMAT(c.report_started_at, '%Y-%m-%d %H:%i:00');
