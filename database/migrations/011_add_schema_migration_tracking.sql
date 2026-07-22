USE stcr;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_name VARCHAR(160) NOT NULL,
  checksum_sha256 CHAR(64) NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (migration_name)
) ENGINE=InnoDB;
