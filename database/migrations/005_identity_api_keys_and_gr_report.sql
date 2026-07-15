USE stcr;

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

ALTER TABLE oven_cycles
  ADD COLUMN firewood_weight_kg DECIMAL(12,3) NULL AFTER output_weight_kg,
  ADD COLUMN smoking_period_status ENUM('under', 'over', 'notReached') NULL AFTER rubber_type,
  ADD COLUMN temperature_control_status ENUM('underControl', 'outOfControl') NULL AFTER smoking_period_status,
  ADD COLUMN report_reason VARCHAR(500) NULL AFTER temperature_control_status;

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
ON DUPLICATE KEY UPDATE
  document_no = IF(company_id = 'gr', VALUES(document_no), document_no),
  effective_date = IF(company_id = 'gr', VALUES(effective_date), effective_date),
  updated_by = IF(company_id = 'gr', VALUES(updated_by), updated_by);
