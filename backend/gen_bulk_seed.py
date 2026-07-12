"""
Generate a LARGE demo dataset — many Lebanese rental companies, each with many
branches — so the admin Companies table can be seen at real scale (collapse +
search + pagination). Writes seed_bulk.sql.

Re-runnable: every company carries the 'DEMO-%' companyid prefix; the SQL first
deletes those (cascading to their branches) then reinserts.

Run:  backend\.venv\Scripts\python.exe gen_bulk_seed.py
Load: docker exec -i carrental-postgres psql -U postgres -d carrental < backend/seed_bulk.sql
"""
import random

random.seed(42)  # reproducible output

# Real Lebanese towns/areas with approximate (lon, lat).
TOWNS = [
    ("Hamra", 35.4809, 33.8975), ("Achrafieh", 35.5200, 33.8869),
    ("Verdun", 35.4844, 33.8869), ("Dora", 35.5450, 33.8990),
    ("Hazmieh", 35.5450, 33.8500), ("Jnah", 35.4900, 33.8700),
    ("Ras Beirut", 35.4780, 33.9000), ("Gemmayze", 35.5160, 33.8950),
    ("Mar Mikhael", 35.5220, 33.8970), ("Badaro", 35.5150, 33.8770),
    ("Sin el Fil", 35.5400, 33.8740), ("Furn el Chebbak", 35.5300, 33.8650),
    ("Bourj Hammoud", 35.5400, 33.8940), ("Jdeideh", 35.5550, 33.8950),
    ("Zalka", 35.5700, 33.9050), ("Antelias", 35.5900, 33.9140),
    ("Dbayeh", 35.5850, 33.9400), ("Jal el Dib", 35.5830, 33.9200),
    ("Zouk Mosbeh", 35.6100, 33.9700), ("Kaslik", 35.6100, 33.9800),
    ("Jounieh", 35.6178, 33.9808), ("Jbeil", 35.6519, 34.1211),
    ("Amchit", 35.6400, 34.1600), ("Batroun", 35.6581, 34.2553),
    ("Chekka", 35.7100, 34.3300), ("Tripoli", 35.8497, 34.4333),
    ("El Mina", 35.8200, 34.4500), ("Zgharta", 35.8950, 34.3983),
    ("Amioun", 35.8100, 34.3000), ("Halba", 36.0800, 34.5450),
    ("Baabda", 35.5450, 33.8339), ("Aley", 35.6000, 33.8000),
    ("Bhamdoun", 35.6600, 33.7900), ("Broummana", 35.6167, 33.8833),
    ("Bikfaya", 35.6667, 33.9167), ("Beit Mery", 35.6000, 33.8500),
    ("Mansourieh", 35.5750, 33.8700), ("Rabieh", 35.5900, 33.8950),
    ("Chtaura", 35.8564, 33.8206), ("Zahle", 35.9019, 33.8463),
    ("Baalbek", 36.2181, 34.0058), ("Rayak", 35.9200, 33.8500),
    ("Anjar", 35.9300, 33.7300), ("Bar Elias", 35.9100, 33.7600),
    ("Jib Jannine", 35.7700, 33.6300), ("Saida", 35.3729, 33.5571),
    ("Ghazieh", 35.3700, 33.5100), ("Jezzine", 35.5850, 33.5433),
    ("Sarafand", 35.2800, 33.4500), ("Sour", 35.1936, 33.2705),
    ("Nabatieh", 35.4836, 33.3789), ("Kfar Roummane", 35.4900, 33.3600),
    ("Marjeyoun", 35.5900, 33.3600), ("Bint Jbeil", 35.4300, 33.1200),
]

CITIES = ["Beirut", "Tripoli", "Saida", "Zahle", "Jounieh", "Jbeil",
          "Nabatieh", "Sour", "Baabda", "Aley", "Batroun", "Baalbek"]

NAME_A = ["Cedar", "Phoenician", "Mediterranean", "Levant", "Prestige", "Royal",
          "Capital", "Coastal", "Summit", "Horizon", "Elite", "Metropolitan",
          "Golden", "Star", "Union", "National", "Premier", "Riviera", "Atlas",
          "Orient", "Crystal", "Diamond", "Continental", "Pioneer", "Skyline"]
NAME_B = ["Auto Rentals", "Car Hire", "Rent-a-Car", "Motors", "Wheels",
          "Drive", "Fleet", "Cars", "Rentals", "Auto Lease"]

