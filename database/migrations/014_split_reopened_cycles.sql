USE stcr;
SET time_zone = '+00:00';

-- The PLC cycle counter is useful diagnostic input, but it is not a safe
-- database identity: a kiln can close and reopen while that counter remains
-- unchanged. Keep the source value separately and let cycle_number identify
-- each real open period inside STCR.
ALTER TABLE oven_cycles
  ADD COLUMN source_cycle_number INT NULL AFTER cycle_number,
  ADD KEY ix_cycles_source_number (
    company_id,
    oven_id,
    source_cycle_number,
    fired_at
  );

UPDATE oven_cycles
SET source_cycle_number = cycle_number
WHERE source_cycle_number IS NULL;
