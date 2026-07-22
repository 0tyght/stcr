USE stcr;

SET time_zone = '+00:00';

SELECT
  company_id,
  oven_number,
  status,
  last_seen_at,
  TIMESTAMPDIFF(
    SECOND,
    last_seen_at,
    UTC_TIMESTAMP(3)
  ) AS seconds_since_last_seen
FROM ovens
ORDER BY company_id, oven_number;

SELECT
  company_id,
  oven_id,
  minute_at,
  chamber_temp_avg,
  chamber_temp_count,
  humidity_avg,
  humidity_count,
  furnace_temp_avg,
  furnace_temp_count,
  blower_temp_avg,
  blower_temp_count
FROM sensor_minute_aggregates
ORDER BY minute_at DESC, oven_id
LIMIT 50;

SELECT
  company_id,
  oven_id,
  minute_at,
  COUNT(*) AS duplicate_rows
FROM sensor_minute_aggregates
GROUP BY company_id, oven_id, minute_at
HAVING COUNT(*) > 1;