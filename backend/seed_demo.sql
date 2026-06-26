-- =====================================================
-- DEMO SEED — populates the admin Report / Data-Insights charts
-- with realistic, varied data so every KPI, donut and bar fills in.
--
-- Safe to re-run: it first removes anything it previously created
-- (all rows carry distinctive prefixes — companies 'CMP-01x',
-- cars 'SEEDCAR%', clients 'SEEDLIC%') and inserts fresh.
--
-- All dates are relative to CURRENT_DATE, so the Active / Overdue /
-- Returned split and the "rentals over time" months stay correct
-- no matter when you load it.
--
-- Load with:
--   docker compose exec -T postgres \
--     psql -U postgres -d carrental -f /seed/seed_demo.sql
-- (see docker-compose.override.yml for the mount, or pipe via stdin)
-- =====================================================

BEGIN;

-- ---- 0) Clean previous demo data. Reservations reference companies /
--         cars / clients without ON DELETE CASCADE, so clear them first,
--         then the companies (which cascade to cars → rentals). ----
DELETE FROM reservations WHERE car_vin LIKE 'SEEDCAR%';
DELETE FROM companies    WHERE companyid LIKE 'CMP-01%';
DELETE FROM clients      WHERE licenseid LIKE 'SEEDLIC%';

-- ---- 1) Companies (5, across Lebanese cities, with map coordinates) ----
--   x = longitude (east), y = latitude (north)
INSERT INTO companies (companyname, location, companyid, phonenumber, x, y) VALUES
  ('Beirut Auto Rent',   'Beirut',   'CMP-010', '+961-1-345678', 35.5018, 33.8938),
  ('Cedar Cars',         'Tripoli',  'CMP-011', '+961-6-223344', 35.8497, 34.4333),
  ('Phoenicia Rentals',  'Saida',    'CMP-012', '+961-7-556677', 35.3729, 33.5571),
  ('Jounieh Motors',     'Jounieh',  'CMP-013', '+961-9-889900', 35.6178, 33.9808),
  ('Bekaa Wheels',       'Zahle',    'CMP-014', '+961-8-112233', 35.9019, 33.8463);

-- ---- 2) Cars (15) — models repeat on purpose so "Top models" ranks ----
INSERT INTO cars (vin, type, model, color, platenumber, has_gps, company_id)
SELECT v.vin, v.type, v.model, v.color, v.plate, v.gps,
       (SELECT id FROM companies WHERE companyid = v.cmp)
FROM (VALUES
  ('SEEDCAR0000000001','Sedan','Toyota Corolla',  'White', 'SEED-001', TRUE,  'CMP-010'),
  ('SEEDCAR0000000002','Sedan','Hyundai Elantra', 'Black', 'SEED-002', TRUE,  'CMP-010'),
  ('SEEDCAR0000000003','SUV',  'Kia Sportage',    'Grey',  'SEED-003', FALSE, 'CMP-010'),
  ('SEEDCAR0000000004','Sedan','Nissan Sunny',    'Silver','SEED-004', FALSE, 'CMP-011'),
  ('SEEDCAR0000000005','Sedan','Toyota Corolla',  'Blue',  'SEED-005', TRUE,  'CMP-011'),
  ('SEEDCAR0000000006','Sedan','Kia Rio',         'Red',   'SEED-006', FALSE, 'CMP-011'),
  ('SEEDCAR0000000007','Sedan','BMW 320i',        'Black', 'SEED-007', TRUE,  'CMP-012'),
  ('SEEDCAR0000000008','Sedan','Mercedes C200',   'White', 'SEED-008', TRUE,  'CMP-012'),
  ('SEEDCAR0000000009','SUV',  'Toyota RAV4',     'Grey',  'SEED-009', TRUE,  'CMP-012'),
  ('SEEDCAR0000000010','SUV',  'Hyundai Tucson',  'Blue',  'SEED-010', FALSE, 'CMP-013'),
  ('SEEDCAR0000000011','SUV',  'Nissan Patrol',   'Black', 'SEED-011', TRUE,  'CMP-013'),
  ('SEEDCAR0000000012','Sedan','Toyota Corolla',  'Silver','SEED-012', TRUE,  'CMP-013'),
  ('SEEDCAR0000000013','SUV',  'Kia Sportage',    'White', 'SEED-013', FALSE, 'CMP-014'),
  ('SEEDCAR0000000014','Hatch','Renault Clio',    'Red',   'SEED-014', FALSE, 'CMP-014'),
  ('SEEDCAR0000000015','Sedan','Hyundai Elantra', 'Grey',  'SEED-015', TRUE,  'CMP-014')
) AS v(vin, type, model, color, plate, gps, cmp);

