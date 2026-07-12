-- =====================================================
-- Migration 037 — Surface branch relations on the rental report view
--
-- Cars, rentals and returns are all now tied to a company AND a branch, but
-- the rental report view (v_client_rentals) never carried that. This recreates
-- it (same shape as migration 021, plus branch columns) so both the in-app
-- report and the external API-key rental report expose:
--   * car_branch_id / car_branch_name   — the branch the car currently belongs
--                                          to (NULL id = the head office; the
--                                          name is shown as "Main").
--   * return_branch_id / return_branch_name — WHICH branch the car was handed
--                                          back to (NULL until returned; pair
--                                          with returned_at to tell "not yet
--                                          returned" from "returned to Main").
--
-- Adding columns is backward-compatible — every consumer reads by key.
--
-- Apply:
--   psql -U postgres -d carrental -f migrations/037_rental_view_branches.sql
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
    c.branch_id                    AS car_branch_id,
    COALESCE(b.branchname, 'Main') AS car_branch_name,
    r.id             AS rental_id,
    r.start_date,
    r.end_date,
    r.is_active,
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
