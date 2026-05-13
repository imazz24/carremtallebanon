-- =====================================================
-- Migration 011 — Surface client photo / nationality / DOB in the
-- v_client_rentals view so the rental detail modal can render them
-- without an extra round-trip.
--
-- Apply:
--   psql -U postgres -d carrental -f migrations/011_view_client_photo.sql
-- =====================================================

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
    r.id             AS rental_id,
    r.start_date,
    r.end_date,
    r.is_active
FROM rentals r
JOIN clients   cl ON cl.id  = r.client_id  AND cl.is_active = TRUE
JOIN cars      c  ON c.vin  = r.car_vin    AND c.is_active  = TRUE
JOIN companies co ON co.id  = c.company_id AND co.is_active = TRUE
WHERE r.is_active = TRUE;
