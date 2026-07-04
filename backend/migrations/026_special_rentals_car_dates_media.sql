-- =====================================================
-- Migration 026 — Special-company rentals: single car, dates & media
--
-- The B2B "cars rented to companies" feature is reshaped to mirror the
-- regular rental report: one record = ONE car rented to a company, with its
-- own rental period (start_date / end_date). Each record can also carry
-- photos / videos of the car, stored in a new special_rental_media table
-- (same shape as rental_media).
--
-- The legacy car_vins CSV column is kept (nullable) for safety; new records
-- write the single car_vin. Existing rows are backfilled to the first VIN.
-- =====================================================

ALTER TABLE special_company_rentals
    ADD COLUMN IF NOT EXISTS car_vin    VARCHAR(64),
    ADD COLUMN IF NOT EXISTS start_date DATE,
    ADD COLUMN IF NOT EXISTS end_date   DATE;

-- Backfill car_vin from the first VIN in the old CSV list.
UPDATE special_company_rentals
   SET car_vin = NULLIF(TRIM(split_part(car_vins, ',', 1)), '')
 WHERE car_vin IS NULL
   AND COALESCE(car_vins, '') <> '';

-- Per-car photos / videos for B2B records (mirror of rental_media).
CREATE TABLE IF NOT EXISTS special_rental_media (
    id                SERIAL PRIMARY KEY,
    special_rental_id INTEGER      NOT NULL
                         REFERENCES special_company_rentals(id) ON DELETE CASCADE,
    kind              VARCHAR(20)  NOT NULL,                 -- 'photo' | 'video'
    filename          VARCHAR(200) NOT NULL,
    original_name     VARCHAR(200),
    mime              VARCHAR(100),
    uploaded_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
    uploaded_by       VARCHAR(60)
);

CREATE INDEX IF NOT EXISTS idx_special_rental_media_rental
    ON special_rental_media(special_rental_id);
