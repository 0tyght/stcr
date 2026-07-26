-- Keep one canonical history table for the STCR application.
-- Existing duplicate tables are preserved as detached legacy archives so a
-- separate migration team can map or remove them without changing runtime data.

SET @has_source_kind = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'sensor_minute_aggregates'
    AND column_name = 'source_kind'
);
SET @sql = IF(
  @has_source_kind = 0,
  'ALTER TABLE sensor_minute_aggregates ADD COLUMN source_kind ENUM(''mqtt'', ''http'', ''import'', ''manual'') NOT NULL DEFAULT ''mqtt'' AFTER quality',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_source_ref = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'sensor_minute_aggregates'
    AND column_name = 'source_ref'
);
SET @sql = IF(
  @has_source_ref = 0,
  'ALTER TABLE sensor_minute_aggregates ADD COLUMN source_ref VARCHAR(160) NULL AFTER source_kind',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_source_index = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'sensor_minute_aggregates'
    AND index_name = 'ix_minute_aggregate_source'
);
SET @sql = IF(
  @has_source_index = 0,
  'ALTER TABLE sensor_minute_aggregates ADD KEY ix_minute_aggregate_source (source_kind, source_ref)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_legacy_sensor_readings = (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name = 'legacy_sensor_readings'
);
SET @has_sensor_readings = (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name = 'sensor_readings'
);
SET @sql = IF(
  @has_sensor_readings = 1 AND @has_legacy_sensor_readings = 0,
  'RENAME TABLE sensor_readings TO legacy_sensor_readings',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_legacy_telemetry_events = (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name = 'legacy_telemetry_events'
);
SET @has_telemetry_events = (
  SELECT COUNT(*)
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name = 'telemetry_events'
);
SET @sql = IF(
  @has_telemetry_events = 1 AND @has_legacy_telemetry_events = 0,
  'RENAME TABLE telemetry_events TO legacy_telemetry_events',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Legacy archives must not own the lifecycle of current ovens or cycles.
SET @has_fk = (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'legacy_sensor_readings'
    AND constraint_name = 'fk_readings_oven'
    AND constraint_type = 'FOREIGN KEY'
);
SET @sql = IF(
  @has_fk = 1,
  'ALTER TABLE legacy_sensor_readings DROP FOREIGN KEY fk_readings_oven',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_fk = (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'legacy_sensor_readings'
    AND constraint_name = 'fk_readings_cycle'
    AND constraint_type = 'FOREIGN KEY'
);
SET @sql = IF(
  @has_fk = 1,
  'ALTER TABLE legacy_sensor_readings DROP FOREIGN KEY fk_readings_cycle',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_fk = (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = DATABASE()
    AND table_name = 'legacy_telemetry_events'
    AND constraint_name = 'fk_telemetry_oven'
    AND constraint_type = 'FOREIGN KEY'
);
SET @sql = IF(
  @has_fk = 1,
  'ALTER TABLE legacy_telemetry_events DROP FOREIGN KEY fk_telemetry_oven',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_retention_index = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'factory_mqtt_messages'
    AND index_name = 'ix_factory_mqtt_retention'
);
SET @sql = IF(
  @has_retention_index = 0,
  'ALTER TABLE factory_mqtt_messages ADD KEY ix_factory_mqtt_retention (normalization_status, received_at)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
