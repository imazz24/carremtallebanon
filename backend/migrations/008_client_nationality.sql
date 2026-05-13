-- =====================================================
-- Migration 008 — Client nationality + simplified required fields
--
-- The company-user "Add Client" form only collects:
--   personid, fathername, mothername, nationality,
--   licenseid, startdatelicense, enddatelicense
--
-- so name/phonenumber/dateofbirth become optional. They stay in the
-- table so existing data and the admin's read-only view keep working.
--
-- Apply:
--   psql -U postgres -d carrental -f migrations/008_client_nationality.sql
-- =====================================================

ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS nationality VARCHAR(60);

ALTER TABLE clients ALTER COLUMN name        DROP NOT NULL;
ALTER TABLE clients ALTER COLUMN phonenumber DROP NOT NULL;
ALTER TABLE clients ALTER COLUMN dateofbirth DROP NOT NULL;

ANALYZE clients;
