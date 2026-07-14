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
  rubber_type VARCHAR(160) NULL,
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