-- ---- 3) Clients (12) ----
INSERT INTO clients (personid, name, firstname, lastname, fathername, mothername,
                     nationality, phonenumber, dateofbirth, licenseid, id_type)
VALUES
  ('SEEDPID-01','Ahmad Khalil','Ahmad','Khalil','Khalil','Mariam','Lebanon','+961-70-100001','1992-05-14','SEEDLIC-01','national_id'),
  ('SEEDPID-02','Sara Haddad','Sara','Haddad','Elias','Layla','Lebanon','+961-71-100002','1995-09-22','SEEDLIC-02','national_id'),
  ('SEEDPID-03','Omar Nasser','Omar','Nasser','Nasser','Hala','Syria','+961-76-100003','1988-01-30','SEEDLIC-03','passport'),
  ('SEEDPID-04','Lina Fares','Lina','Fares','Fares','Rana','Lebanon','+961-78-100004','1990-11-12','SEEDLIC-04','national_id'),
  ('SEEDPID-05','Khaled Mansour','Khaled','Mansour','Mansour','Nour','Jordan','+961-70-100005','1985-07-08','SEEDLIC-05','passport'),
  ('SEEDPID-06','Maya Saad','Maya','Saad','Saad','Dina','Lebanon','+961-71-100006','1997-03-19','SEEDLIC-06','national_id'),
  ('SEEDPID-07','Hassan Tarek','Hassan','Tarek','Tarek','Amal','Lebanon','+961-76-100007','1993-12-02','SEEDLIC-07','national_id'),
  ('SEEDPID-08','Rita Khoury','Rita','Khoury','Antoun','Carla','Lebanon','+961-78-100008','1991-06-25','SEEDLIC-08','national_id'),
  ('SEEDPID-09','Ziad Aoun','Ziad','Aoun','Aoun','Sonia','Lebanon','+961-70-100009','1989-08-17','SEEDLIC-09','national_id'),
  ('SEEDPID-10','Nadine Salem','Nadine','Salem','Salem','Hiba','Egypt','+961-71-100010','1996-02-09','SEEDLIC-10','passport'),
  ('SEEDPID-11','Tarek Younes','Tarek','Younes','Younes','Maha','Lebanon','+961-76-100011','1994-10-21','SEEDLIC-11','national_id'),
  ('SEEDPID-12','Carla Daou','Carla','Daou','Daou','Yara','Lebanon','+961-78-100012','1998-04-05','SEEDLIC-12','national_id');

-- ---- 4) Rentals (40) — spread across ~8 months with a mix of
--         Active / Overdue / Returned. Columns in the VALUES table:
--           lic        : client license id
--           vin        : car
--           start_off  : days ago the rental started
--           dur        : rental length in days  (end = start + dur)
--           ret_off    : days-ago it was returned, or NULL if not returned
--         Status that results:
--           ret_off NOT NULL                         -> Returned
--           ret_off NULL and start_off > dur         -> Overdue (ended in past)
--           ret_off NULL and dur >= start_off        -> Active  (ends in future)
INSERT INTO rentals (client_id, car_vin, start_date, end_date, is_active, returned_at)
SELECT
  (SELECT id FROM clients WHERE licenseid = v.lic),
  v.vin,
  (CURRENT_DATE - (v.start_off || ' days')::interval)::date,
  (CURRENT_DATE - (v.start_off || ' days')::interval + (v.dur || ' days')::interval)::date,
  TRUE,
  CASE WHEN v.ret_off IS NULL THEN NULL
       ELSE (CURRENT_DATE - (v.ret_off || ' days')::interval)::timestamp END
