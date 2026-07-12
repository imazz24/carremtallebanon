-- =====================================================
-- BRANCHES DEMO SEED — several Lebanese rental companies, each with
-- many branches, so the admin Companies table shows the grouped /
-- tree branch layout with realistic data and map coordinates.
--
-- Safe to re-run: every company carries the 'BRC-%' companyid prefix;
-- deleting them cascades to their branches (FK ON DELETE CASCADE),
-- then fresh rows are inserted.
--
-- Load (direct, via the venv — DB creds come from backend/.env):
--   backend\.venv\Scripts\python.exe -c "from db import get_conn; \
--     sql=open('seed_branches.sql',encoding='utf-8').read(); \
--     conn=get_conn();  cur=conn.cursor(); cur.execute(sql); conn.commit(); \
--     print('seed loaded')"
-- Or via Docker:
--   docker compose exec -T postgres psql -U postgres -d carrental < backend/seed_branches.sql
-- =====================================================

BEGIN;

-- ---- 0) Clean previous branch-demo companies (cascades to branches) ----
DELETE FROM companies WHERE companyid LIKE 'BRC-%';

-- ---- 1) Companies across Lebanon (x = longitude, y = latitude) ----
INSERT INTO companies (companyname, location, companyid, phonenumber, x, y, owner_name) VALUES
  ('Capital City Rentals',   'Beirut',   'BRC-01', '+961-1-360120', 35.501800, 33.893800, 'Karim Haddad'),
  ('Cedars Rent-a-Car',      'Tripoli',  'BRC-02', '+961-6-431200', 35.849700, 34.433300, 'Rana Saad'),
  ('South Coast Motors',     'Saida',    'BRC-03', '+961-7-720450', 35.372900, 33.557100, 'Elie Mansour'),
  ('Bekaa Valley Cars',      'Zahle',    'BRC-04', '+961-8-810340', 35.901900, 33.846300, 'Nour Fares'),
  ('Mount Lebanon Rentals',  'Jounieh',  'BRC-05', '+961-9-640990', 35.617800, 33.980800, 'Georges Khoury'),
  ('Byblos Prestige Cars',   'Jbeil',    'BRC-06', '+961-9-540220', 35.651900, 34.121100, 'Maya Aoun'),
  ('Nabatieh Wheels',        'Nabatieh', 'BRC-07', '+961-7-762330', 35.483600, 33.378900, 'Hassan Tarek'),
  ('Tyre Riviera Cars',      'Sour',     'BRC-08', '+961-7-345670', 35.193600, 33.270500, 'Layla Younes'),
  ('Lebanon Express Rentals','Beirut',   'BRC-09', '+961-1-999880', 35.509700, 33.888300, 'Ziad Chami');

-- ---- 2) Branches per company (branchname, location, phone, x, y) ----
INSERT INTO branches (company_id, branchname, location, phonenumber, x, y)
SELECT (SELECT id FROM companies WHERE companyid = b.cmp),
       b.branchname, b.location, b.phone, b.x, b.y
