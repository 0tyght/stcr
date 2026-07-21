USE stcr;

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
