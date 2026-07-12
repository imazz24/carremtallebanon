-- =====================================================
-- Migration 036 — Return a B2B (special-company) rental to the office
--
-- Until now a "car rented to a company" record (special_company_rentals) had
-- no notion of being handed back — it just sat in the list forever. Company
-- users now handle the return the same way they do for individual rentals:
--   * returned_at       — NULL while the car is still out with the company;
--                         stamped when the enterprise receives it back. Once
--                         set, the record drops off the active "Cars Rented by
--                         Companies" list (kept in history, shown as Returned).
--   * return_branch_id  — WHICH branch the car came back to (NULL = the head
--                         office / "Main", mirrors cars.branch_id). Returning a
--                         car also moves the car to that branch app-side so it's
--                         available there for the next rental.
--
-- Apply:
--   psql -U postgres -d carrental -f migrations/036_special_rental_return.sql
-- =====================================================

ALTER TABLE special_company_rentals
    ADD COLUMN IF NOT EXISTS returned_at TIMESTAMP NULL,
    ADD COLUMN IF NOT EXISTS return_branch_id INTEGER
        REFERENCES branches(id) ON DELETE SET NULL;

-- Index the FK so a branch delete (ON DELETE SET NULL) doesn't seq-scan the
-- table, and the "still out" filter (returned_at IS NULL) stays cheap.
CREATE INDEX IF NOT EXISTS idx_special_rentals_return_branch
    ON special_company_rentals (return_branch_id);

ANALYZE special_company_rentals;
