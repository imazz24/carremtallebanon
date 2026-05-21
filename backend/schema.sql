-- =====================================================
-- Car Rental Database Schema
-- Database: carrental  (PostgreSQL)
-- =====================================================

-- Run once as a superuser:
--   CREATE DATABASE carrental;
-- Then connect to that DB and run this file:
--   \c carrental
--   \i schema.sql

-- ---- 1) COMPANIES ------------------------------------
CREATE TABLE IF NOT EXISTS companies (
    id           SERIAL PRIMARY KEY,
    companyname  VARCHAR(150) NOT NULL,
    location     VARCHAR(200) NOT NULL,
    companyid    VARCHAR(50)  NOT NULL UNIQUE,  -- public/business identifier
    phonenumber  VARCHAR(30),                   -- contact phone
    x            NUMERIC(9,6),                  -- longitude (east–west)
    y            NUMERIC(9,6),                  -- latitude  (north–south)
    logo         TEXT                           -- base64 data URL of the logo
);

-- ---- 2) CARS -----------------------------------------
-- Each car belongs to ONE company (cars.company_id -> companies.id).
-- VIN is unique across the fleet.
CREATE TABLE IF NOT EXISTS cars (
    id           SERIAL PRIMARY KEY,
    vin          VARCHAR(17)  NOT NULL UNIQUE,
    type         VARCHAR(50)  NOT NULL,         -- e.g. SUV, Sedan, Truck
    model        VARCHAR(100) NOT NULL,
    color        VARCHAR(40)  NOT NULL,
    platenumber  VARCHAR(20)  NOT NULL UNIQUE,
    has_gps      BOOLEAN      NOT NULL DEFAULT FALSE,  -- "status: include GPS or not"
    company_id   INTEGER      NOT NULL REFERENCES companies(id) ON DELETE CASCADE
);

-- ---- 3) CLIENTS --------------------------------------
CREATE TABLE IF NOT EXISTS clients (
    id                  SERIAL PRIMARY KEY,
    personid            VARCHAR(40)  UNIQUE,          -- passport / national-ID #; null for license-only clients
    name                VARCHAR(100),                 -- optional
    fathername          VARCHAR(100),                 -- optional (Lebanese-passport convention only)
    mothername          VARCHAR(100),                 -- optional (Lebanese-passport convention only)
    nationality         VARCHAR(60),
    phonenumber         VARCHAR(30),                  -- optional
    dateofbirth         DATE,                         -- optional
    licenseid           VARCHAR(40)  NOT NULL UNIQUE,
    startdatelicense    DATE,                         -- optional (license-only clients can skip)
    enddatelicense      DATE,                         -- optional (license-only clients can skip)
    company_id          INTEGER      REFERENCES companies(id) ON DELETE SET NULL,
    photo               TEXT,                         -- base64 data URL of the client's photo OR id document
    id_type             VARCHAR(20)                   -- 'passport' | 'national_id' | 'license'
);
CREATE INDEX IF NOT EXISTS idx_clients_company ON clients(company_id);

-- A single real person (personid + licenseid) may rent from many
-- companies. This junction is the source of truth for "which
-- companies see this client". clients.company_id above is kept only
-- as the originator label and is no longer used for filtering.
CREATE TABLE IF NOT EXISTS client_companies (
    client_id  INTEGER NOT NULL REFERENCES clients(id)   ON DELETE CASCADE,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    PRIMARY KEY (client_id, company_id)
);
CREATE INDEX IF NOT EXISTS idx_client_companies_company
    ON client_companies (company_id);

-- ---- 4) RENTALS (link table) -------------------------
-- A rental ties a client to a car (and through the car, to a company).
CREATE TABLE IF NOT EXISTS rentals (
    id          SERIAL PRIMARY KEY,
    client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    car_vin     VARCHAR(17) NOT NULL REFERENCES cars(vin) ON DELETE CASCADE,
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cars_company    ON cars(company_id);
CREATE INDEX IF NOT EXISTS idx_rentals_client  ON rentals(client_id);
CREATE INDEX IF NOT EXISTS idx_rentals_carvin  ON rentals(car_vin);

-- ---- 5) RENTAL_MEDIA (photos + videos attached to a rental) ------
CREATE TABLE IF NOT EXISTS rental_media (
    id            SERIAL PRIMARY KEY,
    rental_id     INTEGER     NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
    kind          VARCHAR(20) NOT NULL,                 -- 'photo' | 'video'
    filename      VARCHAR(200) NOT NULL,
    original_name VARCHAR(200),
    mime          VARCHAR(100),
    uploaded_at   TIMESTAMP   NOT NULL DEFAULT NOW(),
    uploaded_by   VARCHAR(60)
);
CREATE INDEX IF NOT EXISTS idx_rental_media_rental ON rental_media(rental_id);

-- =====================================================
-- VIEW: every client + the cars they rented + the company
-- =====================================================
CREATE OR REPLACE VIEW v_client_rentals AS
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
JOIN clients   cl ON cl.id = r.client_id
JOIN cars      c  ON c.vin = r.car_vin
JOIN companies co ON co.id = c.company_id;

-- =====================================================
-- Sample seed data (safe to re-run thanks to ON CONFLICT)
-- =====================================================
INSERT INTO companies (companyname, location, companyid) VALUES
  ('Beirut Auto Rent', 'Beirut, Lebanon',   'CMP-001'),
  ('Dubai Premium Cars','Dubai, UAE',        'CMP-002'),
  ('Riyadh Wheels',    'Riyadh, KSA',       'CMP-003')
ON CONFLICT (companyid) DO NOTHING;

INSERT INTO cars (vin, type, model, color, platenumber, has_gps, company_id) VALUES
  ('1HGCM82633A004352','SUV',  'Toyota RAV4',     'White','BEY-1001', TRUE,  1),
  ('JH4KA9650MC012345','Sedan','Hyundai Elantra', 'Black','BEY-1002', FALSE, 1),
  ('WBA3A5C50CF256789','Sedan','BMW 320i',        'Blue', 'DXB-2001', TRUE,  2),
  ('5YJSA1E26HF123456','SUV',  'Tesla Model X',   'Red',  'DXB-2002', TRUE,  2),
  ('JTDKARFU0K3074120','Sedan','Toyota Corolla',  'Grey', 'RUH-3001', FALSE, 3)
ON CONFLICT (vin) DO NOTHING;

INSERT INTO clients (personid, name, fathername, mothername, phonenumber,
                     dateofbirth, licenseid, startdatelicense, enddatelicense) VALUES
  ('PID-1001','Ahmad Khalil','Khalil','Mariam','+961-70-111222',
   '1992-05-14','LIC-A1001','2018-06-01','2028-06-01'),
  ('PID-1002','Sara Haddad','Elias','Layla','+961-71-333444',
   '1995-09-22','LIC-A1002','2019-02-15','2029-02-15')
ON CONFLICT (personid) DO NOTHING;
