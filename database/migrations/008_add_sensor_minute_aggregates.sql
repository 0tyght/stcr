USE stcr;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS sensor_minute_aggregates (
  company_id VARCHAR(32) NOT NULL,
  oven_id VARCHAR(64) NOT NULL,
  cycle_id BIGINT UNSIGNED NULL,
  cycle_number INT NOT NULL,
  minute_at DATETIME(0) NOT NULL,

  chamber_temp_avg DECIMAL(10,3) NULL,
  chamber_temp_min DECIMAL(10,3) NULL,
  chamber_temp_max DECIMAL(10,3) NULL,
  chamber_temp_last DECIMAL(10,3) NULL,
  chamber_temp_count INT UNSIGNED NOT NULL DEFAULT 0,

  humidity_avg DECIMAL(10,3) NULL,
  humidity_min DECIMAL(10,3) NULL,
  humidity_max DECIMAL(10,3) NULL,
  humidity_last DECIMAL(10,3) NULL,
  humidity_count INT UNSIGNED NOT NULL DEFAULT 0,

  furnace_temp_avg DECIMAL(10,3) NULL,
  furnace_temp_min DECIMAL(10,3) NULL,
  furnace_temp_max DECIMAL(10,3) NULL,
  furnace_temp_last DECIMAL(10,3) NULL,
  furnace_temp_count INT UNSIGNED NOT NULL DEFAULT 0,

  blower_temp_avg DECIMAL(10,3) NULL,
  blower_temp_min DECIMAL(10,3) NULL,
  blower_temp_max DECIMAL(10,3) NULL,
  blower_temp_last DECIMAL(10,3) NULL,
  blower_temp_count INT UNSIGNED NOT NULL DEFAULT 0,

  cycle_phase ENUM('ignition', 'recording', 'cooldown', 'idle') NOT NULL,
  included_in_report BOOLEAN NOT NULL DEFAULT FALSE,
  quality ENUM('good', 'suspect', 'missing', 'manual') NOT NULL DEFAULT 'good',
  first_source_at DATETIME(3) NOT NULL,
  last_source_at DATETIME(3) NOT NULL,
  first_received_at DATETIME(3) NOT NULL,
  last_received_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (company_id, oven_id, minute_at),
  KEY ix_minute_aggregate_cycle (company_id, oven_id, cycle_id, minute_at),
  KEY ix_minute_aggregate_received (last_received_at),
  CONSTRAINT fk_minute_aggregate_oven
    FOREIGN KEY (company_id, oven_id)
    REFERENCES ovens(company_id, id),
  CONSTRAINT fk_minute_aggregate_cycle
    FOREIGN KEY (cycle_id)
    REFERENCES oven_cycles(id)
) ENGINE=InnoDB;