FROM (VALUES
  -- ~7 months ago (Returned)
  ('SEEDLIC-01','SEEDCAR0000000001', 215, 10, 203),
  ('SEEDLIC-02','SEEDCAR0000000005', 210, 14, 194),
  ('SEEDLIC-03','SEEDCAR0000000007', 205,  7, 197),
  ('SEEDLIC-04','SEEDCAR0000000010', 200, 21, 178),
  -- ~6 months ago
  ('SEEDLIC-05','SEEDCAR0000000002', 178,  9, 168),
  ('SEEDLIC-06','SEEDCAR0000000012', 172, 12, 159),
  ('SEEDLIC-07','SEEDCAR0000000003', 168,  5, 162),
  ('SEEDLIC-08','SEEDCAR0000000014', 160, 30, 128),
  -- ~5 months ago
  ('SEEDLIC-09','SEEDCAR0000000008', 145, 11, 133),
  ('SEEDLIC-10','SEEDCAR0000000011', 140, 18, 121),
  ('SEEDLIC-11','SEEDCAR0000000001', 135,  6, 128),
  ('SEEDLIC-12','SEEDCAR0000000006', 130, 14, NULL),  -- overdue
  -- ~4 months ago
  ('SEEDLIC-01','SEEDCAR0000000009', 118, 10, 107),
  ('SEEDLIC-02','SEEDCAR0000000013', 112, 25,  86),
  ('SEEDLIC-03','SEEDCAR0000000005', 108,  8, NULL),  -- overdue
  ('SEEDLIC-04','SEEDCAR0000000015', 100, 16,  83),
  -- ~3 months ago
  ('SEEDLIC-05','SEEDCAR0000000007',  92, 12,  79),
  ('SEEDLIC-06','SEEDCAR0000000002',  88,  9, NULL),  -- overdue
  ('SEEDLIC-07','SEEDCAR0000000010',  82, 20,  60),
  ('SEEDLIC-08','SEEDCAR0000000012',  78,  7,  70),
  -- ~2 months ago
  ('SEEDLIC-09','SEEDCAR0000000004',  65, 14,  50),
  ('SEEDLIC-10','SEEDCAR0000000008',  60, 10, NULL),  -- overdue
  ('SEEDLIC-11','SEEDCAR0000000011',  56, 18,  37),
  ('SEEDLIC-12','SEEDCAR0000000001',  52,  6,  45),
  -- ~1 month ago
  ('SEEDLIC-01','SEEDCAR0000000003',  40, 12,  27),
  ('SEEDLIC-02','SEEDCAR0000000009',  35,  9, NULL),  -- overdue
  ('SEEDLIC-03','SEEDCAR0000000014',  32, 15,  16),
  ('SEEDLIC-04','SEEDCAR0000000005',  28,  7,  20),
  -- last few weeks (mix of overdue + active)
  ('SEEDLIC-05','SEEDCAR0000000013',  22, 30, NULL),  -- active (ends in future)
  ('SEEDLIC-06','SEEDCAR0000000007',  18,  5, NULL),  -- overdue
  ('SEEDLIC-07','SEEDCAR0000000002',  15, 21, NULL),  -- active
  ('SEEDLIC-08','SEEDCAR0000000010',  12, 40, NULL),  -- active
  -- current / future-ending (Active)
  ('SEEDLIC-09','SEEDCAR0000000012',   9, 14, NULL),  -- active
  ('SEEDLIC-10','SEEDCAR0000000015',   7, 25, NULL),  -- active
  ('SEEDLIC-11','SEEDCAR0000000008',   5, 10, NULL),  -- active
  ('SEEDLIC-12','SEEDCAR0000000011',   4, 30, NULL),  -- active
  ('SEEDLIC-01','SEEDCAR0000000001',   3,  7, NULL),  -- active
  ('SEEDLIC-02','SEEDCAR0000000004',   2, 14, NULL),  -- active
  ('SEEDLIC-03','SEEDCAR0000000009',   1, 20, NULL),  -- active
  ('SEEDLIC-04','SEEDCAR0000000003',   0, 12, NULL)   -- active
) AS v(lic, vin, start_off, dur, ret_off)
WHERE EXISTS (SELECT 1 FROM clients WHERE licenseid = v.lic);

