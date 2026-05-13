-- =====================================================
-- Migration 006 — Branches per company + per-company login users
--
-- Apply:
--   psql -U postgres -d carrental -f migrations/006_branches_and_company_users.sql
-- =====================================================

-- pgcrypto gives us DIGEST() for the seed-user password backfill below.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---- Link each user to a company (admin user has NULL) -------------------
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE;

-- The role column already exists with default 'admin'. New per-company users
-- will be inserted with role='company'.

-- ---- BRANCHES ------------------------------------------------------------
-- Each branch belongs to one company. Soft-deletable like the other entities.
CREATE TABLE IF NOT EXISTS branches (
    id           SERIAL PRIMARY KEY,
    company_id   INTEGER      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    branchname   VARCHAR(150) NOT NULL,
    location     VARCHAR(200) NOT NULL,
    phonenumber  VARCHAR(30),
    x            NUMERIC(9,6),
    y            NUMERIC(9,6),
    is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_branches_company ON branches(company_id) WHERE is_active = TRUE;

-- Backfill: create one user per existing company.
-- Username = companyname (lower-cased, spaces -> underscores).
-- Password = sha256(companyid)  -- the companyid value acts as initial pw.
INSERT INTO users (username, password_hash, role, company_id)
SELECT
    LOWER(REPLACE(co.companyname, ' ', '_'))                       AS username,
    ENCODE(DIGEST(co.companyid, 'sha256'), 'hex')                  AS password_hash,
    'company'                                                      AS role,
    co.id                                                          AS company_id
FROM companies co
WHERE co.is_active = TRUE
  AND NOT EXISTS (
        SELECT 1 FROM users u
         WHERE u.company_id = co.id
           AND u.role = 'company'
  )
ON CONFLICT (username) DO NOTHING;

ANALYZE users;
ANALYZE branches;
