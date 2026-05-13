-- =====================================================
-- Migration 003 — Companies: x (longitude) + y (latitude)
-- Convention used in this project:
--   x = longitude (east–west)   e.g. 35.5018
--   y = latitude  (north–south) e.g. 33.8938
-- Apply:
--   psql -U postgres -d carrental -f migrations/003_company_coords.sql
-- =====================================================

ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS x NUMERIC(9,6),   -- longitude
    ADD COLUMN IF NOT EXISTS y NUMERIC(9,6);   -- latitude

-- Pre-fill the seeded companies with their real city centres in Lebanon
UPDATE companies SET x = 35.5018, y = 33.8938 WHERE companyid = 'CMP-001'; -- Beirut
UPDATE companies SET x = 35.8497, y = 34.4367 WHERE companyid = 'CMP-AR-001' AND x IS NULL;

-- View must include the new columns. We have to drop+recreate because
-- the column list changes.
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
    co.id            AS company_id,
    co.companyname   AS company_name,
    co.companyid     AS company_code,
    co.location      AS company_location,
    co.x             AS company_x,
    co.y             AS company_y,
    c.vin            AS car_vin,
    c.model          AS car_model,
    c.type           AS car_type,
    c.color          AS car_color,
    c.platenumber    AS car_plate,
    c.has_gps        AS car_has_gps,
    r.start_date,
    r.end_date,
    r.is_active
FROM rentals r
JOIN clients   cl ON cl.id  = r.client_id
JOIN cars      c  ON c.vin  = r.car_vin
JOIN companies co ON co.id  = c.company_id;

ANALYZE companies;
