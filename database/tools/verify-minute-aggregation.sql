SELECT
  company_id,
  oven_id,
  minute_at,
  chamber_temp_avg,
  chamber_temp_min,
  chamber_temp_max,
  chamber_temp_last,
  chamber_temp_count,
  humidity_avg,
  humidity_count,
  furnace_temp_avg,
  furnace_temp_count,
  blower_temp_avg,
  blower_temp_count,
  source_kind,
  source_ref,
  last_received_at
FROM sensor_minute_aggregates
ORDER BY minute_at DESC, company_id, oven_id
LIMIT 30;

SELECT
  company_id,
  oven_id,
  minute_at,
  chamber_temp_count,
  humidity_count,
  furnace_temp_count,
  blower_temp_count
FROM sensor_minute_aggregates
WHERE chamber_temp_count = 0
   OR humidity_count = 0
   OR furnace_temp_count = 0
   OR blower_temp_count = 0
ORDER BY minute_at DESC;
