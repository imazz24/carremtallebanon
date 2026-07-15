-- =====================================================
-- Migration 040 — Rental status, and the retirement of reservations
--
-- WHY
-- A "reservation" was only ever a rental that hadn't started yet: the create
-- form silently routed a future start_date to /api/reservations and a same-day
-- one to /api/rentals, and activating a reservation DELETED the row and
-- inserted a rentals row in its place. Two tables, two endpoints, two report
-- surfaces — for one thing with a date in the future.
--
-- This migration folds that back into one table. A booking is a rental; where
-- it is in its life is a `status`:
--
--   pending    — booked, not started (what a reservation used to be)
--   active     — out with the renter
--   cancelled  — called off; keeps the record, frees the car
--
-- The same three states go on special_company_rentals (B2B), which had no
-- status column at all. Status is the BOOKING state and stays orthogonal to
-- returned_at: an active booking still derives Out / Due today / Overdue /
-- Returned from its dates, exactly as it does today.
--
-- WHAT HAPPENS TO THE reservations TABLE
-- Its rows are copied into rentals (status preserved: pending→pending,
-- active→active, inactive→cancelled) and the table is then left DORMANT — not
-- dropped. Nothing reads or writes it after this migration. Keeping it makes
-- this migration reversible and preserves the original rows as an archive; a
-- later migration can drop it once you're satisfied. The public API endpoints
-- (/api/reservations/batch, /api/reports/reservations) keep working — they are
-- repointed onto pending rentals in app.py, so integrations don't break.
--
-- Idempotent. Apply:
--   psql -U postgres -d carrental -f migrations/040_rental_status.sql
-- =====================================================

-- ---- 1. rentals.status -------------------------------------------------
ALTER TABLE rentals
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- reservations carried a `notes` field and the public batch API accepts one.
-- rentals had nowhere to put it, so absorb it here rather than silently drop
-- notes on every /api/reservations/batch call.
ALTER TABLE rentals
    ADD COLUMN IF NOT EXISTS notes TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'rentals_status_check'
    ) THEN
        ALTER TABLE rentals
            ADD CONSTRAINT rentals_status_check
            CHECK (status IN ('active', 'pending', 'cancelled'));
    END IF;
END$$;

-- Every pre-existing rentals row was, by definition, a live booking.
UPDATE rentals SET status = 'active' WHERE status IS NULL;

-- ---- 2. special_company_rentals.status ---------------------------------
ALTER TABLE special_company_rentals
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'special_company_rentals_status_check'
    ) THEN
        ALTER TABLE special_company_rentals
            ADD CONSTRAINT special_company_rentals_status_check
            CHECK (status IN ('active', 'pending', 'cancelled'));
    END IF;
END$$;

-- ---- 3. Carry the reservations across ----------------------------------
-- reservations.status → rentals.status:
--   pending  → pending    (booked, not started)
--   active   → active     (only reachable via seed data; activation used to
--                          delete the row, so these never had a rental)
--   inactive → cancelled  (the old "called off" state)
--
-- Guarded by NOT EXISTS on (client_id, car_vin, start_date, end_date) so
-- re-running can't duplicate a booking, and skips any reservation whose rental
-- already exists.
INSERT INTO rentals (client_id, car_vin, start_date, end_date, status, notes, created_at)
SELECT rv.client_id,
       rv.car_vin,
       rv.start_date,
       rv.end_date,
       CASE rv.status
           WHEN 'pending'  THEN 'pending'
           WHEN 'active'   THEN 'active'
           WHEN 'inactive' THEN 'cancelled'
           ELSE 'pending'
       END,
       rv.notes,
       COALESCE(rv.created_at, now())
  FROM reservations rv
 WHERE EXISTS (SELECT 1 FROM cars c WHERE c.vin = rv.car_vin)
   AND EXISTS (SELECT 1 FROM clients cl WHERE cl.id = rv.client_id)
   AND NOT EXISTS (
        SELECT 1 FROM rentals r
         WHERE r.client_id  = rv.client_id
           AND r.car_vin    = rv.car_vin
           AND r.start_date = rv.start_date
           AND r.end_date   = rv.end_date
   );

-- Carry notes onto bookings that were already migrated by an earlier run of
-- this file (the guard above skips them, so the INSERT can't fill them in).
UPDATE rentals r
   SET notes = rv.notes
  FROM reservations rv
 WHERE r.notes IS NULL AND rv.notes IS NOT NULL
   AND r.client_id  = rv.client_id
   AND r.car_vin    = rv.car_vin
   AND r.start_date = rv.start_date
   AND r.end_date   = rv.end_date;

-- ---- 3b. Surface status on the rental report view ----------------------
-- Same shape as 037, plus r.status and r.notes, so the in-app report and the
-- external API-key rental report can both show a booking's state. Adding
-- columns is backward-compatible — every consumer reads by key.
DROP VIEW IF EXISTS v_client_rentals;

CREATE VIEW v_client_rentals AS
SELECT
    cl.id            AS client_id,
    cl.name          AS client_name,
    cl.fathername    AS client_father,
    cl.mothername    AS client_mother,
    cl.personid      AS client_personid,
    cl.phonenumber   AS client_phone,
    cl.licenseid     AS client_licenseid,
    cl.nationality   AS client_nationality,
    cl.dateofbirth   AS client_dob,
    cl.photo         AS client_photo,
    cl.company_id    AS client_company_id,
    co.id            AS company_id,
    co.companyname   AS company_name,
    co.companyid     AS company_code,
    co.location      AS company_location,
    co.phonenumber   AS company_phone,
    co.x             AS company_x,
    co.y             AS company_y,
    co.logo          AS company_logo,
    c.vin            AS car_vin,
    c.model          AS car_model,
    c.type           AS car_type,
    c.color          AS car_color,
    c.platenumber    AS car_plate,
    c.has_gps        AS car_has_gps,
    c.branch_id                    AS car_branch_id,
    COALESCE(b.branchname, 'Main') AS car_branch_name,
    r.id             AS rental_id,
    r.start_date,
    r.end_date,
    r.is_active,
    r.status,
    r.notes,
    r.returned_at,
    r.return_branch_id,
    rb.branchname    AS return_branch_name
FROM rentals r
JOIN clients   cl ON cl.id  = r.client_id  AND cl.is_active = TRUE
JOIN cars      c  ON c.vin  = r.car_vin    AND c.is_active  = TRUE
JOIN companies co ON co.id  = c.company_id AND co.is_active = TRUE
LEFT JOIN branches b  ON b.id  = c.branch_id
LEFT JOIN branches rb ON rb.id = r.return_branch_id
WHERE r.is_active = TRUE;

-- ---- 4. Indexes for the new hot predicate ------------------------------
-- The overlap probe now reads rentals only, and a cancelled booking must not
-- block a car. Mirrors idx_rentals_overlap (039) with the status filter, so
-- the FOR UPDATE lock still touches just the live rows for one car.
CREATE INDEX IF NOT EXISTS idx_rentals_overlap_status
    ON rentals (car_vin, start_date, end_date)
    WHERE returned_at IS NULL AND status IN ('active', 'pending');

CREATE INDEX IF NOT EXISTS idx_rentals_status
    ON rentals (status);

-- B2B rows are listed per company and filtered by status in the Cars hub.
CREATE INDEX IF NOT EXISTS idx_special_rentals_status
    ON special_company_rentals (company_id, status);

ANALYZE rentals;
ANALYZE special_company_rentals;