FROM (VALUES
  -- Beirut Auto Rentals (8 branches, greater Beirut)
  ('BRC-01','Hamra',           'Hamra',            '+961-1-340111', 35.480900, 33.897500),
  ('BRC-01','Achrafieh',       'Achrafieh',        '+961-1-340112', 35.520000, 33.886900),
  ('BRC-01','Verdun',          'Verdun',           '+961-1-340113', 35.484400, 33.886900),
  ('BRC-01','Dora',            'Dora',             '+961-1-340114', 35.545000, 33.899000),
  ('BRC-01','Hazmieh',         'Hazmieh',          '+961-5-340115', 35.545000, 33.850000),
  ('BRC-01','Jnah',            'Jnah',             '+961-1-340116', 35.490000, 33.870000),
  ('BRC-01','Airport Road',    'Airport Road',     '+961-1-340117', 35.490000, 33.825000),
  ('BRC-01','Ain el Mreisseh', 'Ain el Mreisseh',  '+961-1-340118', 35.493000, 33.902000),
  -- Cedars Rent-a-Car (6 branches, North Lebanon)
  ('BRC-02','El Mina',         'El Mina',          '+961-6-431201', 35.820000, 34.450000),
  ('BRC-02','Zgharta',         'Zgharta',          '+961-6-431202', 35.895000, 34.398300),
  ('BRC-02','Amioun',          'Amioun (Koura)',   '+961-6-431203', 35.810000, 34.300000),
  ('BRC-02','Batroun',         'Batroun',          '+961-6-431204', 35.658100, 34.255300),
  ('BRC-02','Chekka',          'Chekka',           '+961-6-431205', 35.710000, 34.330000),
  ('BRC-02','Halba',           'Halba (Akkar)',    '+961-6-431206', 36.080000, 34.545000),
  -- South Coast Motors (5 branches, South)
  ('BRC-03','Ghazieh',         'Ghazieh',          '+961-7-720451', 35.370000, 33.510000),
  ('BRC-03','Jezzine',         'Jezzine',          '+961-7-720452', 35.585000, 33.543300),
  ('BRC-03','Sarafand',        'Sarafand',         '+961-7-720453', 35.280000, 33.450000),
  ('BRC-03','Anqoun',          'Anqoun',           '+961-7-720454', 35.400000, 33.530000),
  ('BRC-03','Saida Old Town',  'Saida Old Town',   '+961-7-720455', 35.375000, 33.562000),
  -- Bekaa Valley Cars (7 branches, Bekaa)
  ('BRC-04','Chtaura',         'Chtaura',          '+961-8-810341', 35.856400, 33.820600),
  ('BRC-04','Baalbek',         'Baalbek',          '+961-8-810342', 36.218100, 34.005800),
  ('BRC-04','Rayak',           'Rayak',            '+961-8-810343', 35.920000, 33.850000),
  ('BRC-04','Anjar',           'Anjar',            '+961-8-810344', 35.930000, 33.730000),
  ('BRC-04','Bar Elias',       'Bar Elias',        '+961-8-810345', 35.910000, 33.760000),
  ('BRC-04','Taalabaya',       'Taalabaya',        '+961-8-810346', 35.870000, 33.810000),
  ('BRC-04','Jib Jannine',     'Jib Jannine',      '+961-8-810347', 35.770000, 33.630000),
  -- Mount Lebanon Rentals (10 branches)
  ('BRC-05','Zouk Mosbeh',     'Zouk Mosbeh',      '+961-9-640991', 35.610000, 33.970000),
  ('BRC-05','Kaslik',          'Kaslik',           '+961-9-640992', 35.610000, 33.980000),
  ('BRC-05','Antelias',        'Antelias',         '+961-4-640993', 35.590000, 33.914000),
  ('BRC-05','Broummana',       'Broummana',        '+961-4-640994', 35.616700, 33.883300),
  ('BRC-05','Bikfaya',         'Bikfaya',          '+961-4-640995', 35.666700, 33.916700),
  ('BRC-05','Aley',            'Aley',             '+961-5-640996', 35.600000, 33.800000),
  ('BRC-05','Baabda',          'Baabda',           '+961-5-640997', 35.545000, 33.833900),
  ('BRC-05','Beit Mery',       'Beit Mery',        '+961-4-640998', 35.600000, 33.850000),
  ('BRC-05','Dbayeh',          'Dbayeh',           '+961-4-640999', 35.585000, 33.940000),
  ('BRC-05','Jal el Dib',      'Jal el Dib',       '+961-4-641000', 35.583000, 33.920000),
  -- Byblos Prestige Cars (3 branches)
  ('BRC-06','Amchit',          'Amchit',           '+961-9-540221', 35.640000, 34.160000),
  ('BRC-06','Halat',           'Halat',            '+961-9-540222', 35.650000, 34.070000),
  ('BRC-06','Fidar',           'Fidar',            '+961-9-540223', 35.645000, 34.050000),
  -- Nabatieh Wheels (1 branch — shows the singular "1 branch" badge)
  ('BRC-07','Kfar Roummane',   'Kfar Roummane',    '+961-7-762331', 35.490000, 33.360000),
  -- Tyre Riviera Cars (BRC-08) intentionally has NO branches (contrast row)
  -- Lebanon Express Rentals (14 branches — largest, stress-tests the tree layout)
  ('BRC-09','Downtown Beirut',  'Downtown Beirut', '+961-1-999801', 35.505000, 33.895000),
  ('BRC-09','Mar Mikhael',      'Mar Mikhael',     '+961-1-999802', 35.522000, 33.897000),
  ('BRC-09','Gemmayze',         'Gemmayze',        '+961-1-999803', 35.516000, 33.895000),
  ('BRC-09','Badaro',           'Badaro',          '+961-1-999804', 35.515000, 33.877000),
  ('BRC-09','Sin el Fil',       'Sin el Fil',      '+961-1-999805', 35.540000, 33.874000),
  ('BRC-09','Furn el Chebbak',  'Furn el Chebbak', '+961-1-999806', 35.530000, 33.865000),
  ('BRC-09','Bourj Hammoud',    'Bourj Hammoud',   '+961-1-999807', 35.540000, 33.894000),
  ('BRC-09','Mansourieh',       'Mansourieh',      '+961-4-999808', 35.575000, 33.870000),
  ('BRC-09','Rabieh',           'Rabieh',          '+961-4-999809', 35.590000, 33.895000),
  ('BRC-09','Naccache',         'Naccache',        '+961-4-999810', 35.595000, 33.905000),
  ('BRC-09','Zalka',            'Zalka',           '+961-1-999811', 35.570000, 33.905000),
  ('BRC-09','Jdeideh',          'Jdeideh',         '+961-1-999812', 35.555000, 33.895000),
  ('BRC-09','Sodeco',           'Sodeco',          '+961-1-999813', 35.512000, 33.885000),
  ('BRC-09','Ras Beirut',       'Ras Beirut',      '+961-1-999814', 35.478000, 33.900000)
) AS b(cmp, branchname, location, phone, x, y);

COMMIT;

-- Sanity readout: each demo company and its branch count
SELECT co.companyid, co.companyname, COUNT(b.id) AS branches
FROM companies co
LEFT JOIN branches b ON b.company_id = co.id AND b.is_active = TRUE
WHERE co.companyid LIKE 'BRC-%'
GROUP BY co.companyid, co.companyname
ORDER BY co.companyid;