FIRST = ["Karim", "Rana", "Elie", "Nour", "Georges", "Maya", "Hassan", "Layla",
         "Ziad", "Rita", "Fadi", "Dana", "Marwan", "Carla", "Samir", "Yara",
         "Tarek", "Nadia", "Rami", "Lina", "Bassam", "Joelle", "Wissam", "Hala"]
LAST = ["Haddad", "Saad", "Mansour", "Fares", "Khoury", "Aoun", "Tarek",
        "Younes", "Chami", "Nassar", "Gerges", "Sleiman", "Rahme", "Daou",
        "Karam", "Sfeir", "Abdallah", "Hobeika", "Ghanem", "Zeidan"]

N_COMPANIES = 45

used_names = set()
def company_name(i):
    while True:
        n = f"{random.choice(NAME_A)} {random.choice(NAME_B)}"
        if n not in used_names:
            used_names.add(n)
            return n

def esc(s):  # SQL-escape single quotes
    return s.replace("'", "''")

companies = []
branch_rows = []
for i in range(1, N_COMPANIES + 1):
    cid = f"DEMO-{i:03d}"
    name = company_name(i)
    city = random.choice(CITIES)
    owner = f"{random.choice(FIRST)} {random.choice(LAST)}"
    ln = 35.1 + random.random() * 1.1
    lt = 33.1 + random.random() * 1.4
    phone = f"+961-{random.randint(1,9)}-{random.randint(300,899)}{random.randint(100,999)}"
    companies.append((esc(name), esc(city), cid, phone, round(ln, 6), round(lt, 6), esc(owner)))

    # Varied branch counts: a realistic mix, a few big, a few with none.
    n_branches = random.choices(
        [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 15],
        weights=[6, 10, 14, 16, 14, 12, 8, 7, 5, 3, 2])[0]
    picks = random.sample(TOWNS, min(n_branches, len(TOWNS)))
    for j, (tname, tln, tlt) in enumerate(picks, 1):
        bphone = f"+961-{random.randint(1,9)}-{random.randint(300,899)}{random.randint(100,999)}"
        branch_rows.append((cid, esc(tname), esc(tname), bphone, tln, tlt))

lines = []
lines.append("-- =====================================================")
lines.append("-- BULK DEMO SEED — many Lebanese companies, each with many branches.")
lines.append(f"-- {N_COMPANIES} companies / {len(branch_rows)} branches. Generated by gen_bulk_seed.py.")
lines.append("-- Re-runnable: DEMO-% companies are deleted (cascade) then reinserted.")
lines.append("-- Load: docker exec -i carrental-postgres psql -U postgres -d carrental < backend/seed_bulk.sql")
lines.append("-- =====================================================")
lines.append("BEGIN;")
lines.append("DELETE FROM companies WHERE companyid LIKE 'DEMO-%';")
lines.append("INSERT INTO companies (companyname, location, companyid, phonenumber, x, y, owner_name) VALUES")
vals = [f"  ('{c[0]}', '{c[1]}', '{c[2]}', '{c[3]}', {c[4]}, {c[5]}, '{c[6]}')" for c in companies]
lines.append(",\n".join(vals) + ";")
lines.append("")
lines.append("INSERT INTO branches (company_id, branchname, location, phonenumber, x, y)")
lines.append("SELECT (SELECT id FROM companies WHERE companyid = b.cmp),")
lines.append("       b.branchname, b.location, b.phone, b.x, b.y")
lines.append("FROM (VALUES")
bvals = [f"  ('{b[0]}', '{b[1]}', '{b[2]}', '{b[3]}', {b[4]}, {b[5]})" for b in branch_rows]
lines.append(",\n".join(bvals))
lines.append(") AS b(cmp, branchname, location, phone, x, y);")
lines.append("COMMIT;")
lines.append("")
lines.append("SELECT co.companyid, co.companyname, COUNT(b.id) AS branches")
lines.append("FROM companies co LEFT JOIN branches b ON b.company_id = co.id")
lines.append("WHERE co.companyid LIKE 'DEMO-%'")
lines.append("GROUP BY co.companyid, co.companyname ORDER BY branches DESC, co.companyid;")

with open("seed_bulk.sql", "w", encoding="utf-8") as f:
    f.write("\n".join(lines))

print(f"wrote seed_bulk.sql — {N_COMPANIES} companies, {len(branch_rows)} branches")
