USE stcr;
SET time_zone = '+00:00';

-- A completed cycle can never end before it started.
UPDATE oven_cycles
SET stopped_at = fired_at
WHERE stopped_at IS NOT NULL
  AND stopped_at < fired_at;

-- Measurements received after a cycle stopped are idle diagnostics, not part
-- of the completed production cycle.
UPDATE sensor_minute_aggregates a
JOIN oven_cycles c ON c.id = a.cycle_id
SET a.cycle_id = NULL,
    a.cycle_phase = 'idle',
    a.included_in_report = FALSE,
    a.updated_at = UTC_TIMESTAMP(3)
WHERE c.state = 'completed'
  AND c.stopped_at IS NOT NULL
  AND a.minute_at > c.stopped_at;

-- Keep only the newest unresolved offline alarm for each oven. New alarms use
-- a stable company/oven id so repeated outages cannot create duplicates.
UPDATE alarms a
JOIN (
  SELECT company_id, oven_id, MAX(created_at) AS newest_created_at
  FROM alarms
  WHERE severity = 'offline'
    AND status IN ('active', 'acknowledged')
  GROUP BY company_id, oven_id
) newest
  ON newest.company_id = a.company_id
 AND newest.oven_id = a.oven_id
SET a.status = 'resolved',
    a.resolved_at = COALESCE(a.resolved_at, UTC_TIMESTAMP(3))
WHERE a.severity = 'offline'
  AND a.status IN ('active', 'acknowledged')
  AND a.created_at < newest.newest_created_at;
