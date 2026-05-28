-- Migration 018: Split name into firstname + lastname.
-- Keep the old name column for backwards compatibility with views/reports.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS firstname VARCHAR(100);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS lastname  VARCHAR(100);

-- Backfill: split existing name at the first space.
UPDATE clients
   SET firstname = SPLIT_PART(name, ' ', 1),
       lastname  = NULLIF(TRIM(SUBSTRING(name FROM POSITION(' ' IN name) + 1)), '')
 WHERE name IS NOT NULL AND firstname IS NULL;

-- Add international_license to valid id_types
-- (no constraint to update — it's checked in Python code)
