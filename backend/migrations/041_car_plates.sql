-- =====================================================
-- Migration 041 — A car can carry more than one plate
--
-- WHY
-- A car used to have exactly one plate, stored as cars.platenumber in the
-- combined "<code> <number>" form (e.g. "M 123456"), UNIQUE across the fleet.
-- The company now registers a car with one OR MORE plates (each its own code
-- description + number), and a rental records WHICH of that car's plates the
-- booking is for.
--
-- WHAT THIS DOES
--   1. car_plates — the source of truth for ALL of a car's plates, including
--      the primary one. Each plate is globally UNIQUE (a plate is a physical
--      registration; two cars can't share it).
--   2. cars.platenumber STAYS, as the car's PRIMARY plate. Every existing join,
--      the external batch API, and the seeds keep reading it unchanged; it is
--      just kept in sync with the first row in car_plates. Backfill copies each
--      car's current platenumber into car_plates as its first plate.
--   3. rentals.plate / special_company_rentals.plate — the specific plate the
--      booking is for (combined form). NULL means "the car's primary plate",
--      which is what every pre-existing booking and every external-API push
--      (which sends no plate) resolves to via COALESCE.
--   4. v_client_rentals surfaces COALESCE(r.plate, c.platenumber) as car_plate,
--      so a report row shows the plate the booking was actually taken on.
--
-- Additive and idempotent. Apply:
--   psql -U postgres -d carrental -f migrations/041_car_plates.sql
-- =====================================================

-- ---- 1. car_plates -----------------------------------------------------
CREATE TABLE IF NOT EXISTS car_plates (
    id           SERIAL PRIMARY KEY,
    car_vin      VARCHAR(17) NOT NULL REFERENCES cars(vin) ON DELETE CASCADE,
    platenumber  VARCHAR(20) NOT NULL UNIQUE,   -- combined "<code> <number>"
    created_at   TIMESTAMP   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_car_plates_car ON car_plates(car_vin);

-- ---- 2. Backfill: each existing car's platenumber becomes its first plate.
-- Guarded so re-running can't duplicate, and skips a plate already claimed by
-- another car (there can't be one — cars.platenumber is UNIQUE — but the ON
-- CONFLICT keeps this safe under concurrent applies / partial prior runs).
INSERT INTO car_plates (car_vin, platenumber)
SELECT c.vin, c.platenumber
  FROM cars c
 WHERE c.platenumber IS NOT NULL
   AND NOT EXISTS (
        SELECT 1 FROM car_plates p WHERE p.car_vin = c.vin
   )
ON CONFLICT (platenumber) DO NOTHING;

-- ---- 3. Which plate a booking is for -----------------------------------
ALTER TABLE rentals
    ADD COLUMN IF NOT EXISTS plate VARCHAR(20);

ALTER TABLE special_company_rentals
    ADD COLUMN IF NOT EXISTS plate VARCHAR(20);

-- ---- 4. Surface the booking's plate on the rental report view ----------
-- Same shape as 040, but car_plate becomes COALESCE(r.plate, c.platenumber):
-- a booking taken on a secondary plate reports that plate; every older row
-- (r.plate NULL) still reports the car's primary plate. Adding/replacing a
-- column value is backward-compatible — every consumer reads car_plate by key.
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
    COALESCE(r.plate, c.platenumber) AS car_plate,
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

ANALYZE car_plates;
