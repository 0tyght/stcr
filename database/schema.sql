CREATE DATABASE IF NOT EXISTS stcr
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE stcr;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS companies (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  data_source_key VARCHAR(80) NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Bangkok',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id VARCHAR(32) NOT NULL,
  username VARCHAR(80) NOT NULL,
  display_name VARCHAR(160) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  password_algorithm ENUM('argon2id') NOT NULL DEFAULT 'argon2id',
  status ENUM('active', 'disabled', 'locked') NOT NULL DEFAULT 'active',
  failed_login_count INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME(3) NULL,
  last_login_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  KEY ix_users_company_status (company_id, status),
  CONSTRAINT fk_users_company FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS roles (
  id SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roles_code (code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id BIGINT UNSIGNED NOT NULL,
  role_id SMALLINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ovens (
  id VARCHAR(64) NOT NULL,
  company_id VARCHAR(32) NOT NULL,
  oven_number INT NOT NULL,
  name VARCHAR(160) NOT NULL,
  zone_name VARCHAR(120) NOT NULL,
  line_name VARCHAR(120) NOT NULL,
  status ENUM('open', 'closed', 'offline') NOT NULL DEFAULT 'closed',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  chamber_lower DECIMAL(8,2) NOT NULL,
  chamber_upper DECIMAL(8,2) NOT NULL,
  furnace_lower DECIMAL(8,2) NOT NULL,
  furnace_upper DECIMAL(8,2) NOT NULL,
  blower_lower DECIMAL(8,2) NOT NULL,
  blower_upper DECIMAL(8,2) NOT NULL,
  humidity_lower DECIMAL(8,2) NOT NULL,
  humidity_upper DECIMAL(8,2) NOT NULL,
  last_seen_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (company_id, id),
  UNIQUE KEY uq_ovens_company_number (company_id, oven_number),
  CONSTRAINT fk_ovens_company FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS api_keys (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id VARCHAR(32) NOT NULL,
  name VARCHAR(120) NOT NULL,
  key_prefix VARCHAR(16) NOT NULL,
  key_hash CHAR(64) NOT NULL,
  allowed_oven_id VARCHAR(64) NULL,
  status ENUM('active', 'revoked') NOT NULL DEFAULT 'active',
  expires_at DATETIME(3) NULL,
  last_used_at DATETIME(3) NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_api_keys_company_prefix (company_id, key_prefix),
  KEY ix_api_keys_lookup (company_id, status, key_prefix),
  CONSTRAINT fk_api_keys_company FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_api_keys_oven FOREIGN KEY (company_id, allowed_oven_id) REFERENCES ovens(company_id, id),
  CONSTRAINT fk_api_keys_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS oven_cycles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id VARCHAR(32) NOT NULL,
  oven_id VARCHAR(64) NOT NULL,
  cycle_number INT NOT NULL,
  state ENUM('ignition', 'recording', 'completed', 'cancelled') NOT NULL,
  fired_at DATETIME(3) NOT NULL,
  report_started_at DATETIME(3) NULL,
  stopped_at DATETIME(3) NULL,
  ready_temperature DECIMAL(8,2) NOT NULL,
  ready_hold_seconds INT NOT NULL DEFAULT 1800,
  input_weight_kg DECIMAL(12,3) NULL,
  output_weight_kg DECIMAL(12,3) NULL,
  firewood_weight_kg DECIMAL(12,3) NULL,
  rubber_type VARCHAR(160) NULL,
  smoking_period_status ENUM('under', 'over', 'notReached') NULL,
  temperature_control_status ENUM('underControl', 'outOfControl') NULL,
  report_reason VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_cycles_company_oven_number (company_id, oven_id, cycle_number),
  KEY ix_cycles_report_range (company_id, oven_id, report_started_at, stopped_at),
  CONSTRAINT fk_cycles_oven FOREIGN KEY (company_id, oven_id) REFERENCES ovens(company_id, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sensor_readings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id VARCHAR(32) NOT NULL,
  oven_id VARCHAR(64) NOT NULL,
  cycle_id BIGINT UNSIGNED NULL,
  recorded_at DATETIME(3) NOT NULL,
  chamber_temp DECIMAL(8,2) NOT NULL,
  humidity DECIMAL(8,2) NOT NULL,
  furnace_temp DECIMAL(8,2) NOT NULL,
  blower_temp DECIMAL(8,2) NOT NULL,
  cycle_phase ENUM('ignition', 'recording', 'cooldown', 'idle') NOT NULL,
  included_in_report BOOLEAN NOT NULL DEFAULT FALSE,
  quality ENUM('good', 'suspect', 'missing', 'manual') NOT NULL DEFAULT 'good',
  source_timestamp DATETIME(3) NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_readings_source_point (company_id, oven_id, recorded_at),
  KEY ix_readings_report (company_id, oven_id, cycle_id, included_in_report, recorded_at),
  KEY ix_readings_received (received_at),
  CONSTRAINT fk_readings_oven FOREIGN KEY (company_id, oven_id) REFERENCES ovens(company_id, id),
  CONSTRAINT fk_readings_cycle FOREIGN KEY (cycle_id) REFERENCES oven_cycles(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS telemetry_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id VARCHAR(32) NOT NULL,
  oven_id VARCHAR(64) NOT NULL,
  batch_id VARCHAR(96) NOT NULL,
  topic VARCHAR(255) NOT NULL,
  device_id VARCHAR(128) NOT NULL,
  sensor_id VARCHAR(160) NOT NULL,
  sensor_key VARCHAR(40) NOT NULL,
  sequence_number BIGINT UNSIGNED NOT NULL,
  numeric_value DECIMAL(12,3) NOT NULL,
  unit_symbol VARCHAR(16) NOT NULL,
  quality ENUM('good', 'suspect', 'missing', 'manual') NOT NULL,
  quality_reasons JSON NULL,
  source_timestamp DATETIME(3) NOT NULL,
  gateway_timestamp DATETIME(3) NOT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_telemetry_sensor_sequence (company_id, sensor_id, sequence_number),
  KEY ix_telemetry_batch (batch_id),
  KEY ix_telemetry_oven_time (company_id, oven_id, source_timestamp),
  CONSTRAINT fk_telemetry_oven FOREIGN KEY (company_id, oven_id) REFERENCES ovens(company_id, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS factory_mqtt_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id VARCHAR(32) NOT NULL,
  oven_id VARCHAR(64) NOT NULL,
  oven_number INT NOT NULL,
  cycle_number INT NOT NULL,
  topic VARCHAR(128) NOT NULL,
  qos TINYINT UNSIGNED NOT NULL,
  retained BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_delivery BOOLEAN NOT NULL DEFAULT FALSE,
  source_timestamp DATETIME(3) NOT NULL,
  payload_json JSON NOT NULL,
  message_hash CHAR(64) NOT NULL,
  normalization_status ENUM('received', 'normalized', 'pending', 'rejected') NOT NULL DEFAULT 'received',
  normalization_detail VARCHAR(255) NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_factory_mqtt_message_hash (message_hash),
  KEY ix_factory_mqtt_company_oven_time (company_id, oven_id, source_timestamp),
  KEY ix_factory_mqtt_topic_time (topic, source_timestamp),
  CONSTRAINT fk_factory_mqtt_company FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT fk_factory_mqtt_oven FOREIGN KEY (company_id, oven_id) REFERENCES ovens(company_id, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS alarms (
  id VARCHAR(96) PRIMARY KEY,
  company_id VARCHAR(32) NOT NULL,
  oven_id VARCHAR(64) NOT NULL,
  cycle_id BIGINT UNSIGNED NULL,
  sensor_key VARCHAR(40) NULL,
  severity ENUM('warning', 'danger', 'offline') NOT NULL,
  status ENUM('active', 'acknowledged', 'resolved') NOT NULL,
  title VARCHAR(255) NOT NULL,
  detail TEXT NOT NULL,
  measured_value DECIMAL(10,2) NULL,
  limit_value DECIMAL(10,2) NULL,
  created_at DATETIME(3) NOT NULL,
  acknowledged_at DATETIME(3) NULL,
  resolved_at DATETIME(3) NULL,
  KEY ix_alarms_filter (company_id, status, severity, created_at),
  CONSTRAINT fk_alarms_oven FOREIGN KEY (company_id, oven_id) REFERENCES ovens(company_id, id),
  CONSTRAINT fk_alarms_cycle FOREIGN KEY (cycle_id) REFERENCES oven_cycles(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id VARCHAR(32) NOT NULL,
  actor VARCHAR(160) NOT NULL,
  action_name VARCHAR(160) NOT NULL,
  target_type VARCHAR(80) NOT NULL,
  target_id VARCHAR(96) NOT NULL,
  detail JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_audit_company_time (company_id, created_at),
  CONSTRAINT fk_audit_company FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  token CHAR(64) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  company_id VARCHAR(32) NOT NULL,
  username VARCHAR(80) NOT NULL,
  roles JSON NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (token),
  KEY ix_sessions_user (user_id),
  KEY ix_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS report_document_settings (
  company_id VARCHAR(32) NOT NULL,
  document_no VARCHAR(80) NOT NULL,
  effective_date VARCHAR(40) NOT NULL,
  updated_by VARCHAR(160) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (company_id),
  CONSTRAINT fk_report_document_company FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB;

INSERT INTO companies (id, name, data_source_key)
VALUES
  ('gr', 'Grand Rubber', 'gr-node-red'),
  ('ttn', 'TTN Rubber', 'ttn-node-red')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  data_source_key = VALUES(data_source_key);

INSERT INTO roles (code, name)
VALUES
  ('admin', 'ผู้ดูแลระบบ'),
  ('operator', 'พนักงานควบคุมเตา'),
  ('viewer', 'ผู้ดูรายงาน')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO report_document_settings (
  company_id, document_no, effective_date, updated_by
)
VALUES
  ('gr', 'F01-05-05 R07', '22/06/67', 'system'),
  ('ttn', 'F-WS-05 Rev.11', '1-ธ.ค.-68', 'system')
ON DUPLICATE KEY UPDATE company_id = VALUES(company_id);

-- Seed: TTN ovens 1-9 (oven_number maps 1:1 to oven-N, all offline on fresh install)
INSERT INTO ovens (
  id, company_id, oven_number, name, zone_name, line_name,
  status, enabled,
  chamber_lower, chamber_upper,
  furnace_lower, furnace_upper,
  blower_lower,  blower_upper,
  humidity_lower, humidity_upper
) VALUES
  ('oven-1', 'ttn', 1, 'เตา 1', 'TTN', 'Smoking Line A', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-2', 'ttn', 2, 'เตา 2', 'TTN', 'Smoking Line A', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-3', 'ttn', 3, 'เตา 3', 'TTN', 'Smoking Line A', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-4', 'ttn', 4, 'เตา 4', 'TTN', 'Smoking Line A', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-5', 'ttn', 5, 'เตา 5', 'TTN', 'Smoking Line A', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-6', 'ttn', 6, 'เตา 6', 'TTN', 'Smoking Line B', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-7', 'ttn', 7, 'เตา 7', 'TTN', 'Smoking Line B', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-8', 'ttn', 8, 'เตา 8', 'TTN', 'Smoking Line B', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00),
  ('oven-9', 'ttn', 9, 'เตา 9', 'TTN', 'Smoking Line B', 'offline', TRUE, 35.00, 60.00, 450.00, 550.00, 330.00, 400.00, 45.00, 85.00)
ON DUPLICATE KEY UPDATE
  name           = VALUES(name),
  zone_name      = VALUES(zone_name),
  line_name      = VALUES(line_name),
  chamber_lower  = VALUES(chamber_lower),
  chamber_upper  = VALUES(chamber_upper),
  furnace_lower  = VALUES(furnace_lower),
  furnace_upper  = VALUES(furnace_upper),
  blower_lower   = VALUES(blower_lower),
  blower_upper   = VALUES(blower_upper),
  humidity_lower = VALUES(humidity_lower),
  humidity_upper = VALUES(humidity_upper);
