-- =====================================================
-- Migration 013 — Client ID type + optional identity fields
--
-- The Add Client form now lets a company pick which kind of identity
-- document the client provided (Passport, National ID, or License-only).
--
-- 1. `id_type` records that choice for context in reports/exports.
--    Existing rows keep it NULL (legacy — type unknown).
-- 2. Relax NOT NULL on personid / fathername / mothername so:
--      - License-only clients can be saved with no personid at all.
--      - Foreign-passport clients can skip father / mother (those are a
--        Lebanese-specific convention).
--    UNIQUE on personid stays — PostgreSQL allows multiple NULLs in a
--    unique column.
--
-- Apply:
--   psql -U postgres -d carrental -f migrations/013_client_id_type.sql
-- =====================================================

ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS id_type VARCHAR(20);

ALTER TABLE clients ALTER COLUMN personid   DROP NOT NULL;
ALTER TABLE clients ALTER COLUMN fathername DROP NOT NULL;
ALTER TABLE clients ALTER COLUMN mothername DROP NOT NULL;

ANALYZE clients;
