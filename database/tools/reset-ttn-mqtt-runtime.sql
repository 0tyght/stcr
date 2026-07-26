-- OPTIONAL: Reset only TTN MQTT runtime test data.
-- This preserves users, roles, companies, report settings, and oven definitions.
-- Run only if you want all newly received timestamps to start clean in UTC.

START TRANSACTION;

DELETE FROM sensor_minute_aggregates
WHERE company_id = 'ttn';

DELETE FROM factory_mqtt_messages
WHERE company_id = 'ttn';

UPDATE ovens
SET
  status = 'offline',
  last_seen_at = NULL
WHERE company_id = 'ttn';

COMMIT;
