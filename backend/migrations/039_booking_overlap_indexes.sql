-- =====================================================
-- Migration 039 — Booking-overlap hot-path indexes (millions of rows)
--
-- Every rental/reservation create, extend, and reservation-activation runs
-- `_check_car_date_overlap`, which — under a per-VIN advisory lock — issues:
--
--   SELECT ... FROM rentals
--    WHERE car_vin = ? AND returned_at IS NULL
--      AND start_date < ? AND end_date > ?  FOR UPDATE
--
--   SELECT ... FROM reservations
--    WHERE car_vin = ? AND status = 'pending'
--      AND start_date < ? AND end_date > ?  FOR UPDATE
--
-- Today only plain car_vin indexes serve these (idx_rentals_carvin,
-- idx_reservations_car_vin). At millions of rows a single car can have a long
-- history, so filtering by car_vin alone still scans (and locks) every past
-- booking for that car. These PARTIAL COMPOSITE indexes cover the exact live
-- predicate — only the unreturned rentals / pending reservations, ordered by
-- date — so the overlap check touches just the handful of active rows for the
-- one car. Smaller index (partial) + no extra sort = a fast, tightly-scoped
-- FOR UPDATE lock, which keeps the hot booking path parallel across cars even
-- as the tables grow.
--
-- Idempotent (IF NOT EXISTS). Apply:
--   psql -U postgres -d carrental -f migrations/039_booking_overlap_indexes.sql
-- =====================================================

-- Live rentals for a car, by date — serves the rentals overlap probe.
CREATE INDEX IF NOT EXISTS idx_rentals_overlap
    ON rentals (car_vin, start_date, end_date)
    WHERE returned_at IS NULL;

-- Pending reservations for a car, by date — serves the reservations overlap probe.
CREATE INDEX IF NOT EXISTS idx_reservations_overlap
    ON reservations (car_vin, start_date, end_date)
    WHERE status = 'pending';

ANALYZE rentals;
ANALYZE reservations;
