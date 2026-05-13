-- =====================================================
-- Migration 001 — Users table + explicit lookup indexes
-- Apply:
--   psql -U postgres -d carrental -f migrations/001_users_and_indexes.sql
-- =====================================================

-- ---- USERS (login) -----------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(60)  NOT NULL UNIQUE,
    password_hash VARCHAR(200) NOT NULL,        -- SHA-256 hex of plaintext
    role          VARCHAR(20)  NOT NULL DEFAULT 'admin',
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Seed admin / admin   (sha256('admin'))
INSERT INTO users (username, password_hash, role)
VALUES (
  'admin',
  '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918',
  'admin'
)
ON CONFLICT (username) DO NOTHING;

-- =====================================================
-- LOOKUP INDEXES
-- Note: UNIQUE constraints already create a B-tree index automatically,
-- so the columns below are *already* indexed. We add named indexes
-- for clarity in \di output and as a documented contract that these
-- columns are the high-cardinality lookup keys for billion-row scale.
-- (PostgreSQL allows duplicates; remove these if you prefer to rely
-- only on the unique-constraint indexes.)
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_cars_vin_btree
    ON cars (vin);

CREATE INDEX IF NOT EXISTS idx_clients_licenseid_btree
    ON clients (licenseid);

CREATE INDEX IF NOT EXISTS idx_companies_companyid_btree
    ON companies (companyid);

-- =====================================================
-- Composite indexes that actually accelerate the report query
-- (every client → cars rented → from what company)
-- =====================================================
-- Used when filtering a client's rentals + joining cars
CREATE INDEX IF NOT EXISTS idx_rentals_client_carvin
    ON rentals (client_id, car_vin);

-- Used when filtering active rentals first (most common case)
CREATE INDEX IF NOT EXISTS idx_rentals_active
    ON rentals (is_active, client_id) WHERE is_active = TRUE;

-- Cars-by-company lookup is already covered by idx_cars_company,
-- but a covering index lets index-only scans return everything
-- the report query reads without touching the heap:
CREATE INDEX IF NOT EXISTS idx_cars_company_covering
    ON cars (company_id) INCLUDE (vin, model, type, color, platenumber, has_gps);

-- Refresh planner stats so the new indexes get used immediately
ANALYZE users;
ANALYZE cars;
ANALYZE clients;
ANALYZE companies;
ANALYZE rentals;
