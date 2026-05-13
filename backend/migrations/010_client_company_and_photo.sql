-- =====================================================
-- Migration 010 — Per-company clients + client photo
--
-- 1. Tag each client with the company that registered them so the
--    Create-Rental dropdown only shows that company's own clients.
--    Existing rows keep company_id NULL (they predate this rule).
-- 2. Add a `photo` TEXT column for an optional base64 data URL of the
--    client's photograph (same shape as companies.logo).
--
-- Apply:
--   psql -U postgres -d carrental -f migrations/010_client_company_and_photo.sql
-- =====================================================

ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS company_id INTEGER
        REFERENCES companies(id) ON DELETE SET NULL;

ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS photo TEXT;

CREATE INDEX IF NOT EXISTS idx_clients_company
    ON clients (company_id) WHERE is_active = TRUE;

ANALYZE clients;
