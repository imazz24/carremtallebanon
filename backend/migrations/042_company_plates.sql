-- =====================================================
-- Migration 042 — Plates belong to the COMPANY, not the car
--
-- WHY
-- 041 tied plates to a car (car_plates) and collected them inside the Add-Car
-- form. The company instead wants to manage all of its plate numbers on their
-- own — a company-owned pool — and pick WHICH plate a car is on at rental time.
--
-- WHAT THIS DOES
--   1. company_plates — the company's pool of plate numbers. Each plate is
--      combined "<code> <number>" (e.g. "M 123456") and globally UNIQUE (a
--      plate is a physical registration; two companies can't share it).
--   2. Migrates the plates 041 created (car_plates) plus every car's own
--      cars.platenumber into the owning company's pool, so no plate is lost.
--   3. Drops car_plates — plates are no longer per-car.
--   4. cars.platenumber becomes NULLABLE: a car added in-app no longer carries a
--      plate (it's chosen from the pool at rental time). The external batch API
--      and the seeds may still set it, and it stays UNIQUE (Postgres lets a
--      UNIQUE column hold many NULLs).
--
-- rentals.plate / special_company_rentals.plate (added in 041) are kept — they
-- hold the pool plate a booking is on. v_client_rentals already reports
-- COALESCE(r.plate, c.platenumber), which stays correct.
--
-- Additive/idempotent where it can be. Apply:
--   psql -U postgres -d carrental -f migrations/042_company_plates.sql
-- =====================================================

-- ---- 1. company_plates -------------------------------------------------
CREATE TABLE IF NOT EXISTS company_plates (
    id           SERIAL PRIMARY KEY,
    company_id   INTEGER     NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    platenumber  VARCHAR(20) NOT NULL UNIQUE,   -- combined "<code> <number>"
    created_at   TIMESTAMP   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_company_plates_company ON company_plates(company_id);

-- ---- 2. Seed the pool from existing plates -----------------------------
-- Every car's own platenumber becomes its company's pool plate.
INSERT INTO company_plates (company_id, platenumber)
SELECT DISTINCT c.company_id, c.platenumber
  FROM cars c
 WHERE c.platenumber IS NOT NULL AND c.platenumber <> ''
ON CONFLICT (platenumber) DO NOTHING;

-- Plus any extra plates 041's car_plates held (only present if that table
-- exists — guarded so this migration is safe whether or not 041 ran).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_name = 'car_plates') THEN
        INSERT INTO company_plates (company_id, platenumber)
        SELECT DISTINCT c.company_id, cp.platenumber
          FROM car_plates cp
          JOIN cars c ON c.vin = cp.car_vin
         WHERE cp.platenumber IS NOT NULL AND cp.platenumber <> ''
        ON CONFLICT (platenumber) DO NOTHING;
    END IF;
END$$;

-- ---- 3. Retire car_plates ----------------------------------------------
DROP TABLE IF EXISTS car_plates;

-- ---- 4. A car no longer requires a plate -------------------------------
ALTER TABLE cars ALTER COLUMN platenumber DROP NOT NULL;

ANALYZE company_plates;
