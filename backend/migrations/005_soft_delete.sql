-- =====================================================
-- Migration 005 — Soft-delete on companies / cars / clients
-- "Delete" never removes data; it sets is_active = FALSE.
-- The report view and list endpoints filter on is_active.
-- =====================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE cars      ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE clients   ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Partial indexes: only the active rows get indexed (small + fast)
CREATE INDEX IF NOT EXISTS idx_companies_active ON companies(id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_cars_active      ON cars(id)      WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_clients_active   ON clients(id)   WHERE is_active = TRUE;

-- Rebuild the report view: only join active rows
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
    r.id             AS rental_id,
    r.start_date,
    r.end_date,
    r.is_active
FROM rentals r
JOIN clients   cl ON cl.id  = r.client_id  AND cl.is_active = TRUE
JOIN cars      c  ON c.vin  = r.car_vin    AND c.is_active  = TRUE
JOIN companies co ON co.id  = c.company_id AND co.is_active = TRUE;

ANALYZE companies;
ANALYZE cars;
ANALYZE clients;
