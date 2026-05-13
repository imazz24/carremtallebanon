-- =====================================================
-- Migration 012 — Many-to-many between clients and companies.
--
-- Background: a single real person (one personid + one licenseid) may
-- rent from multiple companies. Previously each client row carried a
-- single company_id, which meant the same person had to be re-entered
-- (and rejected by the personid UNIQUE constraint) when a second
-- company tried to add them. This migration introduces a junction
-- table so every client can be linked to many companies.
--
-- clients.company_id is kept as the "first-registered" / originator
-- company for historical context (and for compatibility with the
-- existing v_client_rentals view) but is no longer used to scope
-- "which companies see this client" — the junction table is.
--
-- Apply:
--   psql -U postgres -d carrental -f migrations/012_client_companies.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS client_companies (
    client_id  INTEGER NOT NULL REFERENCES clients(id)   ON DELETE CASCADE,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    PRIMARY KEY (client_id, company_id)
);

-- Backfill: every existing client that already had a company_id gets a
-- matching junction row, so the new "filter by junction" logic shows
-- them to the same company that used to see them.
INSERT INTO client_companies (client_id, company_id)
SELECT id, company_id
  FROM clients
 WHERE company_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Lookup index for "which clients does this company see?".
CREATE INDEX IF NOT EXISTS idx_client_companies_company
    ON client_companies (company_id);

ANALYZE client_companies;
