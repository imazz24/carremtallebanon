-- =====================================================
-- Migration 007 — Per-company logo
--
-- Stores the logo as a small base64 data URL inside the
-- companies row, so it travels with /api/login and the
-- regular /api/companies payloads (no extra round-trip).
--
-- Apply:
--   psql -U postgres -d carrental -f migrations/007_company_logo.sql
-- =====================================================

ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS logo TEXT;

ANALYZE companies;
