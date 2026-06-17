/* =====================================================
   DESIGN-PREVIEW / DEMO MODE  (frontend-only, no backend)
   -----------------------------------------------------
   Lets the site run with NO login and NO Flask backend so the
   design can be viewed on a static host (e.g. Vercel). It:
     1. seeds a fake signed-in user (admin or company),
     2. shims fetch() so every /api/* call returns sample data,
     3. adds a floating switcher to flip Admin <-> Company.

   It turns ON automatically on *.vercel.app and file://, or with
   ?demo=1, and stays OFF for a real backend (so production/Docker,
   which serves this same frontend, keeps its real login). Force it
   off with ?demo=0 (or ?live=1).
   ===================================================== */
(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  let DEMO;
  if (params.get("demo") === "0" || params.get("live") === "1") DEMO = false;
  else if (params.get("demo") === "1") DEMO = true;
  else DEMO = /(^|\.)vercel\.app$/i.test(location.hostname) || location.protocol === "file:";

  if (!DEMO) return;

  /* ---------- which role to preview ---------- */
  const ROLE_KEY = "carrental.demo.role";
  let role = localStorage.getItem(ROLE_KEY);
  if (params.get("role") === "admin" || params.get("role") === "company") {
    role = params.get("role");
    localStorage.setItem(ROLE_KEY, role);
  }
  if (role !== "company") role = "admin";

  /* ---------- date helpers (relative to today) ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
  const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };

  /* ---------- the company the "company" user owns ---------- */
  const MY = {
    id: 1,
    companyname: "Cedars Rent a Car",
    owner_name: "Karim Haddad",
    location: "Beirut — Hamra",
    companyid: "LB-CR-001",
    phonenumber: "+961 1 345 678, +961 3 222 333",
    x: 35.4955, y: 33.8959, logo: null,
  };

  /* ---------- fake authenticated user ---------- */
  const user = role === "company"
    ? { role: "company", username: "cedars", company_id: MY.id, company: { ...MY } }
    : { role: "admin", username: "admin" };

  // app.js reads these in init() before anything renders.
  sessionStorage.setItem("carrental.auth", "1");
  sessionStorage.setItem("carrental.auth.user", JSON.stringify(user));

  /* ================= SAMPLE DATA ================= */
  const companies = [
    MY,
    { id: 2, companyname: "Phoenicia Auto Lease", owner_name: "Rana Khalil", location: "Jounieh — Highway", companyid: "LB-PA-002", phonenumber: "+961 9 911 222", x: 35.6178, y: 33.9808, logo: null },
    { id: 3, companyname: "Litani Cars", owner_name: "Elie Saad", location: "Zahle — Boulevard", companyid: "LB-LC-003", phonenumber: "+961 8 800 451", x: 35.9019, y: 33.8463, logo: null },
    { id: 4, companyname: "Byblos Drive", owner_name: "Maya Aoun", location: "Byblos — Old Souk", companyid: "LB-BD-004", phonenumber: "+961 6 740 199", x: 35.6517, y: 34.1232, logo: null },
    { id: 5, companyname: "Tyre Coastal Rentals", owner_name: "Hadi Nasr", location: "Tyre — Marina", companyid: "LB-TC-005", phonenumber: "+961 7 350 770", x: 35.1956, y: 33.2705, logo: null },
  ];
  const cName = (id) => (companies.find((c) => c.id === id) || {}).companyname || "";

  const branches = [
    { id: 11, company_id: 1, location: "Beirut — Downtown", phonenumber: "+961 1 999 000", x: 35.5018, y: 33.8938 },
    { id: 12, company_id: 2, location: "Kaslik — Seaside", phonenumber: "+961 9 644 100", x: 35.6080, y: 33.9760 },
  ];

  const cars = [
    { id: 101, company_id: 1, companyname: cName(1), vin: "1HGCM82633A004352", type: "Sedan", model: "Toyota Corolla", color: "#ffffff", platenumber: "B 123456", has_gps: true },
    { id: 102, company_id: 1, companyname: cName(1), vin: "JTDBR32E930015874", type: "SUV", model: "Kia Sportage", color: "#1f2937", platenumber: "B 224488", has_gps: true },
    { id: 103, company_id: 1, companyname: cName(1), vin: "WBA3A5C50CF256388", type: "Sedan", model: "Hyundai Elantra", color: "#9ca3af", platenumber: "B 778899", has_gps: false },
    { id: 104, company_id: 2, companyname: cName(2), vin: "1FAFP404X1F178900", type: "SUV", model: "Nissan X-Trail", color: "#b91c1c", platenumber: "G 553311", has_gps: true },
    { id: 105, company_id: 2, companyname: cName(2), vin: "2T1BURHE0JC123456", type: "Sedan", model: "Toyota Yaris", color: "#2563eb", platenumber: "G 110022", has_gps: false },
    { id: 106, company_id: 3, companyname: cName(3), vin: "3VWDX7AJ5DM334455", type: "Pickup", model: "Mitsubishi L200", color: "#111827", platenumber: "Z 909090", has_gps: true },
    { id: 107, company_id: 4, companyname: cName(4), vin: "5YJSA1E26HF200112", type: "SUV", model: "Range Rover Evoque", color: "#374151", platenumber: "C 121212", has_gps: true },
    { id: 108, company_id: 5, companyname: cName(5), vin: "1N4AL3AP8JC246810", type: "Van", model: "Renault Trafic", color: "#e5e7eb", platenumber: "T 445566", has_gps: false },
  ];

  const clients = [
    { id: 201, name: "Nadia Fares", firstname: "Nadia", lastname: "Fares", fathername: "Georges", mothername: "Salwa", personid: "LB-9001", nationality: "Lebanese", phonenumber: "+961 70 100 200", licenseid: "DL-552310", enddatelicense: day(420), photo: null },
    { id: 202, name: "Omar Cheaib", firstname: "Omar", lastname: "Cheaib", fathername: "Walid", mothername: "Layla", personid: "LB-9002", nationality: "Lebanese", phonenumber: "+961 71 233 884", licenseid: "DL-118742", enddatelicense: day(120), photo: null },
    { id: 203, name: "Sophie Renard", firstname: "Sophie", lastname: "Renard", fathername: "Pierre", mothername: "Claire", personid: "FR-4410", nationality: "French", phonenumber: "+33 6 12 34 56 78", licenseid: "FR-994120", enddatelicense: day(900), photo: null },
    { id: 204, name: "Bilal Hamdan", firstname: "Bilal", lastname: "Hamdan", fathername: "Sami", mothername: "Mona", personid: "LB-9004", nationality: "Lebanese", phonenumber: "+961 76 540 991", licenseid: "DL-700461", enddatelicense: day(35), photo: null },
    { id: 205, name: "Grace Maalouf", firstname: "Grace", lastname: "Maalouf", fathername: "Tony", mothername: "Rita", personid: "LB-9005", nationality: "Lebanese", phonenumber: "+961 78 220 110", licenseid: "DL-330218", enddatelicense: day(610), photo: null },
    { id: 206, name: "John Carter", firstname: "John", lastname: "Carter", fathername: "Michael", mothername: "Anne", personid: "US-7781", nationality: "American", phonenumber: "+1 415 555 0190", licenseid: "US-CA-44120", enddatelicense: day(250), photo: null },
  ];

  // Rentals report. Cedars (company_id 1) rows are spread across recent days
  // so the company Report/Returns/Calendar tabs are well populated.
  let rid = 0;
  const rental = (o) => Object.assign({
    rental_id: ++rid,
    returned_at: null,
    car_has_gps: true,
  }, o);

  const report = [
    rental({ company_id: 1, company_name: cName(1), company_phone: "+961 1 345 678", company_location: "Beirut — Hamra", client_name: "Nadia Fares", client_father: "Georges", client_phone: "+961 70 100 200", client_licenseid: "DL-552310", car_model: "Toyota Corolla", car_type: "Sedan", car_plate: "B 123456", car_vin: "1HGCM82633A004352", start_date: day(-3), end_date: day(2) }),
    rental({ company_id: 1, company_name: cName(1), company_phone: "+961 1 345 678", company_location: "Beirut — Hamra", client_name: "Omar Cheaib", client_father: "Walid", client_phone: "+961 71 233 884", client_licenseid: "DL-118742", car_model: "Kia Sportage", car_type: "SUV", car_plate: "B 224488", car_vin: "JTDBR32E930015874", start_date: day(-1), end_date: day(0) }),
    rental({ company_id: 1, company_name: cName(1), company_phone: "+961 1 345 678", company_location: "Beirut — Hamra", client_name: "Grace Maalouf", client_father: "Tony", client_phone: "+961 78 220 110", client_licenseid: "DL-330218", car_model: "Hyundai Elantra", car_type: "Sedan", car_plate: "B 778899", car_has_gps: false, car_vin: "WBA3A5C50CF256388", start_date: day(-7), end_date: day(-1) }),
    rental({ company_id: 1, company_name: cName(1), company_phone: "+961 1 345 678", company_location: "Beirut — Hamra", client_name: "Bilal Hamdan", client_father: "Sami", client_phone: "+961 76 540 991", client_licenseid: "DL-700461", car_model: "Toyota Corolla", car_type: "Sedan", car_plate: "B 123456", car_vin: "1HGCM82633A004352", start_date: day(-12), end_date: day(5) }),
    rental({ company_id: 1, company_name: cName(1), company_phone: "+961 1 345 678", company_location: "Beirut — Hamra", client_name: "John Carter", client_father: "Michael", client_phone: "+1 415 555 0190", client_licenseid: "US-CA-44120", car_model: "Kia Sportage", car_type: "SUV", car_plate: "B 224488", car_vin: "JTDBR32E930015874", start_date: day(-20), end_date: day(9) }),
    rental({ company_id: 2, company_name: cName(2), company_phone: "+961 9 911 222", company_location: "Jounieh — Highway", client_name: "Sophie Renard", client_father: "Pierre", client_phone: "+33 6 12 34 56 78", client_licenseid: "FR-994120", car_model: "Nissan X-Trail", car_type: "SUV", car_plate: "G 553311", car_vin: "1FAFP404X1F178900", start_date: day(-4), end_date: day(3) }),
    rental({ company_id: 2, company_name: cName(2), company_phone: "+961 9 911 222", company_location: "Jounieh — Highway", client_name: "Omar Cheaib", client_father: "Walid", client_phone: "+961 71 233 884", client_licenseid: "DL-118742", car_model: "Toyota Yaris", car_type: "Sedan", car_plate: "G 110022", car_has_gps: false, car_vin: "2T1BURHE0JC123456", start_date: day(-9), end_date: day(1) }),
    rental({ company_id: 3, company_name: cName(3), company_phone: "+961 8 800 451", company_location: "Zahle — Boulevard", client_name: "Grace Maalouf", client_father: "Tony", client_phone: "+961 78 220 110", client_licenseid: "DL-330218", car_model: "Mitsubishi L200", car_type: "Pickup", car_plate: "Z 909090", car_vin: "3VWDX7AJ5DM334455", start_date: day(-6), end_date: day(4) }),
    rental({ company_id: 4, company_name: cName(4), company_phone: "+961 6 740 199", company_location: "Byblos — Old Souk", client_name: "Nadia Fares", client_father: "Georges", client_phone: "+961 70 100 200", client_licenseid: "DL-552310", car_model: "Range Rover Evoque", car_type: "SUV", car_plate: "C 121212", car_vin: "5YJSA1E26HF200112", start_date: day(-2), end_date: day(6) }),
    rental({ company_id: 5, company_name: cName(5), company_phone: "+961 7 350 770", company_location: "Tyre — Marina", client_name: "John Carter", client_father: "Michael", client_phone: "+1 415 555 0190", client_licenseid: "US-CA-44120", car_model: "Renault Trafic", car_type: "Van", car_plate: "T 445566", car_has_gps: false, car_vin: "1N4AL3AP8JC246810", start_date: day(-15), end_date: day(8) }),
  ];

  // Reservations. Company view shows them unscoped, so for the company
  // preview keep them all on Cedars; admin sees a multi-company spread.
  const resAll = [
    { id: 301, company_id: 1, companyname: cName(1), client_name: "Nadia Fares", client_phone: "+961 70 100 200", car_model: "Toyota Corolla", car_plate: "B 123456", start_date: day(0), end_date: day(3), created_at: iso(-1), status: "pending" },
    { id: 302, company_id: 1, companyname: cName(1), client_name: "Bilal Hamdan", client_phone: "+961 76 540 991", car_model: "Kia Sportage", car_plate: "B 224488", start_date: day(2), end_date: day(6), created_at: iso(0), status: "pending" },
    { id: 303, company_id: 1, companyname: cName(1), client_name: "Grace Maalouf", client_phone: "+961 78 220 110", car_model: "Hyundai Elantra", car_plate: "B 778899", start_date: day(-1), end_date: day(4), created_at: iso(-2), status: "active" },
    { id: 304, company_id: 1, companyname: cName(1), client_name: "Omar Cheaib", client_phone: "+961 71 233 884", car_model: "Toyota Corolla", car_plate: "B 123456", start_date: day(5), end_date: day(8), created_at: iso(-3), status: "inactive" },
    { id: 305, company_id: 2, companyname: cName(2), client_name: "Sophie Renard", client_phone: "+33 6 12 34 56 78", car_model: "Nissan X-Trail", car_plate: "G 553311", start_date: day(1), end_date: day(5), created_at: iso(0), status: "pending" },
    { id: 306, company_id: 4, companyname: cName(4), client_name: "Nadia Fares", client_phone: "+961 70 100 200", car_model: "Range Rover Evoque", car_plate: "C 121212", start_date: day(3), end_date: day(7), created_at: iso(-1), status: "pending" },
  ];
  const reservations = role === "company" ? resAll.filter((r) => r.company_id === MY.id) : resAll;

  const dashActivity = companies.map((c, i) => ({
    id: c.id,
    companyname: c.companyname,
    phonenumber: c.phonenumber,
    location: c.location,
    owner_name: c.owner_name,
    username: c.companyname.toLowerCase().split(" ")[0],
    active_24h: i < 3,
    has_activity: i < 4,
    cars_24h: [2, 1, 0, 1, 0][i] || 0,
    clients_24h: [3, 0, 1, 0, 0][i] || 0,
    rentals_24h: [2, 1, 1, 0, 0][i] || 0,
    reservations_24h: [4, 1, 0, 1, 0][i] || 0,
    last_login: i < 4 ? iso(-(i)) : null,
  }));

  const inactive = [
    { companyname: cName(5), owner_name: "Hadi Nasr", phonenumber: "+961 7 350 770", location: "Tyre — Marina", username: "tyre", days_inactive: 6, hours_inactive: 152, last_login: iso(-6), has_activity: false },
    { companyname: cName(4), owner_name: "Maya Aoun", phonenumber: "+961 6 740 199", location: "Byblos — Old Souk", username: "byblos", days_inactive: 3, hours_inactive: 74, last_login: iso(-3), has_activity: true },
  ];

  const knownVins = [
    { vin: "1HGCM82633A004352", model: "Toyota Corolla", type: "Sedan", color: "White" },
    { vin: "JTDBR32E930015874", model: "Kia Sportage", type: "SUV", color: "Black" },
    { vin: "1FAFP404X1F178900", model: "Nissan X-Trail", type: "SUV", color: "Red" },
    { vin: "2T1BURHE0JC123456", model: "Toyota Yaris", type: "Sedan", color: "Blue" },
    { vin: "3VWDX7AJ5DM334455", model: "Mitsubishi L200", type: "Pickup", color: "Black" },
    { vin: "5YJSA1E26HF200112", model: "Range Rover Evoque", type: "SUV", color: "Grey" },
  ];

  const companyActivity = [
    { action: "added", entity: "car", detail: "Toyota Corolla — B 123456", username: "cedars", created_at: iso(0) },
    { action: "added", entity: "client", detail: "Nadia Fares", username: "cedars", created_at: iso(-1) },
    { action: "created", entity: "rental", detail: "Kia Sportage", username: "cedars", created_at: iso(-1) },
  ];

  /* ================= FETCH SHIM ================= */
  const reply = (data, status = 200) =>
    new Response(status === 204 ? null : JSON.stringify(data),
      { status, headers: { "Content-Type": "application/json" } });

  function route(method, path) {
    const p = path.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    const q = path.includes("?") ? new URLSearchParams(path.split("?")[1]) : new URLSearchParams();

    // ----- writes: just acknowledge so the UI flashes success -----
    if (method !== "GET") {
      if (/\/api\/api-key$/.test(p) && method === "DELETE") return reply(null, 204);
      if (/\/api\/api-key$/.test(p)) return reply({ api_key: "demo_sk_live_8f2a1c9b4e7d6f30", prefix: "demo_sk", created_at: iso(0) });
      if (/\/api\/login$/.test(p)) return reply(user);
      if (/\/api\/reservations\/\d+$/.test(p)) return reply({ ok: true });
      if (/\/api\/rentals\/\d+\/return$/.test(p)) return reply({ ok: true });
      if (/\/api\/register-company$/.test(p)) return reply({ ok: true, id: 99, username: "newco", temp_password: "demo1234" });
      return reply({ ok: true });
    }

    // ----- reads -----
    if (/\/api\/companies$/.test(p)) return reply(companies);
    if (/\/api\/cars$/.test(p)) {
      const cid = q.get("company_id");
      return reply(cid ? cars.filter((c) => String(c.company_id) === String(cid)) : cars);
    }
    if (/\/api\/clients\/lookup$/.test(p)) {
      const pid = (q.get("personid") || "").toLowerCase();
      return reply(clients.find((c) => String(c.personid).toLowerCase() === pid) || null);
    }
    if (/\/api\/clients$/.test(p)) return reply(clients);
    if (/\/api\/branches$/.test(p)) return reply(branches);
    if (/\/api\/rentals\/report$/.test(p)) return reply(report);
    if (/\/api\/reservations$/.test(p)) return reply(reservations);
    if (/\/api\/dashboard-activity$/.test(p)) return reply(dashActivity);
    if (/\/api\/inactive-companies$/.test(p)) return reply(inactive);
    if (/\/api\/company-activity\/\d+$/.test(p)) return reply(companyActivity);
    if (/\/api\/known-vins$/.test(p)) return reply(knownVins);
    if (/\/api\/api-key$/.test(p)) return reply({ has_key: false });
    if (/\/api\/check-vin$/.test(p)) {
      const vin = (q.get("vin") || "").toUpperCase();
      const hit = knownVins.find((v) => v.vin === vin);
      return reply(hit ? { exists: false, known: hit } : { exists: false });
    }
    if (/\/api\/decode-vin$/.test(p)) {
      const vin = (q.get("vin") || "").toUpperCase();
      return reply(knownVins.find((v) => v.vin === vin) || { model: "", type: "", color: "" });
    }
    // Unknown GET → empty list keeps render code happy.
    return reply([]);
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
      if (/\/api\//.test(url)) return Promise.resolve(route(method, url));
    } catch (e) { /* fall through to network */ }
    return realFetch(input, init);
  };

  /* ================= ROLE SWITCHER UI ================= */
  function mountSwitcher() {
    if (document.getElementById("demo-switcher")) return;
    const bar = document.createElement("div");
    bar.id = "demo-switcher";
    bar.innerHTML = `
      <span class="demo-switcher-label">Demo preview</span>
      <button type="button" data-demo-role="admin"${role === "admin" ? ' class="active"' : ""}>Admin</button>
      <button type="button" data-demo-role="company"${role === "company" ? ' class="active"' : ""}>Company</button>`;
    const css = document.createElement("style");
    css.textContent = `
      #demo-switcher{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);
        z-index:99999;display:flex;align-items:center;gap:6px;padding:6px 8px;
        background:rgba(17,24,39,.92);color:#fff;border-radius:999px;
        box-shadow:0 8px 30px rgba(0,0,0,.35);font:600 13px/1 system-ui,sans-serif;
        backdrop-filter:blur(6px);}
      #demo-switcher .demo-switcher-label{padding:0 6px;opacity:.7;font-weight:600;
        letter-spacing:.02em;text-transform:uppercase;font-size:11px;}
      #demo-switcher button{border:0;cursor:pointer;padding:7px 14px;border-radius:999px;
        background:transparent;color:#cbd5e1;font:inherit;transition:.15s;}
      #demo-switcher button:hover{color:#fff;background:rgba(255,255,255,.08);}
      #demo-switcher button.active{background:#2563eb;color:#fff;}
      @media print{#demo-switcher{display:none;}}`;
    document.head.appendChild(css);
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-demo-role]");
      if (!b) return;
      const next = b.dataset.demoRole;
      if (next === role) return;
      localStorage.setItem(ROLE_KEY, next);
      location.reload();
    });
    document.body.appendChild(bar);
  }

  if (document.body) mountSwitcher();
  else document.addEventListener("DOMContentLoaded", mountSwitcher);

  console.info(`[demo] Frontend design preview active — role: ${role}. Append ?demo=0 to disable.`);
})();
