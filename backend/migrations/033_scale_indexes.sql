-- =====================================================
-- Migration 033 — Scaling indexes (100k users / millions of rows)
--
-- Adds the indexes the app actually needs at scale. Three groups:
--   1. The critical one: a functional index on LOWER(username). Auth
--      (_current_user) and login filter `WHERE LOWER(username) = %s`, which the
--      plain UNIQUE(username) B-tree (migration 001) cannot serve — so today
--      every authenticated request seq-scans the whole users table. This makes
--      it an index scan.
--   2. Missing foreign-key / ORDER BY columns that cause seq scans + full sorts
--      at scale (FK cascade checks, reservation/report ordering).
--   3. pg_trgm GIN indexes so the fleet search's `ILIKE '%term%'` (a leading
--      wildcard the B-trees can't use) stops sequentially scanning cars/joins.
--
-- All idempotent (IF NOT EXISTS) so re-running is safe.
--
-- Apply:
--   psql -U postgres -d carrental -f migrations/033_scale_indexes.sql
-- =====================================================

-- 1. CRITICAL — case-insensitive username lookup (every request + every login).
CREATE INDEX IF NOT EXISTS idx_users_lower_username
    ON users (LOWER(username));

-- 2. Missing FK / sort indexes.
--    users.company_id: FK ON DELETE CASCADE + `WHERE company_id = %s`.
CREATE INDEX IF NOT EXISTS idx_users_company
    ON users (company_id);
--    reservations.client_id: FK joined to clients; no index today.
CREATE INDEX IF NOT EXISTS idx_reservations_client
    ON reservations (client_id);
--    reservations.created_at: every reservation list is `ORDER BY created_at DESC`.
CREATE INDEX IF NOT EXISTS idx_reservations_created
    ON reservations (created_at DESC);
--    co_renters.client_id: FK to clients (UNIQUE(rental_id,client_id) can't serve it).
CREATE INDEX IF NOT EXISTS idx_co_renters_client
    ON co_renters (client_id);
--    activity_log.user_id: FK ON DELETE SET NULL; only company_id is indexed today.
CREATE INDEX IF NOT EXISTS idx_activity_user
    ON activity_log (user_id);
--    special_company_rentals.created_at: lists `ORDER BY created_at DESC`.
CREATE INDEX IF NOT EXISTS idx_special_rentals_created
    ON special_company_rentals (created_at DESC);

-- 3. Trigram search — turn `ILIKE '%term%'` seq scans into GIN index scans.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_cars_vin_trgm
    ON cars USING gin (vin gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cars_model_trgm
    ON cars USING gin (model gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cars_type_trgm
    ON cars USING gin (type gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_cars_plate_trgm
    ON cars USING gin (platenumber gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_companies_name_trgm
    ON companies USING gin (companyname gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_branches_name_trgm
    ON branches USING gin (branchname gin_trgm_ops);

ANALYZE users;
ANALYZE reservations;
ANALYZE co_renters;
ANALYZE activity_log;
ANALYZE special_company_rentals;
ANALYZE cars;
ANALYZE companies;
ANALYZE branches;
