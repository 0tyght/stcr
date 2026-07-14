USE stcr;
SET time_zone = '+00:00';

UPDATE telemetry_events
SET received_at = gateway_timestamp
WHERE ABS(TIMESTAMPDIFF(SECOND, gateway_timestamp, received_at)) > 3600;

UPDATE sensor_readings
SET received_at = source_timestamp
WHERE source_timestamp IS NOT NULL
  AND ABS(TIMESTAMPDIFF(SECOND, source_timestamp, received_at)) > 3600;
