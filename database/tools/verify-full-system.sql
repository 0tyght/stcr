-- STCR full-system audit verification
-- ใช้หลังเปิด Node-RED/API และทดสอบเพิ่ม/แก้ไข/ลบเตาแล้ว

SELECT 'duplicate_oven_numbers' AS check_name,
       company_id,
       oven_number,
       COUNT(*) AS duplicate_count
FROM ovens
GROUP BY company_id, oven_number
HAVING COUNT(*) > 1;

SELECT 'invalid_chamber_limits' AS check_name,
       company_id,
       id AS oven_id,
       oven_number,
       chamber_lower,
       chamber_upper
FROM ovens
WHERE chamber_lower IS NULL
   OR chamber_upper IS NULL
   OR chamber_lower >= chamber_upper;

SELECT 'invalid_furnace_limits' AS check_name,
       company_id,
       id AS oven_id,
       oven_number,
       furnace_lower,
       furnace_upper
FROM ovens
WHERE furnace_lower IS NULL
   OR furnace_upper IS NULL
   OR furnace_lower >= furnace_upper
   OR furnace_lower < 0
   OR furnace_upper > 1000;

SELECT 'orphan_cycles' AS check_name, COUNT(*) AS orphan_count
FROM oven_cycles c
LEFT JOIN ovens o
  ON o.company_id = c.company_id
 AND o.id = c.oven_id
WHERE o.id IS NULL;

SELECT 'orphan_minute_aggregates' AS check_name, COUNT(*) AS orphan_count
FROM sensor_minute_aggregates a
LEFT JOIN ovens o
  ON o.company_id = a.company_id
 AND o.id = a.oven_id
WHERE o.id IS NULL;

SELECT 'orphan_alarms' AS check_name, COUNT(*) AS orphan_count
FROM alarms a
LEFT JOIN ovens o
  ON o.company_id = a.company_id
 AND o.id = a.oven_id
WHERE o.id IS NULL;

SELECT
  o.company_id,
  o.id AS oven_id,
  o.oven_number,
  o.name,
  o.status,
  (SELECT COUNT(*) FROM oven_cycles c
    WHERE c.company_id = o.company_id AND c.oven_id = o.id) AS cycle_count,
  (SELECT COUNT(*) FROM sensor_minute_aggregates a
    WHERE a.company_id = o.company_id AND a.oven_id = o.id) AS minute_row_count,
  (SELECT COUNT(*) FROM sensor_readings r
    WHERE r.company_id = o.company_id AND r.oven_id = o.id) AS reading_count,
  (SELECT COUNT(*) FROM telemetry_events t
    WHERE t.company_id = o.company_id AND t.oven_id = o.id) AS telemetry_count,
  (SELECT COUNT(*) FROM alarms a
    WHERE a.company_id = o.company_id AND a.oven_id = o.id) AS alarm_count,
  (SELECT COUNT(*) FROM api_keys k
    WHERE k.company_id = o.company_id AND k.allowed_oven_id = o.id) AS api_key_count,
  CASE
    WHEN o.status = 'open' THEN 'BLOCKED_OPEN'
    WHEN
      (SELECT COUNT(*) FROM oven_cycles c
       WHERE c.company_id = o.company_id AND c.oven_id = o.id) = 0
      AND
      (SELECT COUNT(*) FROM sensor_minute_aggregates a
       WHERE a.company_id = o.company_id AND a.oven_id = o.id) = 0
      AND
      (SELECT COUNT(*) FROM sensor_readings r
       WHERE r.company_id = o.company_id AND r.oven_id = o.id) = 0
      AND
      (SELECT COUNT(*) FROM telemetry_events t
       WHERE t.company_id = o.company_id AND t.oven_id = o.id) = 0
      AND
      (SELECT COUNT(*) FROM factory_mqtt_messages m
       WHERE m.company_id = o.company_id AND m.oven_id = o.id) = 0
      AND
      (SELECT COUNT(*) FROM alarms a
       WHERE a.company_id = o.company_id AND a.oven_id = o.id) = 0
      AND
      (SELECT COUNT(*) FROM api_keys k
       WHERE k.company_id = o.company_id AND k.allowed_oven_id = o.id) = 0
    THEN 'DELETE_ALLOWED'
    ELSE 'DELETE_BLOCKED_HAS_DATA'
  END AS delete_status
FROM ovens o
ORDER BY o.company_id, o.oven_number;
