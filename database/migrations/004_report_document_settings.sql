USE stcr;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS report_document_settings (
  company_id VARCHAR(32) NOT NULL,
  document_no VARCHAR(80) NOT NULL,
  effective_date VARCHAR(40) NOT NULL,
  updated_by VARCHAR(160) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (company_id),
  CONSTRAINT fk_report_document_company FOREIGN KEY (company_id) REFERENCES companies(id)
) ENGINE=InnoDB;

