-- =====================================================
-- Migration 034 — Return branch on a rental
--
-- When a company receives a car back, it now records WHICH branch the car was
-- returned to. NULL = the head office / "Main" (mirrors cars.branch_id where
-- NULL means Main). Returning a car also moves the car to that branch
-- (cars.branch_id is updated app-side) so it's available there for the next
-- rental.
--
-- Apply:
--   psql -U postgres -d carrental -f migrations/034_rental_return_branch.sql
-- =====================================================

ALTER TABLE rentals
    ADD COLUMN IF NOT EXISTS return_branch_id INTEGER
        REFERENCES branches(id) ON DELETE SET NULL;

-- Index the FK so a branch delete (ON DELETE SET NULL) doesn't seq-scan rentals.
CREATE INDEX IF NOT EXISTS idx_rentals_return_branch
    ON rentals (return_branch_id);

ANALYZE rentals;
