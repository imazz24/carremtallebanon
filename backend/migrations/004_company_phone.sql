-- =====================================================
-- Migration 004 — Add phonenumber to companies
-- Apply:
--   psql -U postgres -d carrental -f migrations/004_company_phone.sql
-- =====================================================

ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS phonenumber VARCHAR(30);

-- Backfill the seeded companies with example phone numbers
UPDATE companies SET phonenumber = '+961-1-123456'  WHERE companyid = 'CMP-001'    AND phonenumber IS NULL;
UPDATE companies SET phonenumber = '+971-4-555000'  WHERE companyid = 'CMP-002'    AND phonenumber IS NULL;
UPDATE companies SET phonenumber = '+966-11-444333' WHERE companyid = 'CMP-003'    AND phonenumber IS NULL;
UPDATE companies SET phonenumber = '+961-6-777888'  WHERE companyid = 'CMP-MAP-01' AND phonenumber IS NULL;
UPDATE companies SET phonenumber = '+961-1-999000'  WHERE companyid = 'CMP-AR-001' AND phonenumber IS NULL;

-- Rebuild the report view to include company phone
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
    co.phonenumber   AS company_phone,
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
