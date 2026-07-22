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
  last_received_at
FROM sensor_minute_aggregates
ORDER BY minute_at DESC, company_id, oven_id
LIMIT 30;

SELECT
  company_id,
  oven_id,
  DATE_FORMAT(recorded_at, '%Y-%m-%d %H:%i:00') AS minute_at,
  COUNT(*) AS graph_rows_in_minute
FROM sensor_readings
GROUP BY company_id, oven_id, DATE_FORMAT(recorded_at, '%Y-%m-%d %H:%i:00')
HAVING COUNT(*) > 1
ORDER BY minute_at DESC;
