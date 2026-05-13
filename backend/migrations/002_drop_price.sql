-- =====================================================
-- Migration 002 — Drop total_price (project re-scoped to
-- police investigation: who rented which car from which
-- company, and whether that car has GPS).
-- Apply:
--   psql -U postgres -d carrental -f migrations/002_drop_price.sql
-- =====================================================

-- The view depends on the column, so drop it first.
DROP VIEW IF EXISTS v_client_rentals;

ALTER TABLE rentals DROP COLUMN IF EXISTS total_price;

CREATE OR REPLACE VIEW v_client_rentals AS
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

ANALYZE rentals;
