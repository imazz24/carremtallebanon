/* =====================================================
   DEMO MODE — a whole backend, in the browser
   -----------------------------------------------------
   Lets the app run with NO Flask and NO Postgres so it can be
   shown on a static host (Vercel). Unlike a read-only preview,
   this is a real (if small) database: it seeds sample data, then
   serves and MUTATES it. Adding a car, registering a client,
   taking a booking, moving a status, returning a rental and
   deleting records all work and all persist across reloads.

   How it works:
     1. seeds an in-memory DB shaped like the Postgres schema,
     2. persists it to localStorage (survives reload; reset anytime),
     3. shims fetch() so /api/* is routed against that DB,
     4. auto-signs-in, and offers an Admin <-> Company switcher.

   Scoping is enforced the way the real server does it — the router
   resolves X-Auth-User to a user and scopes on role — so the two
   roles genuinely see different data rather than the same rows
   with buttons hidden.

   ON automatically on *.vercel.app and file://, or with ?demo=1.
   OFF for a real backend, so Docker/production keep their real
   login. Force off with ?demo=0 (or ?live=1).

   Seed shapes must track backend/app.py. SEED_VERSION busts stored
   data when they drift — bump it whenever the seed changes.
   ===================================================== */
(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  let DEMO;
  if (params.get("demo") === "0" || params.get("live") === "1") DEMO = false;
  else if (params.get("demo") === "1") DEMO = true;
  else DEMO = /(^|\.)vercel\.app$/i.test(location.hostname) || location.protocol === "file:";

  if (!DEMO) return;

  const DB_KEY = "carrental.demo.db";
  const ROLE_KEY = "carrental.demo.role";
  const SEED_VERSION = 3;

  /* ---------- dates, relative to today so the demo never goes stale ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
  const iso = (n, h) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    if (h != null) d.setHours(h, 0, 0, 0);
    return d.toISOString();
  };
  const today = () => ymd(new Date());

  /* ================= SEED ================= */
  function seed() {
    const companies = [
      { id: 1, companyname: "Cedars Rent a Car", location: "Beirut — Hamra", companyid: "LB-CR-001", phonenumber: "+961 1 345 678, +961 3 222 333", x: 35.4820, y: 33.8959, logo: null, is_active: true, owner_name: "Karim Haddad" },
      { id: 2, companyname: "Phoenicia Auto Lease", location: "Jounieh — Highway", companyid: "LB-PA-002", phonenumber: "+961 9 911 222", x: 35.6178, y: 33.9808, logo: null, is_active: true, owner_name: "Rana Khalil" },
      { id: 3, companyname: "Litani Cars", location: "Zahle — Boulevard", companyid: "LB-LC-003", phonenumber: "+961 8 800 451", x: 35.9019, y: 33.8463, logo: null, is_active: true, owner_name: "Elie Saad" },
      { id: 4, companyname: "Byblos Drive", location: "Byblos — Old Souk", companyid: "LB-BD-004", phonenumber: "+961 6 740 199", x: 35.6517, y: 34.1232, logo: null, is_active: true, owner_name: "Maya Aoun" },
      { id: 5, companyname: "Tyre Coastal Rentals", location: "Tyre — Marina", companyid: "LB-TC-005", phonenumber: "+961 7 350 770", x: 35.1956, y: 33.2705, logo: null, is_active: true, owner_name: "Hadi Nasr" },
      { id: 6, companyname: "Chouf Mountain Motors", location: "Beiteddine — Main Road", companyid: "LB-CM-006", phonenumber: "+961 5 500 340", x: 35.5800, y: 33.6950, logo: null, is_active: true, owner_name: "Nabil Jaber" },
    ];

    const branches = [
      { id: 11, company_id: 1, branchname: "Hamra", location: "Beirut — Hamra", phonenumber: "+961 1 345 678", x: 35.4820, y: 33.8959, is_active: true, created_at: iso(-400), is_head_office: true },
      { id: 12, company_id: 1, branchname: "Downtown", location: "Beirut — Downtown", phonenumber: "+961 1 999 000", x: 35.5018, y: 33.8938, is_active: true, created_at: iso(-300), is_head_office: false },
      { id: 13, company_id: 1, branchname: "Airport", location: "Beirut — Rafic Hariri Intl", phonenumber: "+961 1 628 000", x: 35.4884, y: 33.8209, is_active: true, created_at: iso(-200), is_head_office: false },
      { id: 14, company_id: 2, branchname: "Jounieh", location: "Jounieh — Highway", phonenumber: "+961 9 911 222", x: 35.6178, y: 33.9808, is_active: true, created_at: iso(-350), is_head_office: true },
      { id: 15, company_id: 2, branchname: "Kaslik", location: "Kaslik — Seaside", phonenumber: "+961 9 644 100", x: 35.6080, y: 33.9760, is_active: true, created_at: iso(-150), is_head_office: false },
      { id: 16, company_id: 4, branchname: "Old Souk", location: "Byblos — Old Souk", phonenumber: "+961 6 740 199", x: 35.6517, y: 34.1232, is_active: true, created_at: iso(-250), is_head_office: true },
    ];

    // color is a hex swatch in this schema (the UI paints a dot from it).
    const C = (id, company_id, branch_id, vin, type, model, color, plate, gps, lat, lng) => ({
      id, vin, type, model, color, platenumber: plate, has_gps: gps,
      company_id, is_active: true,
      gps_lat: gps ? lat : null, gps_lng: gps ? lng : null,
      gps_updated_at: gps ? iso(0) : null,
      edit_count: 0, branch_id,
    });

    const cars = [
      C(101, 1, 11, "1HGCM82633A004352", "Sedan", "Toyota Corolla", "#ffffff", "B 123456", true, 33.8959, 35.4820),
      C(102, 1, 11, "JTDBR32E930015874", "SUV", "Kia Sportage", "#1f2937", "B 224488", true, 33.8890, 35.5010),
      C(103, 1, 12, "WBA3A5C50CF256388", "Sedan", "Hyundai Elantra", "#9ca3af", "B 778899", false, null, null),
      C(104, 1, 12, "1G1ZT51806F109149", "Hatchback", "Peugeot 208", "#dc2626", "B 334455", true, 33.8938, 35.5018),
      C(105, 1, 13, "JN1AZ4EH7DM430123", "SUV", "Nissan Qashqai", "#0f172a", "B 667788", true, 33.8209, 35.4884),
      C(106, 1, 13, "KMHD35LE0EU123987", "Sedan", "Hyundai Accent", "#e5e7eb", "B 445599", false, null, null),
      C(107, 1, null, "WVWZZZ1JZ3W386752", "Van", "VW Transporter", "#f8fafc", "B 990011", true, 33.8700, 35.5100),
      C(108, 1, 11, "2HGFC2F59JH512345", "Sedan", "Honda Civic", "#1d4ed8", "B 552200", true, 33.8965, 35.4805),

      C(109, 2, 14, "1FAFP404X1F178900", "SUV", "Nissan X-Trail", "#b91c1c", "G 553311", true, 33.9808, 35.6178),
      C(110, 2, 14, "2T1BURHE0JC123456", "Sedan", "Toyota Yaris", "#2563eb", "G 110022", false, null, null),
      C(111, 2, 15, "3FADP4EJ5BM108762", "Hatchback", "Ford Fiesta", "#16a34a", "G 774411", true, 33.9760, 35.6080),
      C(112, 2, 15, "JM1BL1SF1A1234567", "Sedan", "Mazda 3", "#111827", "G 220033", true, 33.9770, 35.6090),
      C(113, 2, null, "1N4AL3AP8JC246810", "Van", "Renault Trafic", "#e5e7eb", "G 445566", false, null, null),

      C(114, 3, null, "3VWDX7AJ5DM334455", "Pickup", "Mitsubishi L200", "#111827", "Z 909090", true, 33.8463, 35.9019),
      C(115, 3, null, "JTEBU5JR8A5012345", "SUV", "Toyota Land Cruiser", "#f5f5f4", "Z 313131", true, 33.8500, 35.9100),
      C(116, 3, null, "KL1TD56E49B123456", "Hatchback", "Chevrolet Aveo", "#facc15", "Z 626262", false, null, null),

      C(117, 4, 16, "5YJSA1E26HF200112", "SUV", "Range Rover Evoque", "#374151", "C 121212", true, 34.1232, 35.6517),
      C(118, 4, 16, "WAUZZZ8K9AA123456", "Sedan", "Audi A4", "#0c4a6e", "C 343434", true, 34.1200, 35.6500),
      C(119, 4, null, "VF3CA5FV0DW012345", "Hatchback", "Peugeot 308", "#be123c", "C 565656", false, null, null),

      C(120, 5, null, "1N6AD0EV2CC401234", "Pickup", "Nissan Navara", "#78350f", "T 445566", true, 33.2705, 35.1956),
      C(121, 5, null, "MALA851CBEM123456", "Sedan", "Kia Rio", "#7c3aed", "T 787878", false, null, null),
      C(122, 5, null, "JHMGE8H32DC012345", "Hatchback", "Honda Jazz", "#059669", "T 909191", true, 33.2750, 35.2000),

      C(123, 6, null, "SALVA2AE4EH123456", "SUV", "Land Rover Discovery", "#292524", "S 111222", true, 33.6950, 35.5800),
      C(124, 6, null, "WDB2030421A123456", "Sedan", "Mercedes C200", "#cbd5e1", "S 333444", true, 33.7000, 35.5850),
      C(125, 6, null, "TMBJF25L8C6012345", "Hatchback", "Skoda Fabia", "#0891b2", "S 555666", false, null, null),
      C(126, 6, null, "JTMBFREV0JD123456", "SUV", "Toyota RAV4", "#1e293b", "S 777888", true, 33.6980, 35.5820),
    ];

    const CL = (id, company_id, first, last, father, mother, personid, nat, phone, lic, licEnd, dob) => ({
      id, personid, name: `${first} ${last}`, fathername: father, mothername: mother,
      nationality: nat, phonenumber: phone, dateofbirth: dob, licenseid: lic,
      startdatelicense: day(-2000), enddatelicense: licEnd, company_id,
      photo: null, id_type: nat === "Lebanese" ? "national_id" : "passport",
      is_active: true, firstname: first, lastname: last, edit_count: 0,
    });

    const clients = [
      CL(201, 1, "Nadia", "Fares", "Georges", "Salwa", "LB-9001", "Lebanese", "+961 70 100 200", "DL-552310", day(420), "1991-04-12"),
      CL(202, 1, "Omar", "Cheaib", "Walid", "Layla", "LB-9002", "Lebanese", "+961 71 233 884", "DL-118742", day(120), "1988-11-03"),
      CL(203, 2, "Sophie", "Renard", "Pierre", "Claire", "FR-4410", "French", "+33 6 12 34 56 78", "FR-994120", day(900), "1994-07-22"),
      CL(204, 1, "Bilal", "Hamdan", "Sami", "Mona", "LB-9004", "Lebanese", "+961 76 540 991", "DL-700461", day(35), "1985-02-17"),
      CL(205, 1, "Grace", "Maalouf", "Tony", "Rita", "LB-9005", "Lebanese", "+961 78 220 110", "DL-330218", day(610), "1996-09-30"),
      CL(206, 4, "John", "Carter", "Michael", "Anne", "US-7781", "American", "+1 415 555 0190", "US-CA-44120", day(250), "1979-01-08"),
      CL(207, 1, "Rami", "Khoury", "Antoine", "Nayla", "LB-9007", "Lebanese", "+961 3 447 219", "DL-884412", day(-20), "1990-06-14"),
      CL(208, 2, "Layal", "Nassar", "Fouad", "Hala", "LB-9008", "Lebanese", "+961 70 881 330", "DL-661209", day(540), "1993-12-01"),
      CL(209, 3, "Ziad", "Abou Jaoude", "Michel", "Therese", "LB-9009", "Lebanese", "+961 71 004 556", "DL-229931", day(75), "1982-03-25"),
      CL(210, 1, "Hala", "Saleh", "Marwan", "Rania", "LB-9010", "Lebanese", "+961 76 118 447", "DL-503388", day(310), "1997-05-19"),
      CL(211, 5, "Ahmad", "Zeineddine", "Kassem", "Amal", "LB-9011", "Lebanese", "+961 78 663 021", "DL-771145", day(190), "1986-10-11"),
      CL(212, 6, "Marc", "Dagher", "Joseph", "Carla", "LB-9012", "Lebanese", "+961 3 909 118", "DL-990077", day(430), "1992-08-28"),
      CL(213, 1, "Lina", "Barakat", "Hisham", "Dalia", "LB-9013", "Lebanese", "+961 71 552 003", "DL-118990", day(15), "1999-02-04"),
      CL(214, 4, "Elena", "Rossi", "Marco", "Giulia", "IT-3320", "Italian", "+39 340 118 2244", "IT-556210", day(700), "1995-11-16"),
    ];

    // A client may rent from several companies; this is the junction table.
    const client_companies = [
      { client_id: 201, company_id: 1 }, { client_id: 201, company_id: 4 },
      { client_id: 202, company_id: 1 }, { client_id: 202, company_id: 2 },
      { client_id: 203, company_id: 2 },
      { client_id: 204, company_id: 1 },
      { client_id: 205, company_id: 1 }, { client_id: 205, company_id: 3 },
      { client_id: 206, company_id: 4 }, { client_id: 206, company_id: 5 },
      { client_id: 207, company_id: 1 },
      { client_id: 208, company_id: 2 },
      { client_id: 209, company_id: 3 },
      { client_id: 210, company_id: 1 },
      { client_id: 211, company_id: 5 },
      { client_id: 212, company_id: 6 },
      { client_id: 213, company_id: 1 },
      { client_id: 214, company_id: 4 },
    ];

    let rid = 0;
    const R = (client_id, car_vin, start, end, status, returned, notes, retBranch) => ({
      id: ++rid, client_id, car_vin, start_date: start, end_date: end,
      is_active: true, created_at: iso(-1), returned_at: returned || null,
      return_branch_id: retBranch || null, status, notes: notes || null,
    });

    const rentals = [
      // Cedars (company 1) — the company role's own book, deliberately varied:
      // out now, due today, overdue, returned, pending, cancelled.
      R(201, "1HGCM82633A004352", day(-3), day(2), "active", null, "Airport pickup requested"),
      R(202, "JTDBR32E930015874", day(-1), day(0), "active", null, null),
      R(205, "WBA3A5C50CF256388", day(-7), day(-1), "active", iso(-1, 17), null, 12),
      R(204, "1G1ZT51806F109149", day(-12), day(-2), "active", null, "Not back yet — client called"),
      R(207, "JN1AZ4EH7DM430123", day(-20), day(-9), "active", iso(-9, 11), null, 11),
      R(210, "KMHD35LE0EU123987", day(1), day(6), "pending", null, "Holds the Accent for next week"),
      R(213, "2HGFC2F59JH512345", day(2), day(9), "pending", null, null),
      R(202, "WVWZZZ1JZ3W386752", day(-30), day(-24), "active", iso(-24, 15), null, 11),
      R(201, "1G1ZT51806F109149", day(-45), day(-38), "active", iso(-38, 10), null, 12),
      R(205, "1HGCM82633A004352", day(4), day(8), "cancelled", null, "Client cancelled — found another car"),
      R(204, "JTDBR32E930015874", day(-60), day(-52), "active", iso(-52, 16), null, 11),
      R(207, "WBA3A5C50CF256388", day(-18), day(-14), "active", iso(-14, 9), null, 13),
      R(210, "JN1AZ4EH7DM430123", day(-5), day(1), "active", null, null),
      R(213, "KMHD35LE0EU123987", day(-40), day(-33), "active", iso(-33, 12), null, 11),
      R(201, "2HGFC2F59JH512345", day(-9), day(-3), "active", iso(-3, 14), null, 12),

      // Phoenicia (2)
      R(203, "1FAFP404X1F178900", day(-4), day(3), "active", null, null),
      R(202, "2T1BURHE0JC123456", day(-9), day(0), "active", null, "Due back today"),
      R(208, "3FADP4EJ5BM108762", day(-2), day(5), "active", null, null),
      R(203, "JM1BL1SF1A1234567", day(-25), day(-18), "active", iso(-18, 13), null, 14),
      R(208, "1N4AL3AP8JC246810", day(3), day(7), "pending", null, "Van for a family trip"),
      R(202, "1FAFP404X1F178900", day(-50), day(-44), "active", iso(-44, 11), null, 15),

      // Litani (3)
      R(205, "3VWDX7AJ5DM334455", day(-6), day(4), "active", null, null),
      R(209, "JTEBU5JR8A5012345", day(-14), day(-6), "active", iso(-6, 10), null, null),
      R(209, "KL1TD56E49B123456", day(-2), day(-1), "active", null, "Overdue — chasing"),

      // Byblos (4)
      R(201, "5YJSA1E26HF200112", day(-2), day(6), "active", null, null),
      R(206, "WAUZZZ8K9AA123456", day(-11), day(-4), "active", iso(-4, 15), null, 16),
      R(214, "VF3CA5FV0DW012345", day(0), day(5), "active", null, "Starts today"),
      R(206, "5YJSA1E26HF200112", day(-35), day(-28), "active", iso(-28, 12), null, 16),

      // Tyre (5)
      R(206, "1N6AD0EV2CC401234", day(-15), day(8), "active", null, "Long-term — monthly rate"),
      R(211, "MALA851CBEM123456", day(-8), day(-2), "active", iso(-2, 9), null, null),
      R(211, "JHMGE8H32DC012345", day(2), day(6), "pending", null, null),

      // Chouf (6)
      R(212, "SALVA2AE4EH123456", day(-5), day(2), "active", null, null),
      R(212, "WDB2030421A123456", day(-22), day(-15), "active", iso(-15, 17), null, null),
      R(212, "JTMBFREV0JD123456", day(1), day(4), "pending", null, "Weekend booking"),
    ];

    let sid = 0;
    const S = (company_id, renter, owner, loc, phones, brs, vin, start, end, status, returned, notes) => ({
      id: ++sid, company_id, company_name: renter, location: loc,
      x: null, y: null,
      phone: null, extra_phone: null, branch: null, extra_branch: null,
      car_vins: vin, notes: notes || null, created_at: iso(-(sid * 3)),
      phones, branches: brs, car_vin: vin,
      start_date: start, end_date: end, owner_name: owner,
      edit_count: 0, returned_at: returned || null, return_branch_id: null, status,
    });

    // B2B: `company_name` is the RENTING firm (free text). `company_id` owns the car.
    const special_company_rentals = [
      S(1, "Bank Audi", "Ziad Mansour", "Beirut — Bab Idriss", "+961 1 994 000, +961 3 118 220", "Hamra, Downtown", "1HGCM82633A004352", day(-10), day(20), "active", null, "Executive pool car"),
      S(1, "Murex Trading SAL", "Joseph Rizk", "Beirut — Ashrafieh", "+961 1 200 331", "Downtown", "WVWZZZ1JZ3W386752", day(-40), day(-12), "active", iso(-12, 16), "Van for a delivery contract"),
      S(1, "Zaatar w Zeit", "Fadi Boulos", "Beirut — Sodeco", "+961 1 611 200, +961 70 611 200", "Hamra", "2HGFC2F59JH512345", day(5), day(35), "pending", null, "Fleet trial before a bigger order"),
      S(1, "Cedar Logistics", "Hani Tabet", "Beirut — Port", "+961 1 580 990", "Airport", "JN1AZ4EH7DM430123", day(-3), day(14), "active", null, null),
      S(2, "Holcim Lebanon", "Roger Abi Nader", "Chekka — Plant", "+961 6 540 100", "Jounieh", "JM1BL1SF1A1234567", day(-8), day(12), "active", null, "Site supervisor vehicle"),
      S(2, "Malia Group", "Nadim Chammas", "Jounieh — Ghadir", "+961 9 830 400", "Kaslik", "1N4AL3AP8JC246810", day(-30), day(-20), "active", iso(-20, 14), null),
      S(4, "Byblos Bank", "Sarah Gholam", "Byblos — Jbeil Centre", "+961 6 740 500, +961 3 991 004", "Old Souk", "WAUZZZ8K9AA123456", day(-6), day(24), "active", null, "Branch manager car"),
      S(4, "Aramex Lebanon", "Tarek Fakhoury", "Byblos — Industrial Zone", "+961 6 741 800", "Old Souk", "VF3CA5FV0DW012345", day(8), day(30), "cancelled", null, "Cancelled — budget freeze"),
      S(6, "Alfa Telecom", "Rita Haddad", "Beiteddine — Centre", "+961 5 500 900", "Main", "JTMBFREV0JD123456", day(-2), day(18), "active", null, "Field engineer vehicle"),
    ];

    const users = [
      { id: 1, username: "admin", role: "admin", company_id: null },
      { id: 2, username: "cedars", role: "company", company_id: 1 },
      { id: 3, username: "phoenicia", role: "company", company_id: 2 },
      { id: 4, username: "litani", role: "company", company_id: 3 },
      { id: 5, username: "byblos", role: "company", company_id: 4 },
      { id: 6, username: "tyre", role: "company", company_id: 5 },
      { id: 7, username: "chouf", role: "company", company_id: 6 },
    ];

    let aid = 0;
    const A = (company_id, username, action, entity, detail, hoursAgo, ref) => ({
      id: ++aid, company_id, user_id: null, username, action, entity, detail,
      created_at: new Date(Date.now() - hoursAgo * 3600e3).toISOString(),
      entity_ref: ref || null,
    });

    // Newest last; the router serves this reversed (ORDER BY id DESC).
    const activity_log = [
      A(1, "cedars", "login", "session", "Signed in", 74),
      A(2, "phoenicia", "added", "car", "Mazda 3 — G 220033", 70, "JM1BL1SF1A1234567"),
      A(1, "cedars", "added", "client", "Hala Saleh", 66, "210"),
      A(4, "byblos", "login", "session", "Signed in", 60),
      A(1, "cedars", "created", "rental", "Toyota Corolla — B 123456 → Nadia Fares", 54, "1"),
      A(6, "chouf", "added", "car", "Toyota RAV4 — S 777888", 50, "JTMBFREV0JD123456"),
      A(2, "phoenicia", "edited", "client", "Layal Nassar — phone corrected", 46, "208"),
      A(1, "cedars", "created", "special_rental", "Bank Audi — Toyota Corolla", 40, "1"),
      A(3, "litani", "login", "session", "Signed in", 36),
      A(1, "cedars", "returned", "rental", "Hyundai Elantra — B 778899 → Downtown", 30, "3"),
      A(5, "tyre", "added", "client", "Ahmad Zeineddine", 28, "211"),
      A(1, "cedars", "edited", "car", "Peugeot 208 — colour updated", 26, "1G1ZT51806F109149"),
      A(4, "byblos", "created", "rental", "Range Rover Evoque — C 121212 → Nadia Fares", 22, "25"),
      A(1, "cedars", "logout", "session", "Signed out", 20),
      A(2, "phoenicia", "created", "rental", "Ford Fiesta — G 774411 → Layal Nassar", 18, "18"),
      A(1, "cedars", "login", "session", "Signed in", 12),
      A(1, "cedars", "added", "car", "Honda Civic — B 552200", 10, "2HGFC2F59JH512345"),
      A(6, "chouf", "created", "special_rental", "Alfa Telecom — Toyota RAV4", 9, "9"),
      A(1, "cedars", "status", "rental", "Hyundai Accent — B 445599 → pending", 7, "6"),
      A(4, "byblos", "deleted", "car", "Retired an old Peugeot 308", 6, null),
      A(1, "cedars", "created", "rental", "Nissan Qashqai — B 667788 → Hala Saleh", 5, "13"),
      A(2, "phoenicia", "login", "session", "Signed in", 4),
      A(1, "cedars", "edited", "client", "Lina Barakat — licence renewed", 3, "213"),
      A(5, "tyre", "created", "rental", "Honda Jazz — T 909191 → Ahmad Zeineddine", 2, "31"),
      A(1, "cedars", "added", "branch", "Airport", 1, "13"),
    ];

    return {
      _v: SEED_VERSION,
      companies, branches, cars, clients, client_companies,
      rentals, special_company_rentals, users, activity_log,
      api_keys: {},
      seq: { company: 100, branch: 100, car: 200, client: 300, rental: 100, special: 100, activity: 1000, user: 100 },
    };
  }

  /* ================= STORE ================= */
  let db;
  function load() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed._v === SEED_VERSION) return parsed;
      }
    } catch (e) { /* corrupt or unavailable — reseed */ }
    const fresh = seed();
    try { localStorage.setItem(DB_KEY, JSON.stringify(fresh)); } catch (e) {}
    return fresh;
  }
  function save() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
    catch (e) { console.warn("[demo] could not persist (storage full?)", e); }
  }
  function nextId(kind) { return ++db.seq[kind]; }
  db = load();

  /* ---------- which role to preview ---------- */
  let role = localStorage.getItem(ROLE_KEY);
  if (params.get("role") === "admin" || params.get("role") === "company") {
    role = params.get("role");
    localStorage.setItem(ROLE_KEY, role);
  }
  if (role !== "company") role = "admin";

  const DEMO_USER = role === "company" ? "cedars" : "admin";

  /* ---------- fake a signed-in session (app.js reads these in init()) ---------- */
  function sessionUser(username) {
    const u = db.users.find((x) => x.username === username) || db.users[0];
    const co = u.company_id ? db.companies.find((c) => c.id === u.company_id && c.is_active) : null;
    return {
      id: u.id, username: u.username, role: u.role, company_id: u.company_id,
      must_reset_password: false,
      company: co ? {
        id: co.id, companyname: co.companyname, location: co.location,
        companyid: co.companyid, phonenumber: co.phonenumber,
        x: co.x, y: co.y, logo: co.logo, owner_name: co.owner_name,
      } : null,
    };
  }
  sessionStorage.setItem("carrental.auth", "1");
  sessionStorage.setItem("carrental.auth.user", JSON.stringify(sessionUser(DEMO_USER)));

  /* ================= HELPERS ================= */
  const reply = (data, status = 200) =>
    new Response(status === 204 ? null : JSON.stringify(data),
      { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
  const err = (msg, status = 400, extra) => reply(Object.assign({ error: msg }, extra || {}), status);
  const noContent = () => new Response(null, { status: 204 });

  const byId = (arr, id) => arr.find((x) => String(x.id) === String(id));
  const activeCompany = (id) => db.companies.find((c) => c.id === id && c.is_active);
  const branchOf = (id) => (id == null ? null : db.branches.find((b) => b.id === id));
  const truthy = (v) => ["1", "true", "yes"].includes(String(v || "").toLowerCase());
  const falsy = (v) => ["0", "false", "no"].includes(String(v || "").toLowerCase());
  const norm = (s) => String(s || "").trim().toLowerCase();

  function logAct(user, action, entity, detail, ref) {
    db.activity_log.push({
      id: nextId("activity"),
      company_id: user ? user.company_id : null,
      user_id: user ? user.id : null,
      username: user ? user.username : "system",
      action, entity, detail,
      created_at: new Date().toISOString(),
      entity_ref: ref == null ? null : String(ref),
    });
  }

  // Mirrors backend _current_user(): the header value is a bare username.
  function userFrom(headers) {
    let name = "";
    try {
      if (headers instanceof Headers) name = headers.get("X-Auth-User") || "";
      else if (headers) {
        for (const k in headers) if (k.toLowerCase() === "x-auth-user") name = headers[k];
      }
    } catch (e) {}
    if (!name) return null;
    return db.users.find((u) => u.username.toLowerCase() === norm(name)) || null;
  }

  const carWithNames = (c, withBranch) => {
    const co = db.companies.find((x) => x.id === c.company_id);
    const out = Object.assign({}, c, { companyname: co ? co.companyname : null });
    if (withBranch) {
      const b = branchOf(c.branch_id);
      out.branchname = b ? b.branchname : null;
    }
    return out;
  };

  const clientCompanies = (clientId) =>
    db.client_companies
      .filter((j) => j.client_id === clientId)
      .map((j) => (db.companies.find((c) => c.id === j.company_id) || {}).companyname)
      .filter(Boolean);
  const withCompanies = (cl) => Object.assign({}, cl, { companies: clientCompanies(cl.id) });

  /* ---------- v_client_rentals, derived (the report view) ---------- */
  function clientRentalRows() {
    const out = [];
    for (const r of db.rentals) {
      if (!r.is_active) continue;
      const cl = db.clients.find((c) => c.id === r.client_id && c.is_active);
      if (!cl) continue;
      const car = db.cars.find((c) => c.vin === r.car_vin && c.is_active);
      if (!car) continue;
      const co = activeCompany(car.company_id);
      if (!co) continue;
      const b = branchOf(car.branch_id);
      const rb = branchOf(r.return_branch_id);
      out.push({
        client_id: cl.id, client_name: cl.name, client_father: cl.fathername,
        client_mother: cl.mothername, client_personid: cl.personid,
        client_phone: cl.phonenumber, client_licenseid: cl.licenseid,
        client_nationality: cl.nationality, client_dob: cl.dateofbirth,
        client_photo: cl.photo, client_company_id: cl.company_id,
        company_id: co.id, company_name: co.companyname, company_code: co.companyid,
        company_location: co.location, company_phone: co.phonenumber,
        company_x: co.x, company_y: co.y, company_logo: co.logo,
        car_vin: car.vin, car_model: car.model, car_type: car.type,
        car_color: car.color, car_plate: car.platenumber, car_has_gps: car.has_gps,
        car_branch_id: car.branch_id, car_branch_name: b ? b.branchname : "Main",
        rental_id: r.id, start_date: r.start_date, end_date: r.end_date,
        is_active: true, status: r.status, notes: r.notes,
        returned_at: r.returned_at, return_branch_id: r.return_branch_id,
        return_branch_name: rb ? rb.branchname : null,
      });
    }
    return out;
  }

  // Overlap rule, same as the server: only live bookings block a car.
  function overlapping(vin, start, end, ignoreId) {
    return db.rentals.find((r) =>
      r.car_vin === vin && r.is_active && String(r.id) !== String(ignoreId) &&
      r.returned_at === null && (r.status === "active" || r.status === "pending") &&
      r.start_date <= end && r.end_date >= start);
  }

  const STATUSES = ["active", "pending", "cancelled"];

  const KNOWN_VINS = [
    { vin: "1HGCM82633A004352", type: "Sedan", model: "Toyota Corolla", color: "White" },
    { vin: "JTDBR32E930015874", type: "SUV", model: "Kia Sportage", color: "Black" },
    { vin: "1FAFP404X1F178900", type: "SUV", model: "Nissan X-Trail", color: "Red" },
    { vin: "2T1BURHE0JC123456", type: "Sedan", model: "Toyota Yaris", color: "Blue" },
    { vin: "3VWDX7AJ5DM334455", type: "Pickup", model: "Mitsubishi L200", color: "Black" },
    { vin: "5YJSA1E26HF200112", type: "SUV", model: "Range Rover Evoque", color: "Grey" },
    { vin: "WBA3A5C50CF256388", type: "Sedan", model: "Hyundai Elantra", color: "Silver" },
    { vin: "JN1AZ4EH7DM430123", type: "SUV", model: "Nissan Qashqai", color: "Black" },
    { vin: "WVWZZZ1JZ3W386752", type: "Van", model: "VW Transporter", color: "White" },
    { vin: "2HGFC2F59JH512345", type: "Sedan", model: "Honda Civic", color: "Blue" },
    { vin: "JTEBU5JR8A5012345", type: "SUV", model: "Toyota Land Cruiser", color: "White" },
    { vin: "WAUZZZ8K9AA123456", type: "Sedan", model: "Audi A4", color: "Navy" },
    { vin: "1N6AD0EV2CC401234", type: "Pickup", model: "Nissan Navara", color: "Brown" },
    { vin: "SALVA2AE4EH123456", type: "SUV", model: "Land Rover Discovery", color: "Black" },
    { vin: "WDB2030421A123456", type: "Sedan", model: "Mercedes C200", color: "Silver" },
    { vin: "JTMBFREV0JD123456", type: "SUV", model: "Toyota RAV4", color: "Slate" },
  ];

  /* ================= ROUTER ================= */
  function route(method, rawUrl, init) {
    const p = rawUrl.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    const q = new URLSearchParams(rawUrl.includes("?") ? rawUrl.split("?")[1] : "");
    const headers = (init && init.headers) || {};
    const me = userFrom(headers);
    let body = {};
    try { if (init && typeof init.body === "string") body = JSON.parse(init.body); } catch (e) {}

    const isAdmin = me && me.role === "admin";
    const isCompany = me && me.role === "company";
    const seg = (n) => p.split("/").filter(Boolean)[n];
    const idIn = (re) => { const m = p.match(re); return m ? m[1] : null; };

    /* ---------------- auth ---------------- */
    if (p === "/api/login" && method === "POST") {
      const u = db.users.find((x) => x.username.toLowerCase() === norm(body.username));
      if (!u) return err("Invalid username or password", 401);
      // Demo: any non-empty password is accepted.
      if (!body.password) return err("Missing credentials", 400);
      logAct(u, "login", "session", "Signed in");
      save();
      return reply(sessionUser(u.username));
    }
    if (p === "/api/logout" && method === "POST") {
      if (me) { logAct(me, "logout", "session", "Signed out"); save(); }
      return reply({ ok: true });
    }
    if (p === "/api/change-password" && method === "POST") {
      if (!body.new_password || String(body.new_password).length < 4)
        return err("Password must be at least 4 characters", 400);
      return reply({ ok: true });
    }

    /* ---------------- companies ---------------- */
    if (p === "/api/companies" && method === "GET")
      return reply(db.companies.filter((c) => c.is_active)
        .sort((a, b) => a.companyname.localeCompare(b.companyname)));

    if (p === "/api/companies" && method === "POST") {
      const missing = ["companyname", "location", "companyid"].filter((k) => !body[k]);
      if (missing.length) return err(`Missing: ${JSON.stringify(missing).replace(/"/g, "'")}`, 400);
      const row = {
        id: nextId("company"), companyname: body.companyname, location: body.location,
        companyid: body.companyid, phonenumber: body.phonenumber || null,
        x: body.x != null ? Number(body.x) : null, y: body.y != null ? Number(body.y) : null,
        logo: body.logo || null, is_active: true, owner_name: body.owner_name || null,
      };
      db.companies.push(row);
      logAct(me, "added", "company", row.companyname, row.id);
      save();
      return reply(row, 201);
    }

    if (/^\/api\/companies\/\d+$/.test(p) && method === "PUT") {
      const row = byId(db.companies, idIn(/\/api\/companies\/(\d+)/));
      if (!row || !row.is_active) return err("Not found", 404);
      if (!isAdmin && !(isCompany && me.company_id === row.id)) return err("Not authorized", 403);
      ["companyname", "location", "companyid", "phonenumber", "logo", "owner_name"].forEach((k) => {
        if (k in body) row[k] = body[k];
      });
      if ("x" in body) row.x = body.x != null ? Number(body.x) : null;
      if ("y" in body) row.y = body.y != null ? Number(body.y) : null;
      logAct(me, "edited", "company", row.companyname, row.id);
      save();
      return reply(row);
    }

    if (/^\/api\/companies\/\d+$/.test(p) && method === "DELETE") {
      const row = byId(db.companies, idIn(/\/api\/companies\/(\d+)/));
      if (!row || !row.is_active) return err("Not found", 404);
      row.is_active = false;
      logAct(me, "deleted", "company", row.companyname, row.id);
      save();
      return noContent();
    }

    if (p === "/api/register-company" && method === "POST") {
      if (!isAdmin) return err("Admin only", 403);
      const missing = ["companyname", "username"].filter((k) => !body[k]);
      if (missing.length) return err(`Missing: ${JSON.stringify(missing).replace(/"/g, "'")}`, 400);
      if (db.users.some((u) => u.username.toLowerCase() === norm(body.username)))
        return err(`Username '${body.username}' is already taken`, 409);
      const co = {
        id: nextId("company"), companyname: body.companyname,
        location: body.location || null,
        companyid: body.companyid || `AUTO-${String(body.username).toUpperCase().slice(0, 18)}-${Math.random().toString(16).slice(2, 6)}`,
        phonenumber: body.phonenumber || null,
        x: body.x != null ? Number(body.x) : null, y: body.y != null ? Number(body.y) : null,
        logo: body.logo || null, is_active: true, owner_name: body.owner_name || null,
      };
      db.companies.push(co);
      const user = { id: nextId("user"), username: body.username, role: "company", company_id: co.id };
      db.users.push(user);
      logAct(me, "added", "company", co.companyname, co.id);
      save();
      return reply({ company: co, user: { id: user.id, username: user.username, role: user.role } }, 201);
    }

    /* ---------------- cars ---------------- */
    if (p === "/api/cars" && method === "GET") {
      if (!me) return err("Not authenticated", 401);
      let rows = db.cars.filter((c) => c.is_active);

      const gps = q.get("gps");
      if (truthy(gps)) rows = rows.filter((c) => c.has_gps);
      else if (falsy(gps)) rows = rows.filter((c) => !c.has_gps);

      if (isCompany) {
        rows = rows.filter((c) => c.company_id === me.company_id);
        if (q.get("available")) {
          const from = q.get("from"), to = q.get("to");
          rows = rows.filter((c) => {
            const blocked = db.rentals.some((r) =>
              r.car_vin === c.vin && r.is_active && r.returned_at === null &&
              (r.status === "active" || r.status === "pending") &&
              (from && to ? (r.start_date < to && r.end_date > from)
                          : (r.start_date <= today() && r.end_date >= today())));
            return !blocked;
          });
        }
        return reply(rows.map((c) => carWithNames(c, true))
          .sort((a, b) => String(a.model).localeCompare(String(b.model))));
      }

      if (!isAdmin) return err("Not authorized", 403);

      const search = norm(q.get("search"));
      const matches = (c) => {
        if (!search) return true;
        const co = db.companies.find((x) => x.id === c.company_id);
        const b = branchOf(c.branch_id);
        return [c.vin, c.model, c.type, c.platenumber, co && co.companyname, b && b.branchname]
          .some((v) => norm(v).includes(search));
      };
      if (q.get("vin")) rows = rows.filter((c) => c.vin === q.get("vin"));
      rows = rows.filter(matches);

      const cid = q.get("company_id");
      const pageParam = q.get("page");

      if (pageParam != null) {
        if (cid) rows = rows.filter((c) => String(c.company_id) === String(cid));
        let page = parseInt(pageParam, 10); if (!(page >= 1)) page = 1;
        let size = parseInt(q.get("page_size"), 10);
        if (!(size >= 1 && size <= 100)) size = 25;
        rows.sort((a, b) => {
          const ca = (db.companies.find((x) => x.id === a.company_id) || {}).companyname || "";
          const cb = (db.companies.find((x) => x.id === b.company_id) || {}).companyname || "";
          if (ca !== cb) return ca.localeCompare(cb);
          const ba = (branchOf(a.branch_id) || {}).branchname || "";
          const bb = (branchOf(b.branch_id) || {}).branchname || "";
          if (ba !== bb) return (ba ? 1 : -1) - (bb ? 1 : -1) || ba.localeCompare(bb);
          return String(a.model).localeCompare(String(b.model)) || a.id - b.id;
        });
        const total = rows.length;
        const slice = rows.slice((page - 1) * size, page * size);
        return reply({ rows: slice.map((c) => carWithNames(c, true)), total, page, page_size: size });
      }

      if (cid) {
        rows = rows.filter((c) => String(c.company_id) === String(cid));
        const br = q.get("branch_id");
        if (br != null) {
          if (["", "none", "null", "0"].includes(String(br))) rows = rows.filter((c) => c.branch_id == null);
          else rows = rows.filter((c) => String(c.branch_id) === String(br));
        }
        if (q.get("type")) rows = rows.filter((c) => c.type === q.get("type"));
        if (q.get("model")) rows = rows.filter((c) => c.model === q.get("model"));
        return reply(rows.map((c) => carWithNames(c, true)));
      }
      // Admin, no company_id: no branchname key at all (matches the server).
      return reply(rows.map((c) => carWithNames(c, false)));
    }

    if (p === "/api/cars/summary" && method === "GET") {
      if (!isAdmin) return err("Not authorized", 403);
      let rows = db.cars.filter((c) => c.is_active);
      const gps = q.get("gps");
      if (truthy(gps)) rows = rows.filter((c) => c.has_gps);
      else if (falsy(gps)) rows = rows.filter((c) => !c.has_gps);
      if (q.get("type")) rows = rows.filter((c) => c.type === q.get("type"));
      if (q.get("model")) rows = rows.filter((c) => c.model === q.get("model"));
      const cid = q.get("company_id");
      if (cid && /^\d+$/.test(cid)) rows = rows.filter((c) => String(c.company_id) === cid);
      const search = norm(q.get("search"));
      if (search) {
        rows = rows.filter((c) => {
          const co = db.companies.find((x) => x.id === c.company_id);
          const b = branchOf(c.branch_id);
          return [c.vin, c.model, c.type, c.platenumber, co && co.companyname, b && b.branchname]
            .some((v) => norm(v).includes(search));
        });
      }
      const out = {};
      for (const c of rows) {
        const k = String(c.company_id);
        if (!out[k]) out[k] = { total: 0, unassigned: 0, branches: {} };
        out[k].total++;
        if (c.branch_id == null) out[k].unassigned++;
        else {
          const bk = String(c.branch_id);
          out[k].branches[bk] = (out[k].branches[bk] || 0) + 1;
        }
      }
      return reply({ companies: out });
    }

    if (p === "/api/cars" && method === "POST") {
      const missing = ["vin", "type", "model", "platenumber", "company_id"].filter((k) => !body[k]);
      if (missing.length) return err(`Missing: ${JSON.stringify(missing).replace(/"/g, "'")}`, 400);
      if (isCompany && Number(body.company_id) !== me.company_id) return err("Not authorized", 403);
      const vin = String(body.vin).toUpperCase();
      if (db.cars.some((c) => c.is_active && c.vin.toUpperCase() === vin))
        return reply({ error: "Validation failed", errors: { vin: `VIN '${vin}' is already registered` } }, 409);
      if (db.cars.some((c) => c.is_active && norm(c.platenumber) === norm(body.platenumber)))
        return reply({ error: "Validation failed", errors: { plate_number: `Plate '${body.platenumber}' is already registered` } }, 409);
      const row = {
        id: nextId("car"), vin, type: body.type, model: body.model,
        color: body.color || "#94a3b8", platenumber: String(body.platenumber).trim(),
        has_gps: !!body.has_gps, company_id: Number(body.company_id), is_active: true,
        gps_lat: body.has_gps ? 33.8938 + (Math.random() - 0.5) * 0.3 : null,
        gps_lng: body.has_gps ? 35.5018 + (Math.random() - 0.5) * 0.3 : null,
        gps_updated_at: body.has_gps ? new Date().toISOString() : null,
        edit_count: 0, branch_id: body.branch_id ? Number(body.branch_id) : null,
      };
      db.cars.push(row);
      logAct(me, "added", "car", `${row.model} — ${row.platenumber}`, row.vin);
      save();
      return reply(row, 201);
    }

    if (/^\/api\/cars\/\d+$/.test(p) && method === "PUT") {
      const row = byId(db.cars, idIn(/\/api\/cars\/(\d+)/));
      if (!row || !row.is_active) return err("Not found", 404);
      if (isCompany && row.company_id !== me.company_id) return err("Not authorized", 403);
      const missing = ["type", "model", "color", "platenumber", "company_id"].filter((k) => !body[k]);
      if (missing.length) return err(`Missing: ${JSON.stringify(missing).replace(/"/g, "'")}`, 400);
      if (db.cars.some((c) => c.is_active && c.id !== row.id && norm(c.platenumber) === norm(body.platenumber)))
        return reply({ error: "Validation failed", errors: { plate_number: `Plate '${body.platenumber}' is already registered` } }, 409);
      Object.assign(row, {
        type: body.type, model: body.model, color: body.color,
        platenumber: String(body.platenumber).trim(),
        has_gps: "has_gps" in body ? !!body.has_gps : row.has_gps,
        company_id: Number(body.company_id),
        branch_id: body.branch_id ? Number(body.branch_id) : null,
        edit_count: (row.edit_count || 0) + 1,
      });
      logAct(me, "edited", "car", `${row.model} — ${row.platenumber}`, row.vin);
      save();
      return reply(row);
    }

    if (/^\/api\/cars\/\d+$/.test(p) && method === "DELETE") {
      const row = byId(db.cars, idIn(/\/api\/cars\/(\d+)/));
      if (!row || !row.is_active) return err("Not found", 404);
      row.is_active = false;
      logAct(me, "deleted", "car", `${row.model} — ${row.platenumber}`, row.vin);
      save();
      return noContent();
    }

    /* ---------------- VIN helpers ---------------- */
    if (p === "/api/known-vins" && method === "GET") return reply(KNOWN_VINS);

    if (p === "/api/check-vin" && method === "GET") {
      const vin = String(q.get("vin") || "").toUpperCase();
      if (!vin) return noContent();
      const c = db.cars.find((x) => x.is_active && x.vin.toUpperCase() === vin);
      if (!c) return noContent();
      return reply({
        id: c.id, vin: c.vin, company_id: c.company_id, model: c.model,
        type: c.type, color: c.color, platenumber: c.platenumber, has_gps: c.has_gps,
      });
    }

    if (p === "/api/decode-vin" && method === "GET") {
      const vin = String(q.get("vin") || "").toUpperCase();
      if (vin.length !== 17) return reply({ error: "VIN must be 17 characters", vin }, 400);
      const hit = KNOWN_VINS.find((v) => v.vin === vin);
      return reply({ vin, model: hit ? hit.model : null, type: hit ? hit.type : null });
    }

    /* ---------------- clients ---------------- */
    if (p === "/api/clients" && method === "GET") {
      if (!me) return err("Not authenticated", 401);
      let rows = db.clients.filter((c) => c.is_active);
      if (isCompany) {
        const ids = db.client_companies.filter((j) => j.company_id === me.company_id).map((j) => j.client_id);
        rows = rows.filter((c) => ids.includes(c.id));
      } else if (!isAdmin) return err("Not authorized", 403);
      return reply(rows.sort((a, b) => a.name.localeCompare(b.name)).map(withCompanies));
    }

    if (p === "/api/clients/lookup" && method === "GET") {
      if (!me) return err("Not authenticated", 401);
      const pid = norm(q.get("personid"));
      if (!pid) return err("personid required", 400);
      const c = db.clients.find((x) => x.is_active && norm(x.personid) === pid);
      return c ? reply(withCompanies(c)) : noContent();
    }

    if (p === "/api/clients" && method === "POST") {
      if (!body.licenseid) return err("Missing: ['licenseid']", 400);
      const idType = body.id_type || "national_id";
      if (!body.personid && ["passport", "national_id"].includes(idType))
        return err("personid required for passport / national ID", 400);
      const scopeCo = isCompany ? me.company_id : (body.company_id ? Number(body.company_id) : null);

      const exact = db.clients.find((c) => c.is_active &&
        norm(c.personid) === norm(body.personid) && norm(c.licenseid) === norm(body.licenseid));
      if (exact) {
        if (scopeCo && !db.client_companies.some((j) => j.client_id === exact.id && j.company_id === scopeCo))
          db.client_companies.push({ client_id: exact.id, company_id: scopeCo });
        save();
        return reply(withCompanies(exact), 200);
      }
      const clash = db.clients.find((c) => c.is_active &&
        (norm(c.personid) === norm(body.personid) || norm(c.licenseid) === norm(body.licenseid)));
      if (clash) return err("personid or licenseid is already used by a different client", 409);

      const first = body.firstname || String(body.name || "").split(" ")[0] || "";
      const last = body.lastname || String(body.name || "").split(" ").slice(1).join(" ") || "";
      const row = {
        id: nextId("client"), personid: body.personid || null,
        name: body.name || `${first} ${last}`.trim(),
        fathername: body.fathername || null, mothername: body.mothername || null,
        nationality: body.nationality || null, phonenumber: body.phonenumber || null,
        dateofbirth: body.dateofbirth || null, licenseid: body.licenseid,
        startdatelicense: body.startdatelicense || null,
        enddatelicense: body.enddatelicense || null,
        company_id: scopeCo, photo: body.photo || null, id_type: idType,
        is_active: true, firstname: first, lastname: last, edit_count: 0,
      };
      db.clients.push(row);
      if (scopeCo) db.client_companies.push({ client_id: row.id, company_id: scopeCo });
      logAct(me, "added", "client", row.name, row.id);
      save();
      return reply(withCompanies(row), 201);
    }

    if (/^\/api\/clients\/\d+$/.test(p) && method === "PUT") {
      const row = byId(db.clients, idIn(/\/api\/clients\/(\d+)/));
      if (!row || !row.is_active) return err("Not found", 404);
      if (!body.licenseid) return err("Missing: ['licenseid']", 400);
      if (isCompany && !db.client_companies.some((j) => j.client_id === row.id && j.company_id === me.company_id))
        return err("Not authorized", 403);
      ["personid", "fathername", "mothername", "nationality", "phonenumber",
       "dateofbirth", "licenseid", "startdatelicense", "enddatelicense", "photo", "id_type"]
        .forEach((k) => { if (k in body) row[k] = body[k]; });
      if (body.firstname || body.lastname) {
        row.firstname = body.firstname || row.firstname;
        row.lastname = body.lastname || row.lastname;
        row.name = `${row.firstname} ${row.lastname}`.trim();
      } else if (body.name) row.name = body.name;
      row.edit_count = (row.edit_count || 0) + 1;
      logAct(me, "edited", "client", row.name, row.id);
      save();
      return reply(withCompanies(row));
    }

    if (/^\/api\/clients\/\d+$/.test(p) && method === "DELETE") {
      const row = byId(db.clients, idIn(/\/api\/clients\/(\d+)/));
      if (!row || !row.is_active) return err("Not found", 404);
      if (isCompany) {
        const before = db.client_companies.length;
        db.client_companies = db.client_companies.filter(
          (j) => !(j.client_id === row.id && j.company_id === me.company_id));
        if (db.client_companies.length === before) return err("Not found", 404);
        if (!db.client_companies.some((j) => j.client_id === row.id)) row.is_active = false;
      } else row.is_active = false;
      logAct(me, "deleted", "client", row.name, row.id);
      save();
      return noContent();
    }

    /* ---------------- branches ---------------- */
    if (p === "/api/branches" && method === "GET") {
      let rows = db.branches.filter((b) => b.is_active);
      if (isCompany) rows = rows.filter((b) => b.company_id === me.company_id);
      else if (q.get("company_id")) rows = rows.filter((b) => String(b.company_id) === q.get("company_id"));
      return reply(rows
        .sort((a, b) => (b.is_head_office - a.is_head_office) || a.branchname.localeCompare(b.branchname))
        .map((b) => Object.assign({}, b, {
          companyname: (db.companies.find((c) => c.id === b.company_id) || {}).companyname || null,
        })));
    }

    if (p === "/api/branches" && method === "POST") {
      const cid = isCompany ? me.company_id : Number(body.company_id);
      if (!body.branchname) return err("Missing: ['branchname']", 400);
      const row = {
        id: nextId("branch"), company_id: cid, branchname: body.branchname,
        location: body.location || null, phonenumber: body.phonenumber || null,
        x: body.x != null ? Number(body.x) : null, y: body.y != null ? Number(body.y) : null,
        is_active: true, created_at: new Date().toISOString(),
        is_head_office: !!body.is_head_office,
      };
      if (row.is_head_office)
        db.branches.forEach((b) => { if (b.company_id === cid && b.id !== row.id) b.is_head_office = false; });
      db.branches.push(row);
      logAct(me, "added", "branch", row.branchname, row.id);
      save();
      return reply(row, 201);
    }

    if (/^\/api\/branches\/\d+\/head-office$/.test(p) && method === "PUT") {
      const row = byId(db.branches, idIn(/\/api\/branches\/(\d+)\/head-office/));
      if (!row || !row.is_active) return err("Not found", 404);
      if (isCompany && row.company_id !== me.company_id) return err("Not authorized", 403);
      db.branches.forEach((b) => { if (b.company_id === row.company_id) b.is_head_office = false; });
      row.is_head_office = true;
      logAct(me, "edited", "branch", `${row.branchname} — head office`, row.id);
      save();
      return reply({ id: row.id, is_head_office: true });
    }

    if (/^\/api\/branches\/\d+$/.test(p) && method === "PUT") {
      const row = byId(db.branches, idIn(/\/api\/branches\/(\d+)/));
      if (!row || !row.is_active) return err("Not found", 404);
      if (isCompany && row.company_id !== me.company_id) return err("Not authorized", 403);
      ["branchname", "location", "phonenumber"].forEach((k) => { if (k in body) row[k] = body[k]; });
      if ("x" in body) row.x = body.x != null ? Number(body.x) : null;
      if ("y" in body) row.y = body.y != null ? Number(body.y) : null;
      logAct(me, "edited", "branch", row.branchname, row.id);
      save();
      return reply(row);
    }

    if (/^\/api\/branches\/\d+$/.test(p) && method === "DELETE") {
      const id = idIn(/\/api\/branches\/(\d+)/);
      const row = byId(db.branches, id);
      if (!row) return err("Not found", 404);
      db.branches = db.branches.filter((b) => String(b.id) !== String(id));
      db.cars.forEach((c) => { if (String(c.branch_id) === String(id)) c.branch_id = null; });
      logAct(me, "deleted", "branch", row.branchname, row.id);
      save();
      return noContent();
    }

    /* ---------------- rentals ---------------- */
    if (p === "/api/rentals/report" && method === "GET") {
      if (!me) return err("Not authenticated", 401);
      let rows = clientRentalRows();
      if (isCompany) rows = rows.filter((r) => r.company_id === me.company_id);
      const cid = q.get("client_id");
      if (cid) {
        rows = rows.filter((r) => String(r.client_id) === String(cid));
        rows.sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)));
      } else {
        rows.sort((a, b) => String(a.client_name).localeCompare(String(b.client_name)) ||
                            String(b.start_date).localeCompare(String(a.start_date)));
      }
      return reply(rows);
    }

    if (p === "/api/rentals" && method === "POST") {
      const missing = ["client_id", "car_vin", "start_date", "end_date"].filter((k) => !body[k]);
      if (missing.length) return err(`Missing: ${JSON.stringify(missing).replace(/"/g, "'")}`, 400);
      const car = db.cars.find((c) => c.is_active && c.vin === body.car_vin);
      if (!car) return err("Car not found", 404);
      if (isCompany && car.company_id !== me.company_id)
        return err("You can only rent your own company's cars", 403);
      if (String(body.end_date) < String(body.start_date))
        return err("End date must be on or after the start date", 400);
      const status = body.status || "active";
      if (!STATUSES.includes(status))
        return reply({ error: `Status must be one of: ${STATUSES.join(", ")}`, errors: { status: "Invalid status" } }, 400);
      if (status !== "cancelled") {
        const clash = overlapping(body.car_vin, body.start_date, body.end_date);
        if (clash) {
          const cl = db.clients.find((c) => c.id === clash.client_id);
          const verb = clash.status === "pending" ? "has a pending booking for" : "is already rented to";
          return err(`This car ${verb} ${cl ? cl.name : "another client"} from ${clash.start_date} to ${clash.end_date}`, 409);
        }
      }
      const row = {
        id: nextId("rental"), client_id: Number(body.client_id), car_vin: body.car_vin,
        start_date: body.start_date, end_date: body.end_date, is_active: true,
        created_at: new Date().toISOString(), returned_at: null,
        return_branch_id: null, status, notes: body.notes || null,
      };
      db.rentals.push(row);
      const cl = db.clients.find((c) => c.id === row.client_id);
      if (isCompany && cl && !db.client_companies.some((j) => j.client_id === cl.id && j.company_id === me.company_id))
        db.client_companies.push({ client_id: cl.id, company_id: me.company_id });
      logAct(me, "created", "rental", `${car.model} — ${car.platenumber} → ${cl ? cl.name : "client"}`, row.id);
      save();
      return reply(row, 201);
    }

    if (/^\/api\/rentals\/\d+\/status$/.test(p) && method === "PATCH") {
      const row = byId(db.rentals, idIn(/\/api\/rentals\/(\d+)\/status/));
      const status = body.status;
      if (!status) return reply({ error: "Status is required", errors: { status: "Status is required" } }, 400);
      if (!row || !row.is_active) return err("Rental not found", 404);
      const car = db.cars.find((c) => c.vin === row.car_vin);
      if (isCompany && car && car.company_id !== me.company_id)
        return err("You can only change your own company's bookings", 403);
      if (!STATUSES.includes(status))
        return reply({ error: `Status must be one of: ${STATUSES.join(", ")}`, errors: { status: "Invalid status" } }, 400);
      if (row.status === status)
        return reply({
          id: row.id, car_vin: row.car_vin, status: row.status, start_date: row.start_date,
          end_date: row.end_date, returned_at: row.returned_at,
          company_id: car ? car.company_id : null,
        });
      if (row.returned_at) return err("This car has already been returned", 409);
      if (status !== "cancelled") {
        const clash = overlapping(row.car_vin, row.start_date, row.end_date, row.id);
        if (clash) {
          const cl = db.clients.find((c) => c.id === clash.client_id);
          const verb = clash.status === "pending" ? "has a pending booking for" : "is already rented to";
          return err(`This car ${verb} ${cl ? cl.name : "another client"} from ${clash.start_date} to ${clash.end_date}`, 409);
        }
      }
      row.status = status;
      logAct(me, "status", "rental", `${car ? car.model : "Car"} — ${car ? car.platenumber : ""} → ${status}`, row.id);
      save();
      return reply(row);
    }

    if (/^\/api\/rentals\/\d+\/return$/.test(p) && method === "POST") {
      const row = byId(db.rentals, idIn(/\/api\/rentals\/(\d+)\/return/));
      if (!row || !row.is_active || row.returned_at) return err("Rental not found or already returned", 404);
      const car = db.cars.find((c) => c.vin === row.car_vin);
      if (isCompany && car && car.company_id !== me.company_id) return err("Not authorized", 403);
      row.returned_at = new Date().toISOString();
      const rb = body.return_branch_id ? branchOf(Number(body.return_branch_id)) : null;
      row.return_branch_id = rb && car && rb.company_id === car.company_id ? rb.id : null;
      logAct(me, "returned", "rental", `${car ? car.model : "Car"} — ${car ? car.platenumber : ""}`, row.id);
      save();
      return reply(row);
    }

    if (/^\/api\/rentals\/\d+$/.test(p) && method === "DELETE") {
      const row = byId(db.rentals, idIn(/\/api\/rentals\/(\d+)/));
      if (!row) return err("Not found", 404);
      row.is_active = false;
      logAct(me, "deleted", "rental", `Rental #${row.id}`, row.id);
      save();
      return noContent();
    }

    /* ---------------- special (B2B) rentals ---------------- */
    const csv = (v) => Array.isArray(v) ? v.filter(Boolean).join(", ") : (v || null);

    if (p === "/api/special-rentals" && method === "GET") {
      if (!me) return err("Not authenticated", 401);
      if (!isCompany) return err("Only company users can do this", 403);
      return reply(db.special_company_rentals
        .filter((s) => s.company_id === me.company_id)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))));
    }

    if (p === "/api/admin/special-rentals" && method === "GET") {
      if (!me) return err("Not authenticated", 401);
      if (!isAdmin) return err("Only admins can do this", 403);
      return reply(db.special_company_rentals
        .slice()
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .map((s) => {
          const c = db.cars.find((x) => x.vin === s.car_vin);
          return Object.assign({}, s, {
            model: c ? c.model : null, color: c ? c.color : null,
            platenumber: c ? c.platenumber : null,
            has_gps: c ? c.has_gps : null, type: c ? c.type : null,
          });
        }));
    }

    if (p === "/api/special-rentals" && method === "POST") {
      if (!isCompany) return err("Only company users can do this", 403);
      if (!body.company_name) return err("Missing: ['company_name']", 400);
      const status = body.status || "active";
      if (!STATUSES.includes(status))
        return reply({ error: `Status must be one of: ${STATUSES.join(", ")}`, errors: { status: "Invalid status" } }, 400);
      const row = {
        id: nextId("special"), company_id: me.company_id, company_name: body.company_name,
        location: body.location || null,
        x: body.x != null ? Number(body.x) : null, y: body.y != null ? Number(body.y) : null,
        phone: null, extra_phone: null, branch: null, extra_branch: null,
        car_vins: body.car_vin || null, notes: body.notes || null,
        created_at: new Date().toISOString(),
        phones: csv(body.phones), branches: csv(body.branches),
        car_vin: body.car_vin || null,
        start_date: body.start_date || null, end_date: body.end_date || null,
        owner_name: body.owner_name || null, edit_count: 0,
        returned_at: null, return_branch_id: null, status,
      };
      db.special_company_rentals.push(row);
      logAct(me, "created", "special_rental", `${row.company_name} — ${row.car_vin || ""}`, row.id);
      save();
      return reply(row, 201);
    }

    if (/^\/api\/special-rentals\/\d+$/.test(p) && method === "PUT") {
      const row = byId(db.special_company_rentals, idIn(/\/api\/special-rentals\/(\d+)/));
      if (!row) return err("Not found", 404);
      if (isCompany && row.company_id !== me.company_id) return err("Not authorized", 403);
      if (body.status && !STATUSES.includes(body.status))
        return reply({ error: `Status must be one of: ${STATUSES.join(", ")}`, errors: { status: "Invalid status" } }, 400);
      ["company_name", "location", "notes", "owner_name", "start_date", "end_date", "car_vin"]
        .forEach((k) => { if (k in body) row[k] = body[k]; });
      if ("phones" in body) row.phones = csv(body.phones);
      if ("branches" in body) row.branches = csv(body.branches);
      if ("car_vin" in body) row.car_vins = body.car_vin;
      if ("x" in body) row.x = body.x != null ? Number(body.x) : null;
      if ("y" in body) row.y = body.y != null ? Number(body.y) : null;
      if (body.status) row.status = body.status;
      row.edit_count = (row.edit_count || 0) + 1;
      logAct(me, "edited", "special_rental", row.company_name, row.id);
      save();
      return reply(row);
    }

    if (/^\/api\/special-rentals\/\d+\/status$/.test(p) && method === "PATCH") {
      const row = byId(db.special_company_rentals, idIn(/\/api\/special-rentals\/(\d+)\/status/));
      const status = body.status;
      if (!status) return reply({ error: "Status is required", errors: { status: "Status is required" } }, 400);
      if (!row) return err("Not found", 404);
      // Company-only by design — the admin reads B2B status but cannot move it.
      if (!isCompany || row.company_id !== me.company_id) return err("Not authorized", 403);
      if (!STATUSES.includes(status))
        return reply({ error: `Status must be one of: ${STATUSES.join(", ")}`, errors: { status: "Invalid status" } }, 400);
      if (row.status === status)
        return reply({
          company_id: row.company_id, company_name: row.company_name,
          status: row.status, returned_at: row.returned_at,
        });
      if (row.returned_at) return err("This car has already been returned", 409);
      row.status = status;
      logAct(me, "status", "special_rental", `${row.company_name} → ${status}`, row.id);
      save();
      return reply(row);
    }

    if (/^\/api\/special-rentals\/\d+$/.test(p) && method === "DELETE") {
      const id = idIn(/\/api\/special-rentals\/(\d+)/);
      const row = byId(db.special_company_rentals, id);
      if (!row) return err("Not found", 404);
      if (isCompany && row.company_id !== me.company_id) return err("Not authorized", 403);
      db.special_company_rentals = db.special_company_rentals.filter((s) => String(s.id) !== String(id));
      logAct(me, "deleted", "special_rental", row.company_name, row.id);
      save();
      return noContent();
    }

    /* ---------------- admin: audit ---------------- */
    if (p === "/api/admin/audit-log" && method === "GET") {
      if (!isAdmin) return err("Not authorized", 403);
      let limit = parseInt(q.get("limit"), 10);
      if (!(limit >= 1 && limit <= 200)) limit = 40;
      let rows = db.activity_log.slice().sort((a, b) => b.id - a.id);
      const before = q.get("before_id");
      if (before) rows = rows.filter((r) => r.id < Number(before));
      if (q.get("company_id")) rows = rows.filter((r) => String(r.company_id) === q.get("company_id"));
      if (q.get("action")) rows = rows.filter((r) => r.action === q.get("action"));
      if (q.get("entity")) rows = rows.filter((r) => r.entity === q.get("entity"));
      const term = norm(q.get("q"));
      if (term) {
        rows = rows.filter((r) => {
          const co = db.companies.find((c) => c.id === r.company_id);
          return [r.detail, r.username, co && co.companyname].some((v) => norm(v).includes(term));
        });
      }
      const items = rows.slice(0, limit).map((r) => ({
        id: r.id, company_id: r.company_id,
        companyname: (db.companies.find((c) => c.id === r.company_id) || {}).companyname || null,
        username: r.username, action: r.action, entity: r.entity,
        detail: r.detail, ref: r.entity_ref, created_at: r.created_at,
      }));
      return reply({ items, next_cursor: items.length === limit ? items[items.length - 1].id : null });
    }

    if (p === "/api/admin/audit-stats" && method === "GET") {
      if (!isAdmin) return err("Not authorized", 403);
      const since = Date.now() - 24 * 3600e3;
      const recent = db.activity_log.filter((r) => new Date(r.created_at).getTime() >= since);
      const n = (f) => recent.filter(f).length;
      return reply({
        events: recent.length,
        logins: n((r) => r.action === "login"),
        logouts: n((r) => r.action === "logout"),
        created: n((r) => ["added", "created"].includes(r.action)),
        edits: n((r) => ["edited", "status"].includes(r.action)),
        deletes: n((r) => r.action === "deleted"),
        companies: new Set(recent.map((r) => r.company_id).filter((x) => x != null)).size,
      });
    }

    if (p === "/api/admin/active-rentals" && method === "GET") {
      if (!isAdmin) return err("Not authorized", 403);
      return reply(clientRentalRows()
        .filter((r) => r.returned_at === null)
        .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)))
        .slice(0, 1000)
        .map((r) => ({
          rental_id: r.rental_id, client_id: r.client_id, client_name: r.client_name,
          client_father: r.client_father, client_mother: r.client_mother,
          client_personid: r.client_personid, client_nationality: r.client_nationality,
          client_dob: r.client_dob, client_phone: r.client_phone,
          client_licenseid: r.client_licenseid, client_photo: r.client_photo,
          company_id: r.company_id, company_name: r.company_name,
          company_code: r.company_code, company_phone: r.company_phone,
          company_location: r.company_location, company_x: r.company_x, company_y: r.company_y,
          car_vin: r.car_vin, car_model: r.car_model, car_type: r.car_type,
          car_color: r.car_color, car_plate: r.car_plate, car_has_gps: r.car_has_gps,
          start_date: r.start_date, end_date: r.end_date, status: r.status,
        })));
    }

    /* ---------------- company alerts ---------------- */
    if (p === "/api/company/alerts" && method === "GET") {
      if (!me) return err("Not authenticated", 401);
      if (!isCompany) return err("Only company users can do this", 403);
      const t = today();
      const mine = (vin) => {
        const c = db.cars.find((x) => x.vin === vin);
        return c && c.company_id === me.company_id ? c : null;
      };

      const indiv = db.rentals
        .filter((r) => r.is_active && r.status === "active" && !r.returned_at && mine(r.car_vin) && r.end_date <= t)
        .sort((a, b) => String(a.end_date).localeCompare(String(b.end_date)))
        .map((r) => {
          const c = mine(r.car_vin), cl = db.clients.find((x) => x.id === r.client_id);
          return {
            id: r.id, kind: "individual", who: cl ? cl.name : "—",
            car_model: c.model, car_plate: c.platenumber, car_vin: c.vin,
            end_date: r.end_date, overdue: r.end_date < t,
          };
        });

      const b2b = db.special_company_rentals
        .filter((s) => s.company_id === me.company_id && s.status === "active" && !s.returned_at && s.end_date && s.end_date <= t)
        .sort((a, b) => String(a.end_date).localeCompare(String(b.end_date)))
        .map((s) => {
          const c = db.cars.find((x) => x.vin === s.car_vin);
          return {
            id: s.id, kind: "company", who: s.company_name,
            car_model: c ? c.model : null, car_plate: c ? c.platenumber : null,
            car_vin: s.car_vin, end_date: s.end_date, overdue: s.end_date < t,
          };
        });

      const items = indiv.concat(b2b);
      const overdue = items.filter((i) => i.overdue).length;

      const resItems = db.rentals
        .filter((r) => r.is_active && r.status === "pending" && mine(r.car_vin) && r.start_date <= t)
        .map((r) => {
          const c = mine(r.car_vin), cl = db.clients.find((x) => x.id === r.client_id);
          return {
            id: r.id, client_name: cl ? cl.name : "—", client_phone: cl ? cl.phonenumber : null,
            car_model: c.model, car_plate: c.platenumber,
            start_date: r.start_date, end_date: r.end_date, late: r.start_date < t,
          };
        });

      return reply({
        returns_due: { overdue, today: items.length - overdue, total: items.length, items },
        reservations_today: { count: resItems.length, items: resItems },
      });
    }

    /* ---------------- reports: reservations (pending rentals) ---------------- */
    if (p === "/api/reports/reservations" && method === "GET") {
      if (!me) return err("Not authenticated", 401);
      const cid = isCompany ? me.company_id : Number(q.get("company_id"));
      if (!cid) return err("company_id required", 400);
      return reply(db.rentals
        .filter((r) => {
          const c = db.cars.find((x) => x.vin === r.car_vin);
          return r.is_active && r.status === "pending" && c && c.company_id === cid;
        })
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .map((r) => {
          const c = db.cars.find((x) => x.vin === r.car_vin);
          const cl = db.clients.find((x) => x.id === r.client_id);
          const b = branchOf(c.branch_id);
          return {
            id: r.id, car_vin: r.car_vin, client_id: r.client_id,
            start_date: r.start_date, end_date: r.end_date, status: r.status,
            notes: r.notes, created_at: r.created_at,
            client_name: cl ? cl.name : null, client_phone: cl ? cl.phonenumber : null,
            car_model: c.model, car_plate: c.platenumber,
            car_branch_id: c.branch_id, car_branch_name: b ? b.branchname : "Main",
          };
        }));
    }

    /* ---------------- dashboard ---------------- */
    if (p === "/api/dashboard-activity" && method === "GET") {
      if (!isAdmin) return err("Not authorized", 403);
      const since = Date.now() - 24 * 3600e3;
      return reply(db.companies.filter((c) => c.is_active).map((c) => {
        const u = db.users.find((x) => x.company_id === c.id);
        const acts = db.activity_log.filter((a) => a.company_id === c.id);
        const recent = acts.filter((a) => new Date(a.created_at).getTime() >= since);
        const last = acts.length ? acts.reduce((m, a) => (a.created_at > m ? a.created_at : m), acts[0].created_at) : null;
        const logins = acts.filter((a) => a.action === "login");
        const lastLogin = logins.length ? logins[logins.length - 1].created_at : null;
        const cnt = (e) => recent.filter((a) => a.entity === e).length;
        return {
          id: c.id, companyname: c.companyname, phonenumber: c.phonenumber,
          location: c.location, owner_name: c.owner_name,
          username: u ? u.username : null,
          last_login: lastLogin, last_activity: last,
          has_activity: acts.length > 0,
          rentals_24h: cnt("rental"),
          reservations_24h: recent.filter((a) => a.entity === "rental" && /pending/.test(a.detail || "")).length,
          cars_24h: cnt("car"), clients_24h: cnt("client"),
          active_24h: !!last && new Date(last).getTime() >= since,
        };
      }));
    }

    if (p === "/api/inactive-companies" && method === "GET") {
      if (!isAdmin) return err("Not authorized", 403);
      const now = Date.now();
      return reply(db.companies.filter((c) => c.is_active).map((c) => {
        const u = db.users.find((x) => x.company_id === c.id);
        const acts = db.activity_log.filter((a) => a.company_id === c.id);
        const last = acts.length ? acts.reduce((m, a) => (a.created_at > m ? a.created_at : m), acts[0].created_at) : null;
        const logins = acts.filter((a) => a.action === "login");
        const lastLogin = logins.length ? logins[logins.length - 1].created_at : null;
        const hours = Math.floor((now - (last ? new Date(last).getTime() : now - 400 * 3600e3)) / 3600e3);
        return {
          id: c.id, companyname: c.companyname, phonenumber: c.phonenumber,
          location: c.location, owner_name: c.owner_name, username: u ? u.username : null,
          last_login: lastLogin, has_activity: acts.length > 0,
          hours_inactive: hours, days_inactive: Math.floor(hours / 24),
        };
      }).filter((r) => r.hours_inactive >= 72)
        .sort((a, b) => b.hours_inactive - a.hours_inactive));
    }

    if (/^\/api\/company-activity\/\d+$/.test(p) && method === "GET") {
      if (!isAdmin) return err("Not authorized", 403);
      const cid = Number(idIn(/\/api\/company-activity\/(\d+)/));
      return reply(db.activity_log
        .filter((a) => a.company_id === cid)
        .sort((a, b) => b.id - a.id)
        .slice(0, 200)
        .map((a) => ({
          action: a.action, entity: a.entity, detail: a.detail,
          ref: a.entity_ref, username: a.username, created_at: a.created_at,
        })));
    }

    /* ---------------- api keys ---------------- */
    if (p === "/api/api-key") {
      const cid = isCompany ? me.company_id
        : Number(body.company_id || q.get("company_id") || 0);
      if (!me) return err("Not authenticated", 401);
      if (!cid) return err("company_id required", 400);
      if (method === "GET") {
        const k = db.api_keys[cid];
        return reply(k ? { has_key: true, prefix: k.prefix, created_at: k.created_at } : { has_key: false });
      }
      if (method === "POST") {
        const raw = "crk_" + Array.from({ length: 43 }, () =>
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[Math.floor(Math.random() * 64)]).join("");
        db.api_keys[cid] = { prefix: raw.slice(0, 12), created_at: new Date().toISOString() };
        save();
        return reply({
          api_key: raw, prefix: raw.slice(0, 12),
          note: "Store this now — it is shown only once. Send it as 'Authorization: Bearer <key>' on batch requests.",
        }, 201);
      }
      if (method === "DELETE") { delete db.api_keys[cid]; save(); return noContent(); }
    }

    /* ---------------- support ---------------- */
    if (p === "/api/support" && method === "POST")
      return reply({ ok: true, message: "Support request received. We will get back to you soon." });

    /* ---------------- fallbacks ---------------- */
    if (method !== "GET") return reply({ ok: true });
    return reply([]);
  }

  /* ================= FETCH SHIM ================= */
  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      if (/\/api\//.test(url)) {
        const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
        let opts = init;
        // A Request object carries its own headers/body; normalise to init-shape.
        if (!opts && input && typeof input !== "string") opts = { headers: input.headers };
        let res;
        try { res = route(method, url, opts || {}); }
        catch (e) {
          console.error("[demo] route error", method, url, e);
          res = new Response(JSON.stringify({ error: "Internal server error — please retry shortly." }),
            { status: 500, headers: { "Content-Type": "application/json" } });
        }
        return Promise.resolve(res);
      }
    } catch (e) { /* fall through to the network */ }
    return realFetch(input, init);
  };

  /* ================= DEMO BAR ================= */
  function mountBar() {
    if (document.getElementById("demo-switcher")) return;
    const bar = document.createElement("div");
    bar.id = "demo-switcher";
    bar.innerHTML = `
      <span class="demo-switcher-label">Demo</span>
      <button type="button" data-demo-role="admin"${role === "admin" ? ' class="active"' : ""}>Admin</button>
      <button type="button" data-demo-role="company"${role === "company" ? ' class="active"' : ""}>Company</button>
      <span class="demo-sep"></span>
      <button type="button" data-demo-reset title="Delete every change and restore the sample data">Reset data</button>`;
    const css = document.createElement("style");
    css.textContent = `
      /* Reserve a strip under the page so a fixed bar never covers the footer,
         a pager, or the last card of a stacked-card table. Phones stack every
         table into full-width cards, so the bottom of the page is content. */
      body{padding-bottom:calc(70px + env(safe-area-inset-bottom, 0px));}

      #demo-switcher{position:fixed;left:50%;
        bottom:calc(12px + env(safe-area-inset-bottom, 0px));
        transform:translateX(-50%);
        /* Under the login overlay (200) and every modal (300), so it can never
           cover a dialog's action buttons — it did at 99999, and that bites
           hardest on a phone, where the modal fills the screen and .modal-foot
           puts Save/Cancel full-width at the bottom. Still above the sticky
           header (50) and the nav drawer (60). */
        z-index:90;
        display:flex;align-items:center;gap:4px;
        box-sizing:border-box;max-width:calc(100vw - 16px);
        padding:6px 8px;
        background:rgba(17,24,39,.92);color:#fff;
        border:1px solid rgba(255,255,255,.10);border-radius:999px;
        box-shadow:0 8px 30px rgba(0,0,0,.35);font:600 13px/1 system-ui,sans-serif;
        -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);}
      /* The drawer owns the screen while it's open; a pill floating over its
         backdrop reads as a stray control. */
      body.nav-open #demo-switcher{opacity:0;pointer-events:none;}
      #demo-switcher .demo-switcher-label{padding:0 6px;opacity:.7;font-weight:600;
        letter-spacing:.02em;text-transform:uppercase;font-size:11px;flex:0 0 auto;}
      #demo-switcher .demo-sep{width:1px;height:18px;flex:0 0 auto;
        background:rgba(255,255,255,.18);margin:0 4px;}
      #demo-switcher button{border:0;cursor:pointer;padding:7px 14px;border-radius:999px;
        background:transparent;color:#cbd5e1;font:inherit;transition:.15s;
        white-space:nowrap;flex:0 1 auto;}
      #demo-switcher button:hover{color:#fff;background:rgba(255,255,255,.08);}
      #demo-switcher button.active{background:#2563eb;color:#fff;}
      #demo-switcher button[data-demo-reset]:hover{background:#b91c1c;color:#fff;}

      /* Phones: the pill was ~350px of content on a 320-360px screen, so it
         overflowed and scrolled the page sideways; its buttons were also 27px
         tall against the app's own 42px touch-target rule. Drop the decorative
         label, tighten the gaps, grow the targets. */
      @media (max-width: 560px){
        #demo-switcher{gap:2px;padding:5px 6px;font-size:12px;}
        #demo-switcher .demo-switcher-label{display:none;}
        #demo-switcher .demo-sep{margin:0 2px;}
        #demo-switcher button{padding:0 12px;min-height:40px;}
      }
      @media print{#demo-switcher{display:none;}}`;
    document.head.appendChild(css);
    bar.addEventListener("click", (e) => {
      const reset = e.target.closest("[data-demo-reset]");
      if (reset) {
        if (!confirm("Reset the demo?\n\nEverything you added or changed will be deleted and the original sample data restored.")) return;
        localStorage.removeItem(DB_KEY);
        location.reload();
        return;
      }
      const b = e.target.closest("[data-demo-role]");
      if (!b || b.dataset.demoRole === role) return;
      localStorage.setItem(ROLE_KEY, b.dataset.demoRole);
      location.reload();
    });
    document.body.appendChild(bar);
  }

  if (document.body) mountBar();
  else document.addEventListener("DOMContentLoaded", mountBar);

  console.info(
    `[demo] Sample data served from localStorage — role: ${role} (${DEMO_USER}). ` +
    `Changes persist and are yours alone. Reset from the bar, or ?demo=0 to disable.`);
})();
