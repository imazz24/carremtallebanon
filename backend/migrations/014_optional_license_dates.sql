-- =====================================================
-- Migration 014 — Optional license dates for License-only clients
--
-- License-only clients (id_type = 'license') may not have the issue /
-- expiry dates handy at registration time. dateofbirth was already
-- nullable since 008; this migration relaxes the two license date
-- columns to match so the row can be saved with just a licenseid.
--
-- Apply:
--   psql -U postgres -d carrental -f migrations/014_optional_license_dates.sql
-- =====================================================

ALTER TABLE clients ALTER COLUMN startdatelicense DROP NOT NULL;
ALTER TABLE clients ALTER COLUMN enddatelicense   DROP NOT NULL;

ANALYZE clients;