-- ---- 5) Link clients to the companies they actually rented from
--         (drives the company-user scoping; harmless for admin) ----
INSERT INTO client_companies (client_id, company_id)
SELECT DISTINCT r.client_id, c.company_id
FROM rentals r
JOIN cars c ON c.vin = r.car_vin
WHERE c.vin LIKE 'SEEDCAR%'
ON CONFLICT DO NOTHING;

-- ---- 6) Simulate live GPS fixes for the GPS-equipped cars (what an
--         in-car tracker would report). Offset from the owning company so
--         each car shows out on the road, with a fresh-ish timestamp. ----
UPDATE cars c
   SET gps_lat        = co.y + ((c.id % 5) - 2) * 0.018,
       gps_lng        = co.x + ((c.id % 7) - 3) * 0.018,
       gps_updated_at = NOW() - ((c.id % 25) || ' minutes')::interval
  FROM companies co
 WHERE co.id = c.company_id
   AND c.has_gps = TRUE
   AND c.vin LIKE 'SEEDCAR%';

-- ---- 7) A few reservations (future bookings) across companies, with a
--         mix of statuses so the admin Reservations tab is populated. ----
INSERT INTO reservations (car_vin, client_id, company_id, start_date, end_date, status, created_at)
SELECT v.vin,
       (SELECT id FROM clients WHERE licenseid = v.lic),
       (SELECT company_id FROM cars WHERE vin = v.vin),
       (CURRENT_DATE + (v.s || ' days')::interval)::date,
       (CURRENT_DATE + (v.e || ' days')::interval)::date,
       v.st,
       NOW() - ((v.c) || ' hours')::interval
FROM (VALUES
  ('SEEDCAR0000000003','SEEDLIC-02',  3,  9, 'pending',   2),
  ('SEEDCAR0000000006','SEEDLIC-05',  5, 12, 'pending',  20),
  ('SEEDCAR0000000004','SEEDLIC-07',  1,  6, 'active',   30),
  ('SEEDCAR0000000014','SEEDLIC-10',  8, 15, 'pending',   5),
  ('SEEDCAR0000000013','SEEDLIC-11',  2,  5, 'inactive', 50),
  ('SEEDCAR0000000010','SEEDLIC-03', 10, 18, 'pending',   1)
) AS v(vin, lic, s, e, st, c)
WHERE EXISTS (SELECT 1 FROM clients WHERE licenseid = v.lic)
  AND EXISTS (SELECT 1 FROM cars    WHERE vin = v.vin);

-- ---- 8) A demo company login so the company-user side can be explored:
--         username "demo" / password "demo", bound to Beirut Auto Rent
--         (CMP-010), which has its own cars, clients and rentals. ----
INSERT INTO users (username, password_hash, role, company_id, must_reset_password)
SELECT 'demo', ENCODE(DIGEST('demo', 'sha256'), 'hex'), 'company',
       (SELECT id FROM companies WHERE companyid = 'CMP-010'), FALSE
WHERE EXISTS (SELECT 1 FROM companies WHERE companyid = 'CMP-010')
ON CONFLICT (username) DO UPDATE
   SET company_id = EXCLUDED.company_id,
       password_hash = EXCLUDED.password_hash,
       role = 'company',
       must_reset_password = FALSE;

COMMIT;

-- Quick sanity readout
SELECT 'companies' AS what, COUNT(*) FROM companies WHERE companyid LIKE 'CMP-01%'
UNION ALL SELECT 'cars',     COUNT(*) FROM cars     WHERE vin LIKE 'SEEDCAR%'
UNION ALL SELECT 'clients',  COUNT(*) FROM clients  WHERE licenseid LIKE 'SEEDLIC%'
UNION ALL SELECT 'rentals',  COUNT(*) FROM rentals  WHERE car_vin LIKE 'SEEDCAR%';
