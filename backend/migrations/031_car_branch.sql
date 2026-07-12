-- =====================================================
-- Migration 031 — Associate each car with a branch of its company
--
-- A car belongs to one company (existing company_id) and MAY sit at a specific
-- branch of that company. NULL branch_id = the car is at the company's main /
-- head office (shown as "Main" in the UI). ON DELETE SET NULL so removing a
-- branch never deletes its cars — they simply fall back to Main.
--
-- Apply:
--   psql -U postgres -d carrental -f migrations/031_car_branch.sql
--   (against the CONTAINER db: docker exec -i carrental-postgres psql -U postgres -d carrental < migrations/031_car_branch.sql)
-- =====================================================

ALTER TABLE cars
    ADD COLUMN IF NOT EXISTS branch_id INTEGER
        REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cars_branch ON cars(branch_id) WHERE branch_id IS NOT NULL;

ANALYZE cars;
