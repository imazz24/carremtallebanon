/* =====================================================
   Car Rental — Frontend application logic
   Talks to the Flask backend on /api/*
===================================================== */

const API = (() => {
  // Same-origin when served by Flask; falls back to localhost:5000 in dev.
  const base = (location.port === "5000" || location.protocol === "file:")
    ? `${location.protocol}//${location.hostname || "localhost"}:5000`
    : "";
  const url = (p) => `${base}${p}`;
  const json = (r) => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error || r.statusText); });

  return {
    url,
    listCompanies: () => fetch(url("/api/companies")).then(json),
    addCompany:    (b) => fetch(url("/api/companies"), { method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify(b)}).then(json),

    listCars:      (companyId) => fetch(url("/api/cars" + (companyId ? `?company_id=${companyId}` : ""))).then(json),
    addCar:        (b) => fetch(url("/api/cars"),      { method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify(b)}).then(json),

    listClients:   () => fetch(url("/api/clients"), { headers: authHeaders() }).then(json),
    addClient:     (b) => fetch(url("/api/clients"),   { method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify(b)}).then(json),

    listBranches:  () => fetch(url("/api/branches")).then(json),

    addRental:     (b) => fetch(url("/api/rentals"),   { method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify(b)}).then(json),
    report:        () => fetch(url("/api/rentals/report")).then(json),
  };
})();

/* ------- in-memory state ------- */
const state = {
  companies: [],
  cars: [],
  clients: [],
  report: [],
  branches: [],
};

/* ------- helpers ------- */
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const escape = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function toast(msg, kind="success"){
  const el = $("#toast");
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.classList.remove("show"); el.hidden = true; }, 2400);
}

function fillSelect(select, items, valueKey, labelFn, includePlaceholder=true){
  const cur = select.value;
  select.innerHTML = "";
  if (includePlaceholder){
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = t("select.placeholder");
    opt.disabled = true; opt.selected = true;
    select.appendChild(opt);
  }
  items.forEach(it => {
    const opt = document.createElement("option");
    opt.value = it[valueKey];
    opt.textContent = labelFn(it);
    select.appendChild(opt);
  });
  if (cur) select.value = cur;
}

function emptyRow(table, cols){
  const tb = table.tBodies[0];
  tb.innerHTML = `<tr class="empty-row"><td colspan="${cols}">${escape(t("table.empty"))}</td></tr>`;
}

/* ============== PAGINATION ============== */
const Pager = (() => {
  const _state = {};

  function _get(key){
    if (!_state[key]) _state[key] = { page: 1, size: 10 };
    return _state[key];
  }

  function reset(key){ const s = _get(key); s.page = 1; }

  function slice(key, rows){
    const s = _get(key);
    const total = Math.ceil(rows.length / s.size) || 1;
    if (s.page > total) s.page = total;
    const start = (s.page - 1) * s.size;
    return { rows: rows.slice(start, start + s.size), page: s.page, total, allCount: rows.length, size: s.size };
  }

  function render(key, topSel, bottomSel, info, onPageChange){
    const topEl = $(topSel);
    const btmEl = $(bottomSel);
    const hide = info.allCount <= 10;

    // Top: page-size selector + total count
    if (topEl){
      if (hide){ topEl.innerHTML = ""; topEl.hidden = true; }
      else {
        topEl.hidden = false;
        topEl.innerHTML = `
          <div class="pager-top">
            <div class="pager-size">
              <span class="pager-size-label">${escape(t("pager.show"))}</span>
              <select class="pager-size-select">
                <option value="10" ${info.size === 10 ? "selected" : ""}>10</option>
                <option value="25" ${info.size === 25 ? "selected" : ""}>25</option>
              </select>
              <span class="pager-size-label">${escape(t("pager.perPage"))}</span>
            </div>
            <div class="pager-info">${info.allCount} ${info.allCount === 1 ? t("report.result") : t("report.results")}</div>
          </div>`;
        const sizeSel = topEl.querySelector(".pager-size-select");
        if (sizeSel){
          sizeSel.addEventListener("change", () => {
            const s = _get(key);
            s.size = Number(sizeSel.value);
            s.page = 1;
            onPageChange();
          });
        }
      }
    }

    // Bottom: page navigation
    if (btmEl){
      if (hide || info.total <= 1){ btmEl.innerHTML = ""; btmEl.hidden = true; }
      else {
        btmEl.hidden = false;
        const pages = [];
        const maxVisible = 5;
        let startP = Math.max(1, info.page - Math.floor(maxVisible / 2));
        let endP = Math.min(info.total, startP + maxVisible - 1);
        if (endP - startP < maxVisible - 1) startP = Math.max(1, endP - maxVisible + 1);
        for (let i = startP; i <= endP; i++) pages.push(i);

        const prevDis = info.page <= 1 ? "disabled" : "";
        const nextDis = info.page >= info.total ? "disabled" : "";
        btmEl.innerHTML = `
          <div class="pager-bottom">
            <div class="pager-nav">
              <button class="pager-btn" data-page="${info.page - 1}" ${prevDis}>‹</button>
              ${pages.map(p => `<button class="pager-btn ${p === info.page ? "active" : ""}" data-page="${p}">${p}</button>`).join("")}
              <button class="pager-btn" data-page="${info.page + 1}" ${nextDis}>›</button>
            </div>
            <span class="pager-pos">${escape(t("pager.page"))} ${info.page} / ${info.total}</span>
          </div>`;
        btmEl.querySelectorAll(".pager-btn:not([disabled])").forEach(btn => {
          btn.addEventListener("click", () => {
            const s = _get(key);
            s.page = Number(btn.dataset.page);
            onPageChange();
          });
        });
      }
    }
  }

  return { reset, slice, render };
})();

function showModal(sel){
  const m = $(sel);
  if (!m) return;
  m.hidden = false;
  document.body.classList.add("modal-open");
}
function hideModal(sel){
  const m = $(sel);
  if (!m) return;
  m.hidden = true;
  // only release scroll lock when no modal is still open
  if (!document.querySelector(".modal:not([hidden])")) {
    document.body.classList.remove("modal-open");
  }
}

/* Map a color name to a CSS-renderable swatch color. Returns "" for an
   unrecognised name (the cell then falls back to a "—" badge). */
const COLOR_SWATCH = {
  "white":         "#ffffff",
  "black":         "#000000",
  "silver":        "#c0c0c0",
  "gray":          "#808080",
  "red":           "#dc2626",
  "blue":          "#2563eb",
  "green":         "#16a34a",
  "yellow":        "#facc15",
  "brown":         "#92400e",
  "beige":         "#f5f5dc",
  "gold":          "#d4af37",
  "orange":        "#f97316",
  "maroon":        "#800000",
  "purple":        "#7c3aed",
  "pink":          "#ec4899",
  "bronze":        "#cd7f32",
  "champagne":     "#f7e7ce",
  "pearl white":   "#f8f8ff",
  "pearl black":   "#1a1a1a",
};

function formatColorCell(name){
  const s = String(name || "").trim();
  if (!s) return `<span class="badge no">—</span>`;
  const css = COLOR_SWATCH[s.toLowerCase()] || "";
  const swatch = css
    ? `<span class="color-swatch" style="background:${css}"></span>`
    : "";
  return `${swatch}<span class="color-name">${escape(s)}</span>`;
}

/* Render a (possibly comma-separated) phone string as one or more tel: links. */
function formatPhonesCell(s){
  const phones = String(s || "")
    .split(",")
    .map(p => p.trim())
    .filter(Boolean);
  if (!phones.length) return `<span class="badge no">—</span>`;
  return phones
    .map(p => `<a href="tel:${escape(p)}">${escape(p)}</a>`)
    .join("<br>");
}

function rowActionsHtml(entityKey, id){
  return `<div class="row-actions">
    <button type="button" class="row-btn edit"   data-act="edit"   data-entity="${entityKey}" data-id="${id}">${escape(t("action.edit"))}</button>
    <button type="button" class="row-btn delete" data-act="delete" data-entity="${entityKey}" data-id="${id}">${escape(t("action.delete"))}</button>
  </div>`;
}

function bindRowActions(tableEl){
  tableEl.querySelectorAll("button[data-act]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const id = Number(btn.dataset.id);
      const entityKey = btn.dataset.entity;
      const list = state[entityKey] || [];
      const rec  = list.find(x => x.id === id);
      if (btn.dataset.act === "edit" && rec)   Editor.open(entityKey, rec);
      if (btn.dataset.act === "delete")        softDelete(entityKey, id);
    });
  });
}

/* ============== COMPANIES ============== */
async function refreshCompanies(){
  state.companies = await API.listCompanies();
  renderCompanies();
  // refresh dependent selects
  const carCompanySel  = $('#form-car select[name="company_id"]');
  const rentCompanySel = $('#form-rent select[name="company_id"]');
  fillSelect(carCompanySel,  state.companies, "id", c => `${c.companyname} — ${c.location}`);
  fillSelect(rentCompanySel, state.companies, "id", c => `${c.companyname} — ${c.location}`);
  // keep header logo + admin filter dropdowns in sync
  refreshHeaderFromCompanies();
  refreshFilterDropdowns();
}
/* Populate the value-list of a filter <select> with distinct values.
   Keeps the placeholder (disabled+hidden) option, and prepends a clickable
   "— All —" so the admin can clear the filter from inside the dropdown. */
function populateFilterSelect(selectEl, values){
  if (!selectEl) return;
  const cur = selectEl.value;
  const placeholder = selectEl.querySelector('option[disabled][hidden]')?.outerHTML || "";
  const sorted = Array.from(new Set((values || []).filter(Boolean))).sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { sensitivity: "base" })
  );
  selectEl.innerHTML = placeholder
    + `<option value="">${escape(t("filter.all"))}</option>`
    + sorted.map(v => `<option value="${escape(v)}">${escape(v)}</option>`).join("");
  if (cur && sorted.includes(cur)) selectEl.value = cur;
  // SearchSelect listens via MutationObserver on innerHTML change, so it
  // re-syncs automatically. Force a label refresh too in case value reset.
  if (selectEl._ss) selectEl._ss.sync();
}

/* A readable, per-car-unique label for report rows: "Model — Plate". */
function carLabel(r){
  if (!r || !r.car_model) return "";
  return r.car_plate ? `${r.car_model} — ${r.car_plate}` : r.car_model;
}

function refreshFilterDropdowns(){
  const companyNames = state.companies.map(c => c.companyname);
  const clientNames  = state.clients.map(c => c.name);
  const clientLics   = state.clients.map(c => c.licenseid);
  const reportCompanies = (state.report || []).map(r => r.company_name);
  const reportClients   = (state.report || []).map(r => r.client_name);
  const reportLics      = (state.report || []).map(r => r.client_licenseid);

  populateFilterSelect($("#filter-companies-name"), companyNames);
  populateFilterSelect($("#filter-cars-company"),   companyNames);
  populateFilterSelect($("#filter-clients-lic"),    clientLics);
  populateFilterSelect($("#filter-clients-name"),   clientNames);
  populateFilterSelect($("#filter-report-company"), reportCompanies);
  populateFilterSelect($("#filter-report-client"),  reportClients);
  populateFilterSelect($("#filter-report-lic"),     reportLics);

  // Company-user report search dropdowns — scoped to the user's own company.
  const u = AUTH.user();
  let coRows = state.report || [];
  if (u && u.role === "company"){
    coRows = coRows.filter(r => Number(r.company_id) === Number(u.company_id));
  }
  populateFilterSelect($("#filter-report-client-co"), coRows.map(r => r.client_name));
  populateFilterSelect($("#filter-report-car-co"),    coRows.map(carLabel));
}

function getCompaniesRows(){
  const company = $("#filter-companies-name")?.value || "";
  if (!company) return state.companies;
  return state.companies.filter(c => c.companyname === company);
}

function renderCompanies(){
  const tbl = $("#tbl-companies");
  const rows = getCompaniesRows();
  if (!rows.length){
    const pt = $("#pager-top-companies"); if (pt) pt.hidden = true;
    const pb = $("#pager-companies"); if (pb) pb.hidden = true;
    return emptyRow(tbl, 9);
  }

  const info = Pager.slice("companies", rows);
  const html = [];
  info.rows.forEach((c, i) => {
    const hasCoords = c.x != null && c.y != null;
    const coords = hasCoords
      ? `<a href="#" class="company-coord-link" data-x="${c.x}" data-y="${c.y}" data-name="${escape(c.companyname)}">
           <code>${Number(c.y).toFixed(4)}, ${Number(c.x).toFixed(4)}</code>
         </a>`
      : `<span class="badge no">—</span>`;
    const phone = formatPhonesCell(c.phonenumber);
    const logo = c.logo
      ? `<img src="${escape(c.logo)}" alt="${escape(c.companyname)}" class="company-logo-thumb">`
      : `<span class="company-logo-thumb company-logo-thumb-empty">${escape((c.companyname||"?").charAt(0).toUpperCase())}</span>`;

    // Main company row
    const owner = c.owner_name ? escape(c.owner_name) : `<span class="badge no">—</span>`;
    html.push(`
      <tr class="company-main-row">
        <td>${(info.page - 1) * info.size + i + 1}</td>
        <td>${logo}</td>
        <td>${escape(c.companyname)}</td>
        <td>${owner}</td>
        <td>${escape(c.location)}</td>
        <td>${escape(c.companyid)}</td>
        <td>${phone}</td>
        <td>${coords}</td>
        <td>${rowActionsHtml("companies", c.id)}</td>
      </tr>`);

    // Branches belonging to this company → render as indented sub-rows.
    const branches = (state.branches || []).filter(b => b.company_id === c.id);
    branches.forEach(b => {
      const bCoords = (b.x != null && b.y != null)
        ? `<code>${Number(b.y).toFixed(4)}, ${Number(b.x).toFixed(4)}</code>`
        : `<span class="badge no">—</span>`;
      html.push(`
        <tr class="company-branch-row">
          <td></td>
          <td></td>
          <td class="branch-cell"><span class="branch-marker">↳</span> ${escape(t("companies.branchOf"))} <strong>${escape(c.companyname)}</strong></td>
          <td></td>
          <td>${escape(b.location)}</td>
          <td>${escape(c.companyid)}</td>
          <td>${formatPhonesCell(b.phonenumber)}</td>
          <td>${bCoords}</td>
          <td></td>
        </tr>`);
    });
  });
  tbl.tBodies[0].innerHTML = html.join("");

  $$(".company-coord-link", tbl).forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      MapPicker.openView({
        x: Number(a.dataset.x),
        y: Number(a.dataset.y),
        label: a.dataset.name,
      });
    });
  });
  bindRowActions(tbl);
  Pager.render("companies", "#pager-top-companies", "#pager-companies", info, renderCompanies);
}

/* ============== CARS ============== */
async function refreshCars(){
  state.cars = await API.listCars();
  renderCars();
  rebuildCarsVinDropdown();
}
function getCarsRows(){
  const company = $("#filter-cars-company")?.value || "";
  const vin     = $("#filter-cars-vin")?.value     || "";
  let rows = state.cars;
  if (company) rows = rows.filter(c => c.companyname === company);
  if (vin)     rows = rows.filter(c => c.vin === vin);
  return rows;
}

function renderCars(){
  const tbl = $("#tbl-cars");
  const rows = getCarsRows();
  if (!rows.length){
    const pt = $("#pager-top-cars"); if (pt) pt.hidden = true;
    const pb = $("#pager-cars"); if (pb) pb.hidden = true;
    return emptyRow(tbl, 9);
  }

  const info = Pager.slice("cars", rows);
  tbl.tBodies[0].innerHTML = info.rows.map((c,i) => `
    <tr>
      <td>${(info.page - 1) * info.size + i + 1}</td>
      <td>${escape(c.companyname)}</td>
      <td><code>${escape(c.vin)}</code></td>
      <td>${escape(c.type)}</td>
      <td>${escape(c.model)}</td>
      <td>${formatColorCell(c.color)}</td>
      <td>${escape(c.platenumber)}</td>
      <td>${c.has_gps ? `<span class="badge yes">${t("yes")}</span>` : `<span class="badge no">${t("no")}</span>`}</td>
      <td>${rowActionsHtml("cars", c.id)}</td>
    </tr>`).join("");
  bindRowActions(tbl);
  Pager.render("cars", "#pager-top-cars", "#pager-cars", info, renderCars);
}

/* ============== BRANCHES (admin: shown as sub-rows in #tbl-companies) ===== */
async function refreshBranches(){
  try {
    state.branches = await API.listBranches();
  } catch (err){
    state.branches = [];
  }
  // Branches are now rendered inline beneath their parent company row.
  renderCompanies();
}

/* ============== CLIENTS ============== */
async function refreshClients(){
  state.clients = await API.listClients();
  renderClients();
  fillSelect($('#form-rent select[name="client_id"]'),
             state.clients, "id", c => `${c.name} — ${c.phonenumber}`);
  refreshFilterDropdowns();
}
function getClientsRows(){
  const lic  = $("#filter-clients-lic")?.value  || "";
  const name = $("#filter-clients-name")?.value || "";
  let rows = state.clients;
  if (lic)  rows = rows.filter(c => c.licenseid === lic);
  if (name) rows = rows.filter(c => c.name      === name);
  return rows;
}

function renderClients(){
  const tbl = $("#tbl-clients");
  const rows = getClientsRows();
  if (!rows.length){
    const pt = $("#pager-top-clients"); if (pt) pt.hidden = true;
    const pb = $("#pager-clients"); if (pb) pb.hidden = true;
    return emptyRow(tbl, 12);
  }

  const info = Pager.slice("clients", rows);
  const dash = `<span class="badge no">—</span>`;
  const cell = (v) => v ? escape(v) : dash;
  const photo = (p, name) => p
    ? `<img src="${escape(p)}" alt="${escape(name||"")}" class="client-photo-thumb">`
    : `<span class="client-photo-thumb client-photo-thumb-empty">${escape((name||"?").charAt(0).toUpperCase())}</span>`;
  tbl.tBodies[0].innerHTML = info.rows.map((c,i) => `
    <tr>
      <td>${(info.page - 1) * info.size + i + 1}</td>
      <td>${photo(c.photo, c.firstname || c.name)}</td>
      <td>${cell(c.personid)}</td>
      <td>${cell(c.firstname)}</td>
      <td>${cell(c.lastname)}</td>
      <td>${cell(c.fathername)}</td>
      <td>${cell(c.mothername)}</td>
      <td>${cell(c.nationality)}</td>
      <td>${cell(c.phonenumber)}</td>
      <td>${cell(c.licenseid)}</td>
      <td>${cell(c.enddatelicense)}</td>
      <td>${rowActionsHtml("clients", c.id)}</td>
    </tr>`).join("");
  bindRowActions(tbl);
  Pager.render("clients", "#pager-top-clients", "#pager-clients", info, renderClients);
}

/* ============== REPORT ============== */
async function refreshReport(){
  state.report = await API.report();
  renderReport();
  refreshFilterDropdowns();
}

/* Filter rows according to who's viewing.
   - company users  → only their own company, started in the last 30 days
   - admins         → optional company-name search box
*/
function getReportRows(){
  const u = AUTH.user();
  let rows = state.report.slice();

  if (u && u.role === "company"){
    // Always scoped to the user's own company.
    rows = rows.filter(r => Number(r.company_id) === Number(u.company_id));
    // Optional search filters — any combination, none required.
    const client = $("#filter-report-client-co")?.value || "";
    const car    = $("#filter-report-car-co")?.value    || "";
    const from   = ($("#report-from-co")?.value || "").trim();
    const to     = ($("#report-to-co")?.value   || "").trim();
    if (client) rows = rows.filter(r => r.client_name === client);
    if (car)    rows = rows.filter(r => carLabel(r) === car);
    // Date filter = "rentals active in this range" (overlap).
    if (from) rows = rows.filter(r => r.end_date   && r.end_date   >= from);
    if (to)   rows = rows.filter(r => r.start_date && r.start_date <= to);
    // With no filter active, default to the last 30 days so the initial
    // view stays small; any filter unlocks the full history.
    if (!client && !car && !from && !to){
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 1);
      rows = rows.filter(r => r.start_date && new Date(r.start_date) >= cutoff);
    }
  } else if (u && u.role === "admin"){
    const company = $("#filter-report-company")?.value || "";
    const client  = $("#filter-report-client")?.value  || "";
    const lic     = $("#filter-report-lic")?.value     || "";
    const from    = ($("#report-from")?.value || "").trim();
    const to      = ($("#report-to")?.value   || "").trim();
    if (company) rows = rows.filter(r => r.company_name      === company);
    if (client)  rows = rows.filter(r => r.client_name       === client);
    if (lic)     rows = rows.filter(r => r.client_licenseid  === lic);
    // Date filter = "rentals active in this range" (overlap), so a rental
    // that started earlier and is still ongoing still shows up.
    if (from) rows = rows.filter(r => r.end_date   && r.end_date   >= from);
    if (to)   rows = rows.filter(r => r.start_date && r.start_date <= to);
  }
  return rows;
}

function renderReport(){
  const tbl = $("#tbl-report");
  const rows = getReportRows();
  if (!rows.length){
    const pt = $("#pager-top-report"); if (pt) pt.hidden = true;
    const pb = $("#pager-report"); if (pb) pb.hidden = true;
    return emptyRow(tbl, 13);
  }

  const info = Pager.slice("report", rows);
  tbl.tBodies[0].innerHTML = info.rows.map((r, i) => {
    const cphone = r.company_phone
      ? `<a href="tel:${escape(r.company_phone)}">${escape(r.company_phone)}</a>`
      : `<span class="badge no">—</span>`;
    return `
    <tr data-row="${(info.page - 1) * info.size + i}" class="report-row">
      <td><strong>${escape(r.client_name)}</strong></td>
      <td>${escape(r.client_father)}</td>
      <td>${escape(r.client_phone)}</td>
      <td><code>${escape(r.client_licenseid)}</code></td>
      <td>${escape(r.company_name)}</td>
      <td>${cphone}</td>
      <td>${escape(r.company_location)}</td>
      <td>${escape(r.car_model)} <span style="color:#94a3b8">(${escape(r.car_type)})</span></td>
      <td>${escape(r.car_plate)}</td>
      <td>${r.car_has_gps ? `<span class="badge yes">${t("yes")}</span>` : `<span class="badge no">${t("no")}</span>`}</td>
      <td>${escape(r.start_date)}</td>
      <td>${escape(r.end_date)}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="row-btn pdf" data-detail="${(info.page - 1) * info.size + i}">${escape(t("action.open"))}</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  // Click anywhere on the row OR the Open button to see the detail/PDF dialog
  $$("tr.report-row", tbl).forEach(tr => {
    tr.addEventListener("click", () => {
      const idx = Number(tr.dataset.row);
      Detail.open(rows[idx]);
    });
  });
  Pager.render("report", "#pager-top-report", "#pager-report", info, renderReport);
}

/* ============== RENT FLOW ============== */
function setupRentFlow(){
  const form        = $("#form-rent");
  const companySel  = form.querySelector('select[name="company_id"]');
  const carSel      = form.querySelector('select[name="car_vin"]');
  const clientSel   = form.querySelector('select[name="client_id"]');
  const preview     = $("#rent-preview");

  const renderMini = (tbl, rows) => {
    tbl.querySelector("tbody").innerHTML = rows
      .map(([k,v]) => `<tr><td>${escape(k)}</td><td>${escape(v ?? "—")}</td></tr>`).join("");
  };

  const updatePreview = () => {
    const company = state.companies.find(c => String(c.id)   === companySel.value);
    const car     = state.cars     .find(c => c.vin          === carSel.value);
    const client  = state.clients  .find(c => String(c.id)   === clientSel.value);

    if (!company && !car && !client){ preview.hidden = true; return; }
    preview.hidden = false;

    renderMini($("#prev-company"), company ? [
      [t("companies.f.name"),  company.companyname],
      [t("companies.f.loc"),   company.location],
      [t("companies.f.cid"),   company.companyid],
      [t("companies.f.phone"), company.phonenumber || "—"],
    ] : []);

    renderMini($("#prev-car"), car ? [
      [t("cars.f.vin"),   car.vin],
      [t("cars.f.model"), car.model],
      [t("cars.f.type"),  car.type],
      [t("cars.f.color"), car.color],
      [t("cars.f.plate"), car.platenumber],
      [t("cars.f.gps"),   car.has_gps ? t("yes") : t("no")],
    ] : []);

    renderMini($("#prev-client"), client ? [
      [t("clients.f.pid"),    client.personid],
      [t("clients.f.name"),   client.name],
      [t("clients.f.phone"),  client.phonenumber],
      [t("clients.f.lic"),    client.licenseid],
      [t("clients.f.licend"), client.enddatelicense],
    ] : []);
  };

  // when company changes, reload cars filtered to that company
  companySel.addEventListener("change", async () => {
    const cars = await API.listCars(companySel.value);
    fillSelect(carSel, cars, "vin", c => `${c.model} — ${c.platenumber} (${c.vin})`);
    updatePreview();
  });
  carSel.addEventListener("change", updatePreview);
  clientSel.addEventListener("change", updatePreview);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try{
      await API.addRental({
        client_id:  Number(fd.get("client_id")),
        car_vin:    fd.get("car_vin"),
        start_date: fd.get("start_date"),
        end_date:   fd.get("end_date"),
      });
      toast(t("toast.rented"), "success");
      await refreshReport();
    } catch (err){
      toast(err.message || t("toast.error"), "error");
    }
  });
}

/* ============== FORM HANDLERS ============== */
function resetMapStatus(){
  const el = $("#map-loc-status");
  if (!el) return;
  el.textContent = t("companies.maploc.empty");
  el.classList.add("empty");
  el.classList.remove("filled");
}

function setMapStatusOn(sel, lat, lng){
  const el = typeof sel === "string" ? $(sel) : sel;
  if (!el) return;
  el.classList.remove("empty");
  el.classList.add("filled");
  el.innerHTML =
    `<span class="dot"></span>` +
    `<span class="map-loc-label">${escape(t("companies.maploc.set"))}</span>` +
    `<code>${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}</code>`;
}

function setMapStatus(lat, lng){
  setMapStatusOn("#map-loc-status", lat, lng);
}

function setupCompanyForm(){
  $("#form-company").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd);
    body.x = body.x === "" ? null : Number(body.x);
    body.y = body.y === "" ? null : Number(body.y);
    body.logo = body.logo || null;
    try{
      await API.addCompany(body);
      e.target.reset();
      $("#company-x").value = "";
      $("#company-y").value = "";
      $("#company-logo-data").value = "";
      LogoPicker.reset({
        previewSel: "#company-logo-preview",
        fallbackSel: "#company-logo-fallback",
        clearSel: "#company-logo-clear",
        dataSel: "#company-logo-data",
      });
      resetMapStatus();
      await refreshCompanies();
      toast(t("toast.added"), "success");
    } catch (err){ toast(err.message || t("toast.error"), "error"); }
  });

  LogoPicker.bind({
    fileSel:     "#company-logo-file",
    previewSel:  "#company-logo-preview",
    fallbackSel: "#company-logo-fallback",
    clearSel:    "#company-logo-clear",
    dataSel:     "#company-logo-data",
  });

  // also wire up the (admin-only) register form logo picker if present.
  if ($("#register-logo-file")) {
    LogoPicker.bind({
      fileSel:     "#register-logo-file",
      previewSel:  "#register-logo-preview",
      fallbackSel: "#register-logo-fallback",
      clearSel:    "#register-logo-clear",
      dataSel:     "#register-logo-data",
    });
  }

  resetMapStatus();
  document.addEventListener("lang:changed", () => {
    // re-translate the empty placeholder when language changes
    if ($("#map-loc-status")?.classList.contains("empty")) resetMapStatus();
  });
}

/* ============== LOGO PICKER ==============
   Reads an image File, downscales it to a max edge of 256px on a
   <canvas>, and stores the result as a JPEG/PNG data URL in a hidden
   input. Keeps the payload small enough to ride along inside the
   normal companies JSON. */
const LogoPicker = (() => {
  const MAX_EDGE = 256;     // px on the longest side
  const QUALITY  = 0.85;    // JPEG quality

  async function fileToDataUrl(file){
    // 1. Always read the file into a data URL — works for any image type
    //    the browser knows about (and many it doesn't, since this step
    //    is just byte-level encoding).
    const raw = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = () => res(r.result);
      r.onerror = () => rej(new Error("Could not read the file"));
      r.readAsDataURL(file);
    });

    // 2. Try to decode + downscale via <canvas>. If anything fails — the
    //    browser can't decode the format, the source has weird metadata,
    //    a security restriction, etc. — fall back to the raw data URL so
    //    the image still renders if the browser can show the original.
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload  = () => res(i);
        i.onerror = () => rej(new Error("decode failed"));
        i.src = raw;
        setTimeout(() => rej(new Error("decode timeout")), 6000);
      });
      // Already small enough? Keep the original — preserves quality and
      // saves us a re-encode pass.
      if (Math.max(img.width, img.height) <= MAX_EDGE) return raw;
      const scale  = MAX_EDGE / Math.max(img.width, img.height);
      const w      = Math.max(1, Math.round(img.width  * scale));
      const h      = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      // Keep alpha-capable types as PNG; otherwise JPEG for smaller payload.
      const mime = /image\/(png|webp|gif|avif)/i.test(file.type)
        ? "image/png"
        : "image/jpeg";
      return canvas.toDataURL(mime, QUALITY);
    } catch (e) {
      // Canvas pipeline blew up — return the raw data URL so the browser
      // still gets a chance to render the original bytes.
      return raw;
    }
  }

  function setPreview(opts, dataUrl){
    const img = $(opts.previewSel);
    const fb  = $(opts.fallbackSel);
    const clr = opts.clearSel ? $(opts.clearSel) : null;
    const data = $(opts.dataSel);
    if (dataUrl){
      img.src = dataUrl;
      img.hidden = false;
      if (fb)  fb.hidden = true;
      if (clr) clr.hidden = false;
      if (data) data.value = dataUrl;
    } else {
      img.removeAttribute("src");
      img.hidden = true;
      if (fb)  fb.hidden = false;
      if (clr) clr.hidden = true;
      if (data) data.value = "";
    }
  }

  function reset(opts){ setPreview(opts, ""); }

  function bind(opts){
    const file = $(opts.fileSel);
    if (!file) return;
    file.addEventListener("change", async () => {
      const f = file.files[0];
      if (!f) return;
      try {
        const url = await fileToDataUrl(f);
        setPreview(opts, url);
      } catch (e){
        toast(e.message || "Could not read image", "error");
      }
      file.value = "";
    });
    const clr = opts.clearSel ? $(opts.clearSel) : null;
    if (clr) clr.addEventListener("click", () => reset(opts));
  }

  return { bind, reset, setPreview, fileToDataUrl };
})();

function setupCarForm(){
  $("#form-car").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd);
    body.has_gps    = fd.get("has_gps") === "on";
    body.company_id = Number(body.company_id);
    try{
      await API.addCar(body);
      e.target.reset();
      await refreshCars();
      toast(t("toast.added"), "success");
    } catch (err){ toast(err.message || t("toast.error"), "error"); }
  });
}

function setupClientForm(){
  $("#form-client").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try{
      await API.addClient(Object.fromEntries(fd));
      e.target.reset();
      await refreshClients();
      toast(t("toast.added"), "success");
    } catch (err){ toast(err.message || t("toast.error"), "error"); }
  });
}

/* ============== REGISTER MODAL (admin-only) ============== */
function setupRegisterForm(){
  const form    = $("#form-register");
  const navLink = $("#nav-register");
  const closeBt = $("#register-close");
  const cancel  = $("#register-cancel");
  if (!form) return;

  const openRegister = (e) => {
    if (e) e.preventDefault();
    const result = $("#register-result");
    if (result){ result.hidden = true; result.textContent = ""; }
    form.reset();
    showModal("#register-modal");
    setTimeout(() => form.querySelector('input[name="companyname"]')?.focus(), 50);
  };
  const closeRegister = () => hideModal("#register-modal");

  if (navLink) navLink.addEventListener("click", openRegister);
  if (closeBt) closeBt.addEventListener("click", closeRegister);
  if (cancel)  cancel .addEventListener("click", closeRegister);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#register-modal").hidden) closeRegister();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const body = {
      companyname: (fd.get("companyname") || "").toString().trim(),
      password:    (fd.get("password")    || "").toString(),
      owner_name:  (fd.get("owner_name")  || "").toString().trim(),
    };
    if (!body.companyname || !body.password){
      toast(t("toast.error"), "error");
      return;
    }
    const user = AUTH.user();
    try {
      const r = await fetch(API.url("/api/register-company"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-User":  user?.username || "",
        },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok){
        toast(data.error || t("toast.error"), "error");
        return;
      }
      const username = data.user?.username || "";
      const result = $("#register-result");
      if (result){
        result.hidden = false;
        result.textContent = t("register.created").replace("{u}", username);
      }
      form.reset();
      toast(t("register.created").replace("{u}", username), "success");
      await refreshCompanies();
      // Auto-close after a short beat so the admin sees the success message.
      setTimeout(closeRegister, 1200);
    } catch (err){
      toast(err.message || t("toast.error"), "error");
    }
  });
}

/* ============== COMPANY INFO (company-user tab #1) ============== */
/* If the user types a Lebanese local number without an international
   prefix, prepend +961 automatically. Already-international entries
   (anything starting with "+") are left untouched. */
function normalizePhone(p){
  const s = String(p ?? "").trim();
  if (!s) return "";
  if (s.startsWith("+")) return s;
  // Lebanese local numbers commonly start with a 0 — strip it before prefixing
  // so "01-234567" becomes "+961-1-234567" (visually) / "+9611234567" (logical).
  const local = s.replace(/^0+/, "");
  return "+961" + local;
}

/* International dial codes. Lebanon (+961) is the default for new entries
   so the common case is one click. The list is sorted alphabetically by
   country name; the multi-phone widget and the Add Client form both use it. */
const COUNTRY_CODES = [
  { code: "93",  name: "Afghanistan" }, { code: "355", name: "Albania" },
  { code: "213", name: "Algeria" },     { code: "376", name: "Andorra" },
  { code: "244", name: "Angola" },      { code: "54",  name: "Argentina" },
  { code: "374", name: "Armenia" },     { code: "61",  name: "Australia" },
  { code: "43",  name: "Austria" },     { code: "994", name: "Azerbaijan" },
  { code: "973", name: "Bahrain" },     { code: "880", name: "Bangladesh" },
  { code: "375", name: "Belarus" },     { code: "32",  name: "Belgium" },
  { code: "501", name: "Belize" },      { code: "229", name: "Benin" },
  { code: "975", name: "Bhutan" },      { code: "591", name: "Bolivia" },
  { code: "387", name: "Bosnia & Herzegovina" }, { code: "267", name: "Botswana" },
  { code: "55",  name: "Brazil" },      { code: "673", name: "Brunei" },
  { code: "359", name: "Bulgaria" },    { code: "226", name: "Burkina Faso" },
  { code: "257", name: "Burundi" },     { code: "855", name: "Cambodia" },
  { code: "237", name: "Cameroon" },    { code: "1",   name: "Canada / United States" },
  { code: "238", name: "Cape Verde" },  { code: "236", name: "Central African Republic" },
  { code: "235", name: "Chad" },        { code: "56",  name: "Chile" },
  { code: "86",  name: "China" },       { code: "57",  name: "Colombia" },
  { code: "269", name: "Comoros" },     { code: "243", name: "Congo (DRC)" },
  { code: "242", name: "Congo (Republic)" }, { code: "506", name: "Costa Rica" },
  { code: "385", name: "Croatia" },     { code: "53",  name: "Cuba" },
  { code: "357", name: "Cyprus" },      { code: "420", name: "Czech Republic" },
  { code: "45",  name: "Denmark" },     { code: "253", name: "Djibouti" },
  { code: "593", name: "Ecuador" },     { code: "20",  name: "Egypt" },
  { code: "503", name: "El Salvador" }, { code: "240", name: "Equatorial Guinea" },
  { code: "291", name: "Eritrea" },     { code: "372", name: "Estonia" },
  { code: "251", name: "Ethiopia" },    { code: "679", name: "Fiji" },
  { code: "358", name: "Finland" },     { code: "33",  name: "France" },
  { code: "241", name: "Gabon" },       { code: "220", name: "Gambia" },
  { code: "995", name: "Georgia" },     { code: "49",  name: "Germany" },
  { code: "233", name: "Ghana" },       { code: "30",  name: "Greece" },
  { code: "502", name: "Guatemala" },   { code: "224", name: "Guinea" },
  { code: "245", name: "Guinea-Bissau" }, { code: "592", name: "Guyana" },
  { code: "509", name: "Haiti" },       { code: "504", name: "Honduras" },
  { code: "852", name: "Hong Kong" },   { code: "36",  name: "Hungary" },
  { code: "354", name: "Iceland" },     { code: "91",  name: "India" },
  { code: "62",  name: "Indonesia" },   { code: "98",  name: "Iran" },
  { code: "964", name: "Iraq" },        { code: "353", name: "Ireland" },
  { code: "972", name: "Israel" },      { code: "39",  name: "Italy" },
  { code: "225", name: "Ivory Coast" }, { code: "81",  name: "Japan" },
  { code: "962", name: "Jordan" },      { code: "7",   name: "Kazakhstan / Russia" },
  { code: "254", name: "Kenya" },       { code: "383", name: "Kosovo" },
  { code: "965", name: "Kuwait" },      { code: "996", name: "Kyrgyzstan" },
  { code: "856", name: "Laos" },        { code: "371", name: "Latvia" },
  { code: "961", name: "Lebanon" },     { code: "266", name: "Lesotho" },
  { code: "231", name: "Liberia" },     { code: "218", name: "Libya" },
  { code: "423", name: "Liechtenstein" }, { code: "370", name: "Lithuania" },
  { code: "352", name: "Luxembourg" },  { code: "853", name: "Macau" },
  { code: "389", name: "Macedonia" },   { code: "261", name: "Madagascar" },
  { code: "265", name: "Malawi" },      { code: "60",  name: "Malaysia" },
  { code: "960", name: "Maldives" },    { code: "223", name: "Mali" },
  { code: "356", name: "Malta" },       { code: "222", name: "Mauritania" },
  { code: "230", name: "Mauritius" },   { code: "52",  name: "Mexico" },
  { code: "373", name: "Moldova" },     { code: "377", name: "Monaco" },
  { code: "976", name: "Mongolia" },    { code: "382", name: "Montenegro" },
  { code: "212", name: "Morocco" },     { code: "258", name: "Mozambique" },
  { code: "95",  name: "Myanmar" },     { code: "264", name: "Namibia" },
  { code: "977", name: "Nepal" },       { code: "31",  name: "Netherlands" },
  { code: "64",  name: "New Zealand" }, { code: "505", name: "Nicaragua" },
  { code: "227", name: "Niger" },       { code: "234", name: "Nigeria" },
  { code: "850", name: "North Korea" }, { code: "47",  name: "Norway" },
  { code: "968", name: "Oman" },        { code: "92",  name: "Pakistan" },
  { code: "970", name: "Palestine" },   { code: "507", name: "Panama" },
  { code: "675", name: "Papua New Guinea" }, { code: "595", name: "Paraguay" },
  { code: "51",  name: "Peru" },        { code: "63",  name: "Philippines" },
  { code: "48",  name: "Poland" },      { code: "351", name: "Portugal" },
  { code: "974", name: "Qatar" },       { code: "40",  name: "Romania" },
  { code: "250", name: "Rwanda" },      { code: "966", name: "Saudi Arabia" },
  { code: "221", name: "Senegal" },     { code: "381", name: "Serbia" },
  { code: "248", name: "Seychelles" },  { code: "232", name: "Sierra Leone" },
  { code: "65",  name: "Singapore" },   { code: "421", name: "Slovakia" },
  { code: "386", name: "Slovenia" },    { code: "252", name: "Somalia" },
  { code: "27",  name: "South Africa" }, { code: "82",  name: "South Korea" },
  { code: "211", name: "South Sudan" }, { code: "34",  name: "Spain" },
  { code: "94",  name: "Sri Lanka" },   { code: "249", name: "Sudan" },
  { code: "597", name: "Suriname" },    { code: "46",  name: "Sweden" },
  { code: "41",  name: "Switzerland" }, { code: "963", name: "Syria" },
  { code: "886", name: "Taiwan" },      { code: "992", name: "Tajikistan" },
  { code: "255", name: "Tanzania" },    { code: "66",  name: "Thailand" },
  { code: "228", name: "Togo" },        { code: "216", name: "Tunisia" },
  { code: "90",  name: "Turkey" },      { code: "993", name: "Turkmenistan" },
  { code: "256", name: "Uganda" },      { code: "380", name: "Ukraine" },
  { code: "971", name: "United Arab Emirates" },
  { code: "44",  name: "United Kingdom" },
  { code: "598", name: "Uruguay" },     { code: "998", name: "Uzbekistan" },
  { code: "58",  name: "Venezuela" },   { code: "84",  name: "Vietnam" },
  { code: "967", name: "Yemen" },       { code: "260", name: "Zambia" },
  { code: "263", name: "Zimbabwe" },
];

const COUNTRY_CODES_SET = new Set(COUNTRY_CODES.map(c => c.code));

/* Parse a stored "+CCC NUMBER" entry back into {code, number}. Falls back
   to Lebanon (+961) if the prefix can't be matched. Used when re-rendering
   saved phones into individual rows. */
function parsePhoneEntry(s){
  const trimmed = String(s || "").trim();
  if (!trimmed) return { code: "961", number: "" };
  const m = trimmed.match(/^\+(\d{1,4})\s*[- ]?\s*(.*)$/);
  if (m){
    const codeStr = m[1];
    for (let len = Math.min(4, codeStr.length); len >= 1; len--){
      const candidate = codeStr.substring(0, len);
      if (COUNTRY_CODES_SET.has(candidate)){
        const rest = (codeStr.substring(len) + " " + m[2]).trim();
        return { code: candidate, number: rest };
      }
    }
  }
  // No "+" prefix — treat the whole value as a local Lebanese number.
  return { code: "961", number: trimmed.replace(/^0+/, "") };
}

function _countryOptionsHtml(selectedCode){
  return COUNTRY_CODES
    .map(c => `<option value="${c.code}"${c.code === selectedCode ? " selected" : ""}>+${c.code} ${escape(c.name)}</option>`)
    .join("");
}

/* Multi-phone widget — each row is a country-code dropdown + number input
   so the user picks the dial code instead of typing it. The container
   serializes back to a comma-separated "+CCC NUMBER" string for the
   existing single-column phonenumber field. */
const PhoneList = {
  rowHtml(value = ""){
    const { code, number } = parsePhoneEntry(value);
    return `<div class="phone-row">
      <select class="phone-code-select" data-ss-prefix="3">${_countryOptionsHtml(code)}</select>
      <input type="tel" class="phone-input" value="${escape(number)}" placeholder="number">
      <button type="button" class="phone-remove" aria-label="Remove">&times;</button>
    </div>`;
  },
  enhanceSelectsIn(container){
    if (!container || typeof enhanceSelects !== "function") return;
    enhanceSelects(container);
  },
  // Replace the container with one row per phone number; always at least one row.
  setPhones(containerSel, csv){
    const c = $(containerSel);
    if (!c) return;
    const phones = String(csv || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    if (!phones.length) phones.push("");
    c.innerHTML = phones.map(p => this.rowHtml(p)).join("");
    this.enhanceSelectsIn(c);
  },
  addRow(containerSel){
    const c = $(containerSel);
    if (!c) return;
    c.insertAdjacentHTML("beforeend", this.rowHtml(""));
    this.enhanceSelectsIn(c.lastElementChild);
    c.lastElementChild.querySelector(".phone-input")?.focus();
  },
  // Combine each row's country code + number back into one "+CCC NUMBER" entry.
  getPhones(containerSel){
    const c = $(containerSel);
    if (!c) return "";
    return $$(".phone-row", c)
      .map(row => {
        const code = row.querySelector(".phone-code-select")?.value || "961";
        const num  = (row.querySelector(".phone-input")?.value || "").trim();
        if (!num) return "";
        return `+${code} ${num}`;
      })
      .filter(Boolean)
      .join(", ");
  },
  // Wire up the "+ Add phone" button and delegated remove clicks.
  bind(containerSel, addBtnSel){
    const c = $(containerSel);
    const addBtn = $(addBtnSel);
    if (!c) return;
    addBtn?.addEventListener("click", () => this.addRow(containerSel));
    c.addEventListener("click", (e) => {
      const btn = e.target.closest(".phone-remove");
      if (!btn) return;
      const row  = btn.closest(".phone-row");
      const rest = c.querySelectorAll(".phone-row").length - 1;
      if (rest === 0){
        // Don't leave the list empty — just clear the last input.
        const inp = row.querySelector(".phone-input");
        if (inp) inp.value = "";
      } else {
        row.remove();
      }
    });
  },
};

async function loadCompanyInfo(){
  const u = AUTH.user();
  if (!u || u.role !== "company" || !u.company_id) return;

  const form = $("#form-company-info");
  if (!form) return;
  // Reset to a blank entry — the company name is the one field we keep,
  // taken from the user object so it always matches the username.
  resetCompanyInfoForm();
  hideCompanyInfoStatus();
  hideBranchStatus();
}

/* Empty every editable field on the Company Info form, leaving the
   read-only company name as the only filled value. */
function resetCompanyInfoForm(){
  const u = AUTH.user();
  const form = $("#form-company-info");
  if (!form || !u) return;
  const c = u.company || {};
  form.reset();
  form.querySelector('[name="companyname"]').value = c.companyname || u.username;
  form.querySelector('[name="companyid"]')  .value = "";
  form.querySelector('[name="location"]')   .value = "";
  PhoneList.setPhones("#company-info-phones", "");
  $("#company-info-x").value = "";
  $("#company-info-y").value = "";
  const el = $("#company-info-map-status");
  if (el){
    el.classList.add("empty");
    el.classList.remove("filled");
    el.textContent = t("companies.maploc.empty");
  }
}

function showCompanyInfoStatus(message){
  const el = $("#company-info-status");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  // Auto-hide after a few seconds so it doesn't linger forever.
  clearTimeout(showCompanyInfoStatus._t);
  showCompanyInfoStatus._t = setTimeout(hideCompanyInfoStatus, 4000);
}

function hideCompanyInfoStatus(){
  const el = $("#company-info-status");
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
}

function setupCompanyInfo(){
  const form = $("#form-company-info");
  if (!form) return;

  PhoneList.bind("#company-info-phones", "#company-info-add-phone");

  // Pick map → fill hidden x/y inputs and the status row
  $("#btn-pick-info-map")?.addEventListener("click", () => {
    MapPicker.openPick({
      xSel:      "#company-info-x",
      ySel:      "#company-info-y",
      statusSel: "#company-info-map-status",
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const u = AUTH.user();
    if (!u || u.role !== "company" || !u.company_id) return;

    const fd = new FormData(form);
    const phones = PhoneList.getPhones("#company-info-phones");
    const body = {
      companyname: fd.get("companyname"),
      companyid:   fd.get("companyid"),
      location:    fd.get("location"),
      owner_name:  fd.get("owner_name") || null,
      phonenumber: phones || null,
      x: fd.get("x") === "" ? null : Number(fd.get("x")),
      y: fd.get("y") === "" ? null : Number(fd.get("y")),
    };

    try {
      const r = await fetch(API.url(`/api/companies/${u.company_id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok){
        toast(data.error || t("toast.error"), "error");
        return;
      }
      // Update the cached user.company so the header logo / next reload reflects it.
      const updated = AUTH.user();
      if (updated){
        updated.company = { ...(updated.company || {}), ...data };
        sessionStorage.setItem(AUTH.KEY + ".user", JSON.stringify(updated));
        renderHeaderProfile();
      }
      // After save: clear every editable field, keep only the company name,
      // and show the inline confirmation message.
      resetCompanyInfoForm();
      showCompanyInfoStatus(t("companyInfo.saved"));
      toast(t("toast.saved"), "success");
    } catch (err){
      toast(err.message || t("toast.error"), "error");
    }
  });
}

function showBranchStatus(message){
  const el = $("#branch-status");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(showBranchStatus._t);
  showBranchStatus._t = setTimeout(hideBranchStatus, 4000);
}

function hideBranchStatus(){
  const el = $("#branch-status");
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
}

// Counter used to mint unique IDs for each cloned branch form so that
// PhoneList / MapPicker selector-based bindings don't collide.
let _branchFormSeq = 0;

function appendInlineBranchForm(){
  const u = AUTH.user();
  if (!u || u.role !== "company" || !u.company_id) return;
  const tpl = $("#tpl-branch-form");
  const list = $("#branch-forms-list");
  if (!tpl || !list) return;

  const n = ++_branchFormSeq;
  const frag = tpl.content.cloneNode(true);
  const form = frag.querySelector("form");
  form.id = `form-branch-inline-${n}`;

  // Promote each data-role element to a unique id so existing selector-based
  // helpers (PhoneList.bind, MapPicker.openPick) can target this instance.
  const idFor = (role) => `${role}-${n}`;
  frag.querySelectorAll("[data-role]").forEach(el => {
    el.id = idFor(el.getAttribute("data-role"));
  });

  list.appendChild(frag);
  if (typeof applyTranslations === "function") applyTranslations();

  PhoneList.setPhones(`#${idFor("branch-phones")}`, "");
  PhoneList.bind(`#${idFor("branch-phones")}`, `#${idFor("branch-add-phone")}`);

  form.querySelector(".branch-close-btn")?.addEventListener("click", () => {
    form.remove();
  });

  form.querySelector(`#${idFor("branch-pick-map")}`)?.addEventListener("click", () => {
    MapPicker.openPick({
      xSel:      `#${idFor("branch-x")}`,
      ySel:      `#${idFor("branch-y")}`,
      statusSel: `#${idFor("branch-map-status")}`,
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const usr = AUTH.user();
    if (!usr || usr.role !== "company" || !usr.company_id){
      toast(t("toast.error"), "error");
      return;
    }
    const fd = new FormData(form);
    const editId   = fd.get("branch_id");
    const location = (fd.get("location") || "").toString().trim();
    const phones   = PhoneList.getPhones(`#${idFor("branch-phones")}`);
    const body = {
      company_id:  usr.company_id,
      branchname:  location,
      location:    location,
      phonenumber: phones || null,
      x: fd.get("x") === "" ? null : Number(fd.get("x")),
      y: fd.get("y") === "" ? null : Number(fd.get("y")),
    };
    if (!body.location){
      toast(t("toast.error"), "error");
      return;
    }
    try {
      const url    = editId ? `/api/branches/${editId}` : "/api/branches";
      const method = editId ? "PUT" : "POST";
      const r = await fetch(API.url(url), {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok){
        toast(data.error || t("toast.error"), "error");
        return;
      }
      form.remove();
      showBranchStatus(t("companyInfo.branch.saved"));
      toast(editId ? t("toast.saved") : t("toast.added"), "success");
    } catch (err){
      toast(err.message || t("toast.error"), "error");
    }
  });

  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
  setTimeout(() => form.querySelector('[name="location"]')?.focus(), 50);
  return form;
}

/* ============== ADD CAR (company-user tab #2) ============== */
const CAR_TYPES = [
  "Sedan", "SUV", "Sport", "Coupe", "Hatchback", "Convertible",
  "Pickup", "Van", "Minivan", "Crossover", "Wagon", "Motorcycle",
];

const CAR_MODELS = [
  // Toyota
  "Toyota Camry", "Toyota Corolla", "Toyota RAV4", "Toyota Land Cruiser",
  "Toyota Hilux", "Toyota Yaris", "Toyota Highlander", "Toyota Prius",
  "Toyota 4Runner", "Toyota Tundra", "Toyota Sienna",
  // Honda
  "Honda Civic", "Honda Accord", "Honda CR-V", "Honda Pilot",
  "Honda HR-V", "Honda Odyssey", "Honda Fit",
  // BMW
  "BMW 1 Series", "BMW 3 Series", "BMW 5 Series", "BMW 7 Series",
  "BMW X1", "BMW X3", "BMW X5", "BMW X7", "BMW M3", "BMW M5",
  // Mercedes-Benz
  "Mercedes A-Class", "Mercedes C-Class", "Mercedes E-Class",
  "Mercedes S-Class", "Mercedes GLA", "Mercedes GLC", "Mercedes GLE",
  "Mercedes GLS", "Mercedes G-Class",
  // Audi
  "Audi A3", "Audi A4", "Audi A6", "Audi A8",
  "Audi Q3", "Audi Q5", "Audi Q7", "Audi Q8", "Audi RS6",
  // Tesla
  "Tesla Model S", "Tesla Model 3", "Tesla Model X", "Tesla Model Y",
  // Hyundai
  "Hyundai Elantra", "Hyundai Sonata", "Hyundai Tucson",
  "Hyundai Santa Fe", "Hyundai Accent", "Hyundai Kona", "Hyundai Palisade",
  // Kia
  "Kia Picanto", "Kia Cerato", "Kia Sportage", "Kia Sorento",
  "Kia Optima", "Kia Telluride",
  // Nissan
  "Nissan Altima", "Nissan Sentra", "Nissan X-Trail", "Nissan Patrol",
  "Nissan Pathfinder", "Nissan Maxima", "Nissan GT-R",
  // Ford
  "Ford Focus", "Ford Mustang", "Ford Explorer", "Ford F-150",
  "Ford Edge", "Ford Escape",
  // Chevrolet
  "Chevrolet Cruze", "Chevrolet Malibu", "Chevrolet Camaro",
  "Chevrolet Tahoe", "Chevrolet Suburban", "Chevrolet Silverado",
  // Volkswagen
  "Volkswagen Golf", "Volkswagen Passat", "Volkswagen Tiguan",
  "Volkswagen Polo", "Volkswagen Jetta",
  // Lexus
  "Lexus IS", "Lexus ES", "Lexus RX", "Lexus LX", "Lexus NX",
  // Range Rover
  "Range Rover", "Range Rover Sport", "Range Rover Evoque", "Range Rover Velar",
  // Porsche
  "Porsche 911", "Porsche Cayenne", "Porsche Macan", "Porsche Panamera",
  // Mazda / Mitsubishi / Subaru
  "Mazda 3", "Mazda 6", "Mazda CX-3", "Mazda CX-5", "Mazda CX-9",
  "Mitsubishi Lancer", "Mitsubishi Pajero", "Mitsubishi Outlander", "Mitsubishi ASX",
  "Subaru Impreza", "Subaru Forester", "Subaru Outback", "Subaru Legacy",
  // Jeep / Dodge
  "Jeep Wrangler", "Jeep Grand Cherokee", "Jeep Cherokee", "Jeep Compass",
  "Dodge Charger", "Dodge Challenger", "Dodge Durango",
  // Renault / Peugeot / Suzuki
  "Renault Duster", "Renault Megane", "Renault Clio", "Renault Captur",
  "Peugeot 208", "Peugeot 308", "Peugeot 3008", "Peugeot 5008",
  "Suzuki Swift", "Suzuki Vitara", "Suzuki Jimny",
  // Sport / exotic
  "Ferrari 488", "Ferrari Roma", "Ferrari F8",
  "Lamborghini Huracan", "Lamborghini Urus",
  // Motorcycles
  "Yamaha YZF-R1", "Yamaha MT-09", "Honda CBR600RR", "Honda Africa Twin",
  "Kawasaki Ninja", "Kawasaki Z900", "Ducati Panigale", "Ducati Monster",
  "Harley-Davidson Sportster", "Harley-Davidson Street Glide",
  "BMW R1250GS", "BMW S1000RR",
];

const PLATE_ICONS = ["M", "B", "T", "G", "N", "Y", "Z", "O"];

const CAR_COLORS = [
  "White", "Black", "Silver", "Gray",
  "Red", "Blue", "Green", "Yellow",
  "Brown", "Beige", "Gold", "Orange",
  "Maroon", "Purple", "Pink",
  "Bronze", "Champagne", "Pearl White", "Pearl Black",
];

/* Fill a <select> with the given values. Keeps the placeholder
   (disabled+hidden) option and re-syncs SearchSelect. */
function fillStaticSelect(selectEl, values){
  if (!selectEl) return;
  const cur = selectEl.value;
  const placeholder = selectEl.querySelector('option[disabled][hidden]')?.outerHTML || "";
  selectEl.innerHTML = placeholder
    + values.map(v => `<option value="${escape(v)}">${escape(v)}</option>`).join("");
  if (cur && values.includes(cur)) selectEl.value = cur;
  if (selectEl._ss) selectEl._ss.sync();
}

/* Show an error message under the named field. Pass null/"" to clear it. */
function setFieldError(form, fieldName, message){
  const el = form.querySelector(`[data-error-for="${fieldName}"]`);
  if (!el) return;
  el.textContent = message || "";
  el.hidden = !message;
}

function clearAllFieldErrors(form){
  $$("[data-error-for]", form).forEach(el => { el.textContent = ""; el.hidden = true; });
}

/* Client-side required-field check. For each name in `fields`, look up the
   form's value via FormData and paint a "Required" error on any blank one.
   Returns true when every field has a value. */
function validateRequiredFields(form, fields){
  const fd = new FormData(form);
  let allOk = true;
  for (const name of fields){
    const raw = fd.get(name);
    const val = (raw == null ? "" : String(raw)).trim();
    if (!val){
      setFieldError(form, name, t("field.required"));
      allOk = false;
    }
  }
  return allOk;
}

/* Pick the closest matching option from a list of values. Looks for a
   case-insensitive substring match in either direction (e.g. NHTSA
   "Camry" → "Toyota Camry" in our model list). Returns null on no hit. */
function bestMatchOption(needle, haystack){
  if (!needle) return null;
  const n = needle.toLowerCase().trim();
  // exact (ci) first
  const exact = haystack.find(v => v.toLowerCase() === n);
  if (exact) return exact;
  // substring either direction
  const sub = haystack.find(v => v.toLowerCase().includes(n) || n.includes(v.toLowerCase()));
  return sub || null;
}

function setupAddCarForm(){
  const form = $("#form-add-car");
  if (!form) return;

  // Fill the four static dropdowns up-front.
  fillStaticSelect($("#add-car-type"),  CAR_TYPES);
  fillStaticSelect($("#add-car-model"), CAR_MODELS);
  fillStaticSelect($("#add-car-color"), CAR_COLORS);
  fillStaticSelect($("#add-car-icon"),  PLATE_ICONS);

  /* Pre-known VIN registry (loaded from the backend). Lets the user pick
     a VIN from a searchable dropdown; selecting one auto-fills type,
     model, and color. Free typing for unknown VINs is still allowed. */
  const knownVinsByVin = Object.create(null);

  async function loadKnownVins(){
    try {
      const r = await fetch(API.url("/api/known-vins"));
      if (!r.ok) return;
      const list = await r.json();
      const datalist = $("#known-vins-list");
      if (datalist){
        datalist.innerHTML = list.map(v =>
          `<option value="${escape(v.vin)}" label="${escape(`${v.model} (${v.type}, ${v.color})`)}">`
        ).join("");
      }
      list.forEach(v => { knownVinsByVin[v.vin.toUpperCase()] = v; });
    } catch (e){
      // Soft-fail — the form still works without the registry.
    }
  }
  loadKnownVins();

  // VIN split mode: prefix (11 chars, locked) + serial (6 chars, editable)
  const vinFullMode  = $("#vin-full-mode");
  const vinSplitMode = $("#vin-split-mode");
  const vinPrefixBadge = $("#vin-prefix-badge");
  const vinSerialInput = $("#vin-serial-input");
  const vinEditFullBtn = $("#vin-edit-full-btn");
  let _vinPrefix = "";
  let _vinOrigSerial = "";   // last 6 of the picked VIN, shown as a shadow

  function enterSplitMode(vin){
    const v = (vin || "").toUpperCase();
    _vinPrefix = v.substring(0, 11);
    _vinOrigSerial = v.substring(11);   // VIN is 17 chars → last 6
    if (vinPrefixBadge) vinPrefixBadge.textContent = _vinPrefix;
    if (vinSerialInput){
      // Leave the field empty but show the car's original last-6 as a
      // placeholder "shadow" the user can type over (or keep as-is).
      vinSerialInput.value = "";
      vinSerialInput.placeholder = _vinOrigSerial || "000000";
    }
    if (vinFullMode)  vinFullMode.hidden = true;
    if (vinSplitMode) vinSplitMode.hidden = false;
    setTimeout(() => vinSerialInput?.focus(), 50);
  }

  // The effective serial: what the user typed, or — if they left it blank —
  // the original shadow value of the selected VIN.
  function _currentSerial(){
    const typed = (vinSerialInput?.value || "").toUpperCase();
    return typed || _vinOrigSerial;
  }

  function exitSplitMode(){
    const serial = _currentSerial();
    const fullVin = _vinPrefix + serial;
    const vinInput2 = form.querySelector('input[name="vin"]');
    if (vinInput2) vinInput2.value = fullVin;
    _vinPrefix = "";
    _vinOrigSerial = "";
    if (vinFullMode)  vinFullMode.hidden = false;
    if (vinSplitMode) vinSplitMode.hidden = true;
    lastVinSeen = "";
    setTimeout(() => vinInput2?.focus(), 50);
  }

  function getSplitVin(){
    if (!vinSplitMode?.hidden && _vinPrefix){
      return (_vinPrefix + _currentSerial()).toUpperCase();
    }
    return null;
  }

  if (vinEditFullBtn) vinEditFullBtn.addEventListener("click", exitSplitMode);

  if (vinSerialInput){
    vinSerialInput.addEventListener("input", () => {
      vinSerialInput.value = vinSerialInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });
  }

  function autoFillFromKnown(known){
    const typeSel  = $("#add-car-type");
    const modelSel = $("#add-car-model");
    const colorSel = $("#add-car-color");
    if (typeSel)  { typeSel.value  = known.type;  if (typeSel._ss)  typeSel._ss.sync();  }
    if (modelSel) { modelSel.value = known.model; if (modelSel._ss) modelSel._ss.sync(); }
    if (colorSel) { colorSel.value = known.color; if (colorSel._ss) colorSel._ss.sync(); }
    enterSplitMode(known.vin);
  }

  const vinInput  = form.querySelector('input[name="vin"]');
  const vinHint   = $("#add-car-vin-hint");
  let lastVinSeen = "";

  function setVinHint(kind, _text){
    vinHint.classList.remove("vin-hint-ok", "vin-hint-soft");
    if (kind === "ok"){
      vinHint.classList.add("vin-hint-ok");
      vinHint.textContent = "✓";
      vinHint.hidden = false;
    } else {
      vinHint.textContent = "";
      vinHint.hidden = true;
    }
  }

  function autoFillFromExistingCar(c){
    const typeSel  = $("#add-car-type");
    const modelSel = $("#add-car-model");
    const colorSel = $("#add-car-color");
    const iconSel  = $("#add-car-icon");
    if (typeSel)  { typeSel.value  = c.type  || ""; if (typeSel._ss)  typeSel._ss.sync(); }
    if (modelSel) { modelSel.value = c.model || ""; if (modelSel._ss) modelSel._ss.sync(); }
    if (colorSel) { colorSel.value = c.color || ""; if (colorSel._ss) colorSel._ss.sync(); }

    // Stored plate format: "<icon> <number>". Split on the first space.
    const plate = (c.platenumber || "").toString();
    const sp = plate.indexOf(" ");
    const icon  = sp >= 0 ? plate.slice(0, sp) : "";
    const num   = sp >= 0 ? plate.slice(sp + 1) : plate;
    if (iconSel){ iconSel.value = icon; if (iconSel._ss) iconSel._ss.sync(); }
    const plateInput = form.querySelector('input[name="plate_number"]');
    if (plateInput) plateInput.value = num;

    const gpsCb = $("#add-car-gps");
    if (gpsCb) gpsCb.checked = !!c.has_gps;

    clearAllFieldErrors(form);
  }

  // Look up a VIN across the whole car table. The /api/cars endpoint
  // with no company_id filter returns every active car in the system —
  // the only way to tell, before save, whether another company has
  // already claimed this VIN.
  async function findCarByVinAnywhere(vin){
    try {
      const r = await fetch(API.url(`/api/check-vin?vin=${encodeURIComponent(vin)}`), {
        headers: authHeaders(),
      });
      if (r.status === 204 || !r.ok) return null;
      return await r.json();
    } catch (e){ return null; }
  }

  async function decodeCurrentVin(){
    // In split mode, the prefix is already validated — skip live decode
    if (!vinSplitMode?.hidden && _vinPrefix) return;

    const vin = (vinInput.value || "").trim().toUpperCase();
    if (vin === lastVinSeen) return;
    lastVinSeen = vin;
    setFieldError(form, "vin", "");

    if (!vin){ setVinHint(null, ""); return; }

    // Known registry → enter split mode so the user types their own
    // serial number. Check this FIRST — even if another company already
    // has this exact VIN, the user will change the last 6 digits.
    const known = knownVinsByVin[vin];
    if (known){
      autoFillFromKnown(known);
      setVinHint("ok", "");
      return;
    }

    // Has this exact VIN been registered before?
    const u = AUTH.user();
    const existing = await findCarByVinAnywhere(vin);
    if (existing){
      const sameCompany = u && u.company_id && existing.company_id === u.company_id;
      if (sameCompany){
        autoFillFromExistingCar(existing);
        setVinHint("ok", "");
        showAddCarStatus(t("addCar.alreadyExists"));
      } else {
        const msg = t("addCar.vinTakenOther");
        toast(msg, "error");
        setFieldError(form, "vin", msg);
        vinInput.value = "";
        lastVinSeen = "";
        setVinHint(null, "");
        vinInput.focus();
      }
      return;
    }

    if (vin.length !== 17){
      setVinHint(known ? "ok" : null,
        known ? t("addCar.vinKnown")
                  .replace("{model}", known.model)
                  .replace("{type}",  known.type)
                  .replace("{color}", known.color)
              : "");
      return;
    }

    // 2. Always cross-decode via the backend so the user sees a real
    //    "VIN check passed" indication regardless of whether the VIN was
    //    picked from the registry or typed manually.
    let decodeData = null, decodeOk = true;
    try {
      const r = await fetch(API.url(`/api/decode-vin?vin=${encodeURIComponent(vin)}`), {
        headers: { ...authHeaders() },
      });
      decodeData = await r.json().catch(() => ({}));
      decodeOk = r.ok;
    } catch (err){
      decodeOk = false; decodeData = { error: err.message };
    }

    if (!decodeOk){
      // The backend's vininfo check rejected this VIN (bad checksum,
      // wrong length, etc.) — surface the error inline. Don't keep the
      // auto-filled type/model from a "known" hit because the VIN is
      // invalid.
      setVinHint(null, "");
      setFieldError(form, "vin", decodeData?.error || t("toast.error"));
      return;
    }

    const decodedModel = decodeData?.model || "";
    const decodedType  = decodeData?.type  || "";

    if (known){
      // Known + checksum valid → short, single-line hint. We *did* call
      // /api/decode-vin so the validation pipeline ran; we just don't
      // need to repeat NHTSA's output here when the registry already
      // gave us cleaner data.
      setVinHint("ok",
        `✓ ${known.model} · ${known.type} · ${known.color} — ${t("addCar.vinKnownShort")}`);
      return;
    }

    if (!decodedModel && !decodedType){
      setVinHint("soft", t("addCar.vinDecodedNone"));
      return;
    }

    // Unknown VIN but NHTSA returned data → auto-pick best matches.
    const typeSel  = $("#add-car-type");
    const modelSel = $("#add-car-model");
    const matchType  = bestMatchOption(decodedType,  CAR_TYPES);
    const matchModel = bestMatchOption(decodedModel, CAR_MODELS);
    if (matchType  && !typeSel.value)  { typeSel.value  = matchType;  if (typeSel._ss)  typeSel._ss.sync(); }
    if (matchModel && !modelSel.value) { modelSel.value = matchModel; if (modelSel._ss) modelSel._ss.sync(); }

    setVinHint("ok",
      `✓ NHTSA — ${decodedModel || "—"} · ${decodedType || "—"}`);
  }

  // Full form reset — native reset clears <input>/<select>.value but the
  // enhanced SearchSelect triggers, the VIN hint, the auto-filled
  // dropdowns, and the field-error slots all need manual cleanup.
  form.addEventListener("reset", () => {
    setTimeout(() => {
      [
        $("#add-car-type"), $("#add-car-model"),
        $("#add-car-color"), $("#add-car-icon"),
      ].forEach(sel => {
        if (!sel) return;
        sel.value = "";
        if (sel._ss) sel._ss.sync();
      });
      if (vinHint){ vinHint.hidden = true; vinHint.textContent = ""; }
      clearAllFieldErrors(form);
      lastVinSeen = "";
      _vinPrefix = "";
      if (vinFullMode)  vinFullMode.hidden = false;
      if (vinSplitMode) vinSplitMode.hidden = true;
      if (vinSerialInput) vinSerialInput.value = "";
    }, 0);
  });

  // Picking a value from the datalist triggers `input`. The native blur
  // event also fires once the user tabs away after typing manually.
  vinInput.addEventListener("input",  decodeCurrentVin);
  vinInput.addEventListener("blur",   decodeCurrentVin);
  vinInput.addEventListener("change", decodeCurrentVin);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAllFieldErrors(form);
    const u = AUTH.user();
    if (!u || u.role !== "company" || !u.company_id){
      toast(t("toast.error"), "error");
      return;
    }

    if (!validateRequiredFields(form, [
      "vin", "type", "model", "color", "plate_icon", "plate_number",
    ])){
      toast(t("toast.fillAll"), "error");
      return;
    }

    const fd       = new FormData(form);
    const vin      = (getSplitVin() || (fd.get("vin") || "").toString().trim()).toUpperCase();

    if (vin.length !== 17){
      setFieldError(form, "vin", t("addCar.vinLength"));
      toast(t("addCar.vinLength"), "error");
      return;
    }
    const type     = (fd.get("type")         || "").toString().trim();
    const model    = (fd.get("model")        || "").toString().trim();
    const color    = (fd.get("color")        || "").toString().trim();
    const icon     = (fd.get("plate_icon")   || "").toString().trim();
    const plateRaw = (fd.get("plate_number") || "").toString().trim();
    const has_gps  = fd.get("has_gps") === "on";
    const platenumber = `${icon} ${plateRaw}`.trim();

    try {
      const r = await fetch(API.url("/api/cars"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          vin, type, model, color,
          platenumber,
          company_id: u.company_id,
          has_gps,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok){
        // Server-side validation: paint each error on its corresponding field.
        if (data.errors && typeof data.errors === "object"){
          Object.entries(data.errors).forEach(([k, v]) => setFieldError(form, k, v));
          toast(data.error || t("toast.error"), "error");
        } else {
          toast(data.error || t("toast.error"), "error");
        }
        return;
      }
      // Success: clear everything for the next car, keep no field state behind.
      form.reset();
      [$("#add-car-type"), $("#add-car-model"), $("#add-car-color"), $("#add-car-icon")].forEach(sel => {
        if (!sel) return;
        sel.value = "";
        if (sel._ss) sel._ss.sync();
      });
      const vinHintEl = $("#add-car-vin-hint");
      if (vinHintEl){ vinHintEl.hidden = true; vinHintEl.textContent = ""; }
      lastVinSeen = "";
      showAddCarStatus(t("addCar.saved").replace("{plate}", platenumber));
      toast(t("toast.added"), "success");
      // Update the create-rental Car dropdown with the new entry.
      refreshRentalPickers();
    } catch (err){
      toast(err.message || t("toast.error"), "error");
    }
  });
}

function showAddCarStatus(message){
  const el = $("#add-car-status");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(showAddCarStatus._t);
  showAddCarStatus._t = setTimeout(() => {
    el.hidden = true; el.textContent = "";
  }, 4500);
}

/* ============== ADD CLIENT (company-user tab #3) ============== */
const NATIONALITIES = [
  "Afghan", "Albanian", "Algerian", "American", "Andorran", "Angolan",
  "Antiguan", "Argentine", "Armenian", "Australian", "Austrian", "Azerbaijani",
  "Bahamian", "Bahraini", "Bangladeshi", "Barbadian", "Belarusian", "Belgian",
  "Belizean", "Beninese", "Bhutanese", "Bolivian", "Bosnian", "Botswanan",
  "Brazilian", "British", "Bruneian", "Bulgarian", "Burkinabé", "Burmese",
  "Burundian", "Cambodian", "Cameroonian", "Canadian", "Cape Verdean",
  "Central African", "Chadian", "Chilean", "Chinese", "Colombian", "Comoran",
  "Congolese", "Costa Rican", "Croatian", "Cuban", "Cypriot", "Czech",
  "Danish", "Djiboutian", "Dominican", "Dutch", "East Timorese", "Ecuadorian",
  "Egyptian", "Emirati", "Equatorial Guinean", "Eritrean", "Estonian",
  "Ethiopian", "Fijian", "Filipino", "Finnish", "French", "Gabonese",
  "Gambian", "Georgian", "German", "Ghanaian", "Greek", "Grenadian",
  "Guatemalan", "Guinean", "Guinea-Bissauan", "Guyanese", "Haitian",
  "Honduran", "Hungarian", "Icelander", "Indian", "Indonesian", "Iranian",
  "Iraqi", "Irish", "Israeli", "Italian", "Ivorian", "Jamaican", "Japanese",
  "Jordanian", "Kazakhstani", "Kenyan", "Kiribati", "Kosovar", "Kuwaiti",
  "Kyrgyz", "Laotian", "Latvian", "Lebanese", "Liberian", "Libyan",
  "Liechtensteiner", "Lithuanian", "Luxembourger", "Macedonian", "Malagasy",
  "Malawian", "Malaysian", "Maldivian", "Malian", "Maltese", "Marshallese",
  "Mauritanian", "Mauritian", "Mexican", "Micronesian", "Moldovan",
  "Monégasque", "Mongolian", "Montenegrin", "Moroccan", "Mozambican",
  "Namibian", "Nauruan", "Nepalese", "New Zealander", "Nicaraguan",
  "Nigerien", "Nigerian", "North Korean", "Norwegian", "Omani", "Pakistani",
  "Palauan", "Palestinian", "Panamanian", "Papua New Guinean", "Paraguayan",
  "Peruvian", "Polish", "Portuguese", "Qatari", "Romanian", "Russian",
  "Rwandan", "Saint Lucian", "Salvadoran", "Samoan", "San Marinese", "Saudi",
  "Senegalese", "Serbian", "Seychellois", "Sierra Leonean", "Singaporean",
  "Slovak", "Slovenian", "Solomon Islander", "Somali", "South African",
  "South Korean", "South Sudanese", "Spanish", "Sri Lankan", "Sudanese",
  "Surinamese", "Swazi", "Swedish", "Swiss", "Syrian", "Taiwanese", "Tajik",
  "Tanzanian", "Thai", "Togolese", "Tongan", "Trinidadian", "Tunisian",
  "Turkish", "Turkmen", "Tuvaluan", "Ugandan", "Ukrainian", "Uruguayan",
  "Uzbek", "Vanuatuan", "Vatican", "Venezuelan", "Vietnamese", "Yemeni",
  "Zambian", "Zimbabwean",
];

/* ============== DOCUMENT VALIDATOR ============== */
const DocValidator = (() => {
  const ANALYSIS_SIZE = 300;

  function loadImage(file){
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload  = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Cannot load image")); };
      img.src = url;
    });
  }

  function analyze(img){
    const canvas = document.createElement("canvas");
    const scale  = Math.min(1, ANALYSIS_SIZE / Math.max(img.width, img.height));
    const w = Math.round(img.width  * scale);
    const h = Math.round(img.height * scale);
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const total = w * h;

    let sumBright = 0, highContrast = 0, lightPixels = 0;
    for (let i = 0; i < data.length; i += 4){
      const gray = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
      sumBright += gray;
      if (gray > 200) lightPixels++;
    }
    const avgBright = sumBright / total;
    const lightRatio = lightPixels / total;

    // Edge detection — count pixels with strong horizontal gradient
    let edgeCount = 0;
    for (let y = 0; y < h; y++){
      for (let x = 1; x < w - 1; x++){
        const idx = (y * w + x) * 4;
        const left  = data[idx - 4] * 0.299 + data[idx - 3] * 0.587 + data[idx - 2] * 0.114;
        const right = data[idx + 4] * 0.299 + data[idx + 5] * 0.587 + data[idx + 6] * 0.114;
        if (Math.abs(right - left) > 40) edgeCount++;
      }
    }
    const edgeRatio = edgeCount / total;

    // Aspect ratio — standard ID cards ~1.586, passports ~1.42
    const aspect = Math.max(img.width, img.height) / Math.min(img.width, img.height);
    const goodAspect = aspect >= 1.2 && aspect <= 2.0;

    // Score: documents have light backgrounds, lots of edges (text), reasonable aspect
    let score = 0;
    if (lightRatio > 0.25) score += 30;
    if (lightRatio > 0.40) score += 10;
    if (edgeRatio > 0.06)  score += 25;
    if (edgeRatio > 0.10)  score += 10;
    if (goodAspect)        score += 15;
    if (avgBright > 140)   score += 10;

    return { score, lightRatio, edgeRatio, aspect, avgBright };
  }

  async function validate(file){
    if (!file) return { ok: false, reason: "no_file" };

    if (/^application\/pdf/i.test(file.type)){
      return { ok: true, reason: "pdf" };
    }

    if (!/^image\//i.test(file.type)){
      return { ok: false, reason: "not_image" };
    }

    try {
      const img = await loadImage(file);

      if (img.width < 200 || img.height < 200){
        return { ok: false, reason: "too_small" };
      }

      const r = analyze(img);

      if (r.score >= 50){
        return { ok: true, reason: "document", score: r.score };
      }
      return { ok: false, reason: "not_document", score: r.score, detail: r };
    } catch (e){
      return { ok: false, reason: "error" };
    }
  }

  return { validate };
})();

function setupAddClientForm(){
  const form = $("#form-add-client");
  if (!form) return;

  fillStaticSelect($("#add-client-nationality"), NATIONALITIES);

  // Populate the country-code dropdown — Lebanon (+961) selected by default.
  const codeSel = $("#add-client-phone-code");
  if (codeSel){
    codeSel.innerHTML = _countryOptionsHtml("961");
    if (codeSel._ss) codeSel._ss.sync();
  }

  const photoOpts = {
    previewSel:  "#add-client-photo-preview",
    fallbackSel: "#add-client-photo-fallback",
    clearSel:    "#add-client-photo-clear",
    dataSel:     "#add-client-photo-data",
  };

  LogoPicker.bind({ fileSel: "#add-client-photo-file", ...photoOpts });

  const fileInput = $("#add-client-photo-file");
  const docError  = form.querySelector('[data-error-for="photo"]');

  fileInput.addEventListener("change", async () => {
    const f = fileInput.files[0];
    if (!f) return;

    if (docError) { docError.textContent = ""; docError.hidden = true; }

    // PDF handling
    if (/^application\/pdf/i.test(f.type)){
      const img = $("#add-client-photo-preview");
      const fb  = $("#add-client-photo-fallback");
      img.hidden = true; img.removeAttribute("src");
      fb.hidden = false;
      fb.textContent = "📄 PDF";
      fb.classList.add("logo-preview-doc");
      return;
    }

    // Validate the image looks like a document
    const result = await DocValidator.validate(f);
    if (!result.ok){
      let msg = t("docValidator.notDocument");
      if (result.reason === "too_small") msg = t("docValidator.tooSmall");
      if (result.reason === "not_image") msg = t("docValidator.notImage");

      if (docError) { docError.textContent = msg; docError.hidden = false; }
      toast(msg, "error");

      // Clear the upload
      LogoPicker.reset(photoOpts);
      const fb = $("#add-client-photo-fallback");
      if (fb){ fb.textContent = "+"; fb.classList.remove("logo-preview-doc"); }
      fileInput.value = "";
      return;
    }
  });

  $("#add-client-photo-clear").addEventListener("click", () => {
    const fb = $("#add-client-photo-fallback");
    fb.textContent = "+";
    fb.classList.remove("logo-preview-doc");
    if (docError) { docError.textContent = ""; docError.hidden = true; }
  });

  // -------- ID-type dropdown: shows/hides personid + father/mother. --------
  const idTypeSel = $("#add-client-id-type");
  const pidLabel  = $("#add-client-pid-label");
  function applyIdTypeVisibility(){
    const idt = (idTypeSel?.value || "").trim();
    const nat = ($("#add-client-nationality")?.value || "").trim();
    // The personid input is reused for every id_type — the label
    // describes what number the user is actually typing. In License-only
    // mode the licenseid field is hidden and we route this value into
    // licenseid at submit time (see saveClient).
    if (pidLabel){
      const key = idt === "passport"              ? "addClient.pid.passport"
                : idt === "national_id"           ? "addClient.pid.national"
                : idt === "license"               ? "addClient.pid.license"
                : idt === "international_license" ? "addClient.pid.international"
                : "clients.f.pid";
      pidLabel.setAttribute("data-i18n", key);
      pidLabel.textContent = t(key);
    }
    const uploadLabel = $("#add-client-upload-label");
    if (uploadLabel){
      const ulKey = idt === "passport"              ? "addClient.upload.passport"
                  : idt === "national_id"           ? "addClient.upload.national"
                  : idt === "license"               ? "addClient.upload.license"
                  : idt === "international_license" ? "addClient.upload.international"
                  : "addClient.photoOrDoc";
      uploadLabel.setAttribute("data-i18n", ulKey);
      uploadLabel.textContent = t(ulKey);
    }
    const visit = (el, hidden) => {
      el.hidden = hidden;
      if (hidden){
        // Don't carry stale values from a now-hidden field into the submit.
        el.querySelectorAll("input").forEach(i => { i.value = ""; });
        el.querySelectorAll("[data-error-for]").forEach(slot => {
          slot.textContent = ""; slot.hidden = true;
        });
      }
    };
    form.querySelectorAll("[data-show-for-id-type]").forEach(el => {
      const allowed   = el.dataset.showForIdType.split(/\s+/).filter(Boolean);
      const natWanted = (el.dataset.showForNationality || "").trim();
      const okType = allowed.includes(idt);
      const okNat  = !natWanted || natWanted === nat;
      visit(el, !(okType && okNat));
    });
    form.querySelectorAll("[data-hide-for-id-type]").forEach(el => {
      const blocked = el.dataset.hideForIdType.split(/\s+/).filter(Boolean);
      visit(el, blocked.includes(idt));
    });
  }
  if (idTypeSel) idTypeSel.addEventListener("change", applyIdTypeVisibility);
  const natSelLive = $("#add-client-nationality");
  if (natSelLive) natSelLive.addEventListener("change", applyIdTypeVisibility);
  applyIdTypeVisibility();

  // Full reset: native form reset clears <input>s, but the enhanced
  // SearchSelect triggers, the inline error slots, and the success
  // banner all need a manual sweep.
  form.addEventListener("reset", () => {
    setTimeout(() => {
      const nat = $("#add-client-nationality");
      if (nat){ nat.value = ""; if (nat._ss) nat._ss.sync(); }
      const code = $("#add-client-phone-code");
      if (code){ code.value = "961"; if (code._ss) code._ss.sync(); }
      if (idTypeSel){ idTypeSel.value = ""; if (idTypeSel._ss) idTypeSel._ss.sync(); }
      LogoPicker.reset(photoOpts);
      const fb = $("#add-client-photo-fallback");
      if (fb){ fb.textContent = "+"; fb.classList.remove("logo-preview-doc"); }
      clearAllFieldErrors(form);
      hideAddClientStatus();
      lastPidLookup = "";
      applyIdTypeVisibility();
    }, 0);
  });

  // Cross-company personid autofill. The backend now treats a client
  // as a real person identified by (personid, licenseid) — same person
  // can be linked to many companies. Pre-filling from another
  // company's record means the user just hits Save and the backend
  // links them to this company instead of rejecting a duplicate.
  function parseStoredPhone(stored){
    if (!stored) return { dial: "961", num: "" };
    const m = String(stored).match(/^\+?(\d+)\s+(.+)$/);
    if (m) return { dial: m[1], num: m[2].trim() };
    return { dial: "961", num: String(stored).trim() };
  }

  function autoFillFromClient(c){
    const setVal = (name, val) => {
      const el = form.querySelector(`[name="${name}"]`);
      if (el) el.value = val == null ? "" : String(val);
    };
    setVal("firstname",        c.firstname        || (c.name || "").split(" ")[0] || "");
    setVal("lastname",         c.lastname         || (c.name || "").split(" ").slice(1).join(" ") || "");
    setVal("fathername",       c.fathername       || "");
    setVal("mothername",       c.mothername       || "");
    setVal("dateofbirth",      c.dateofbirth      || "");
    setVal("licenseid",        c.licenseid        || "");
    setVal("startdatelicense", c.startdatelicense || "");
    setVal("enddatelicense",   c.enddatelicense   || "");

    // Restore the canonical record's id_type, falling back to passport
    // for legacy rows that predate this column.
    if (idTypeSel){
      idTypeSel.value = (c.id_type || (c.personid ? "passport" : "license"));
      if (idTypeSel._ss) idTypeSel._ss.sync();
    }

    const natSel = $("#add-client-nationality");
    if (natSel){ natSel.value = c.nationality || ""; if (natSel._ss) natSel._ss.sync(); }

    const { dial, num } = parseStoredPhone(c.phonenumber);
    const phoneCodeSel = $("#add-client-phone-code");
    if (phoneCodeSel){ phoneCodeSel.value = dial; if (phoneCodeSel._ss) phoneCodeSel._ss.sync(); }
    setVal("phonenumber", num);

    if (c.photo){
      LogoPicker.setPreview(photoOpts, c.photo);
      const fb = $("#add-client-photo-fallback");
      if (/^data:application\/pdf/i.test(c.photo)){
        const img = $("#add-client-photo-preview");
        img.hidden = true; img.removeAttribute("src");
        if (fb){ fb.hidden = false; fb.textContent = "📄 PDF"; fb.classList.add("logo-preview-doc"); }
      } else if (fb){
        fb.textContent = "+"; fb.classList.remove("logo-preview-doc");
      }
    } else {
      LogoPicker.reset(photoOpts);
      const fb = $("#add-client-photo-fallback");
      if (fb){ fb.textContent = "+"; fb.classList.remove("logo-preview-doc"); }
    }

    clearAllFieldErrors(form);
    applyIdTypeVisibility();
  }

  const pidInput = form.querySelector('input[name="personid"]');
  let lastPidLookup = "";
  async function lookupExistingClient(){
    const pid = (pidInput.value || "").trim();
    if (pid === lastPidLookup) return;
    lastPidLookup = pid;
    if (!pid){ hideAddClientStatus(); return; }
    try {
      const r = await fetch(
        API.url(`/api/clients/lookup?personid=${encodeURIComponent(pid)}`),
        { headers: authHeaders() },
      );
      if (r.status === 204 || !r.ok) return;
      const c = await r.json().catch(() => null);
      if (!c || !c.personid) return;
      autoFillFromClient(c);
      const linked  = Array.isArray(c.companies) ? c.companies : [];
      const myName  = AUTH.user()?.company?.companyname || "";
      const hasMine = myName && linked.includes(myName);
      const msg = hasMine
        ? t("addClient.alreadyInYours")
        : t("addClient.existsElsewhere").replace("{companies}",
            linked.length ? linked.join(", ") : "—");
      showAddClientStatus(msg);
    } catch (e){ /* soft-fail */ }
  }
  if (pidInput){
    pidInput.addEventListener("blur",   lookupExistingClient);
    pidInput.addEventListener("change", lookupExistingClient);
  }

  async function saveClient(){
    const fd = new FormData(form);
    const dialCode = ($("#add-client-phone-code")?.value || "961").trim();
    const localNum = (fd.get("phonenumber") || "").toString().trim();
    const firstname = (fd.get("firstname") || "").toString().trim();
    const lastname  = (fd.get("lastname")  || "").toString().trim();
    const body = {
      id_type:          (fd.get("id_type")         || "").toString().trim(),
      personid:         (fd.get("personid")        || "").toString().trim(),
      firstname,
      lastname,
      name:             [firstname, lastname].filter(Boolean).join(" "),
      fathername:       (fd.get("fathername")      || "").toString().trim(),
      mothername:       (fd.get("mothername")      || "").toString().trim(),
      nationality:      (fd.get("nationality")     || "").toString().trim(),
      phonenumber:      localNum ? `+${dialCode} ${localNum}` : "",
      dateofbirth:      (fd.get("dateofbirth")      || "").toString().trim(),
      licenseid:        (fd.get("licenseid")        || "").toString().trim(),
      startdatelicense: (fd.get("startdatelicense") || "").toString().trim(),
      enddatelicense:   (fd.get("enddatelicense")   || "").toString().trim(),
      photo:            (fd.get("photo")            || "").toString() || null,
    };

    if (body.id_type === "license" || body.id_type === "international_license"){
      body.licenseid = body.personid;
      body.personid  = "";
    }

    try {
      const r = await fetch(API.url("/api/clients"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok){
        // Duplicate personid / licenseid surface here as DB constraint errors;
        // the unique-violation message points at the right field.
        const msg = data.error || t("toast.error");
        if (/personid/i.test(msg))  setFieldError(form, "personid", msg);
        toast(msg, "error");
        return;
      }
      form.reset();
      const natSel  = $("#add-client-nationality");
      if (natSel){ natSel.value = ""; if (natSel._ss) natSel._ss.sync(); }
      const codeSel2 = $("#add-client-phone-code");
      if (codeSel2){ codeSel2.value = "961"; if (codeSel2._ss) codeSel2._ss.sync(); }
      showAddClientStatus(t("addClient.saved").replace("{pid}", body.personid || body.licenseid));
      toast(t("toast.added"), "success");
      // Keep the admin's clients list and both client pickers in sync.
      await refreshClients();
      refreshRentalPickers();
    } catch (err){
      toast(err.message || t("toast.error"), "error");
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAllFieldErrors(form);
    hideAddClientStatus();
    const u = AUTH.user();
    if (!u || u.role !== "company"){
      toast(t("toast.error"), "error");
      return;
    }

    // Required fields depend on the selected id_type:
    //   passport      → personid + DOB + license dates (+father/mother if Lebanese)
    //   national_id   → personid + DOB + license dates
    //   license       → just licenseid + the always-required basics
    const idt = ($("#add-client-id-type")?.value || "").trim();
    const nat = ($("#add-client-nationality")?.value || "").trim();
    if (!idt){
      setFieldError(form, "id_type", t("field.required"));
      toast(t("toast.fillAll"), "error");
      return;
    }
    const required = ["firstname", "lastname", "nationality", "phonenumber",
                      "startdatelicense", "enddatelicense"];
    if (idt !== "license") required.push("dateofbirth", "licenseid");
    // personid is the visible input for every id_type — license mode
    // hides licenseid and reuses personid as the license number (we
    // route it through to body.licenseid in saveClient).
    required.push("personid");
    // Lebanese clients always need father + mother on record (it's part
    // of the official identity in Lebanon). For every other nationality
    // the fields stay visible but optional.
    // Father/mother names are always optional — kept for Lebanese convention but not enforced.
    if (!validateRequiredFields(form, required)){
      toast(t("toast.fillAll"), "error");
      return;
    }

    // Photo is optional. If the user didn't pick one, ask whether they want
    // to add one now; "Yes" opens the picker and saves once a photo lands,
    // "No" saves immediately without a photo.
    const photoData = ($("#add-client-photo-data")?.value || "").trim();
    if (!photoData){
      const wantPhoto = window.confirm(t("addClient.photo.confirm"));
      if (wantPhoto){
        const fileInput = $("#add-client-photo-file");
        const dataInput = $("#add-client-photo-data");
        if (!fileInput || !dataInput){ await saveClient(); return; }
        // LogoPicker writes to the hidden data field via JS assignment,
        // which doesn't fire input/change events — so hook the file
        // input's native change instead and poll briefly for LogoPicker
        // to finish decoding/resizing. If the user cancels the picker
        // nothing happens; they can press Save again.
        const onPicked = async () => {
          fileInput.removeEventListener("change", onPicked);
          const deadline = Date.now() + 8000;
          while (Date.now() < deadline){
            if ((dataInput.value || "").trim()){ await saveClient(); return; }
            await new Promise(r => setTimeout(r, 80));
          }
        };
        fileInput.addEventListener("change", onPicked);
        fileInput.click();
        return;
      }
    }

    await saveClient();
  });
}

function showAddClientStatus(message){
  const el = $("#add-client-status");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(showAddClientStatus._t);
  showAddClientStatus._t = setTimeout(hideAddClientStatus, 4500);
}

function hideAddClientStatus(){
  const el = $("#add-client-status");
  if (!el) return;
  el.hidden = true;
  el.textContent = "";
}

/* ============== CREATE RENTAL (company-user, on the Report tab) ====== */
async function refreshRentalPickers(){
  const u = AUTH.user();
  if (!u || u.role !== "company" || !u.company_id) return;

  // Cars belonging to this company. The /api/cars list endpoint already
  // returns the joined companyname for the label.
  let cars = [];
  try {
    cars = await fetch(API.url(`/api/cars?company_id=${u.company_id}`)).then(r => r.json());
  } catch (e){ cars = []; }

  // The backend filters clients by company for company users, so this
  // automatically returns only the user's own clients.
  let clients = [];
  try {
    clients = await fetch(API.url("/api/clients"), { headers: authHeaders() }).then(r => r.json());
  } catch (e){ clients = []; }

  const carSel = $("#rental-car-select");
  if (carSel){
    const placeholder = carSel.querySelector('option[disabled][hidden]')?.outerHTML || "";
    const opts = cars.map(c =>
      `<option value="${escape(c.vin)}">${escape(`${c.model} — ${c.platenumber} (${c.vin})`)}</option>`
    ).join("");
    carSel.innerHTML = placeholder + opts;
    carSel.value = "";
    if (carSel._ss) carSel._ss.sync();
  }
  const clientSel = $("#rental-client-select");
  if (clientSel){
    const placeholder = clientSel.querySelector('option[disabled][hidden]')?.outerHTML || "";
    const opts = clients.map(c =>
      `<option value="${c.id}">${escape(`${c.name || c.personid} — ${c.licenseid || ""}`)}</option>`
    ).join("");
    clientSel.innerHTML = placeholder + opts;
    clientSel.value = "";
    if (clientSel._ss) clientSel._ss.sync();
  }
}

function setupCreateRentalForm(){
  const form = $("#form-create-rental");
  if (!form) return;

  // Reset hook — clear selects + errors + status banner.
  form.addEventListener("reset", () => {
    setTimeout(() => {
      ["#rental-car-select", "#rental-client-select"].forEach(sel => {
        const el = $(sel);
        if (!el) return;
        el.value = "";
        if (el._ss) el._ss.sync();
      });
      clearAllFieldErrors(form);
      hideCreateRentalStatus();
    }, 0);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAllFieldErrors(form);
    hideCreateRentalStatus();

    const u = AUTH.user();
    if (!u || u.role !== "company" || !u.company_id){
      toast(t("toast.error"), "error");
      return;
    }

    const fd = new FormData(form);
    const body = {
      car_vin:    (fd.get("car_vin")    || "").toString().trim(),
      client_id:  Number(fd.get("client_id")) || null,
      start_date: (fd.get("start_date") || "").toString().trim(),
      end_date:   (fd.get("end_date")   || "").toString().trim(),
    };

    // Light client-side checks before the round-trip
    let firstError = null;
    if (!body.car_vin)    { setFieldError(form, "car_vin",    t("rental.create.err.car"));    firstError = "car_vin"; }
    if (!body.client_id)  { setFieldError(form, "client_id",  t("rental.create.err.client")); firstError = firstError || "client_id"; }
    if (!body.start_date) { setFieldError(form, "start_date", t("rental.create.err.start"));  firstError = firstError || "start_date"; }
    if (!body.end_date)   { setFieldError(form, "end_date",   t("rental.create.err.end"));    firstError = firstError || "end_date"; }
    if (body.start_date && body.end_date && body.end_date < body.start_date){
      setFieldError(form, "end_date", t("rental.create.err.range"));
      firstError = firstError || "end_date";
    }
    if (firstError){ toast(t("toast.error"), "error"); return; }

    const today = new Date().toISOString().slice(0, 10);
    const isToday = body.start_date === today;
    const endpoint = isToday ? "/api/rentals" : "/api/reservations";

    try {
      const r = await fetch(API.url(endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok){
        const msg = data.error || t("toast.error");
        if (/car/i.test(msg))  setFieldError(form, "car_vin", msg);
        else if (/date/i.test(msg) || /reservation/i.test(msg)) setFieldError(form, "end_date", msg);
        toast(msg, "error");
        return;
      }
      form.reset();
      if (isToday){
        showCreateRentalStatus(t("rental.create.saved"));
      } else {
        showCreateRentalStatus(t("rental.create.reserved"));
      }
      toast(t("toast.added"), "success");
      await refreshReport();
      await Reservations.refresh();
    } catch (err){
      toast(err.message || t("toast.error"), "error");
    }
  });
}

function showCreateRentalStatus(message){
  const el = $("#create-rental-status");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(showCreateRentalStatus._t);
  showCreateRentalStatus._t = setTimeout(hideCreateRentalStatus, 4500);
}
function hideCreateRentalStatus(){
  const el = $("#create-rental-status");
  if (!el) return;
  el.hidden = true; el.textContent = "";
}

/* CSV bulk upload (company user, validates VINs against NHTSA). */
function setupAddCarCsv(){
  const fileInp = $("#add-car-csv-file");
  const chip    = $("#add-car-csv-chip");
  const tplBtn  = $("#btn-add-car-template");
  const upBtn   = $("#btn-add-car-upload");
  const results = $("#add-car-upload-results");
  if (!fileInp) return;

  let selected = null;

  fileInp.addEventListener("change", () => {
    selected = fileInp.files[0] || null;
    if (!selected){
      chip.hidden = true;
      chip.innerHTML = "";
      return;
    }
    chip.hidden = false;
    chip.innerHTML =
      `<div class="file-chip">
         <span class="file-chip-icon">📄</span>
         <span class="file-chip-name">${escape(selected.name)}</span>
         <span class="file-chip-size">${escape(formatBytes(selected.size))}</span>
       </div>`;
    if (results){ results.hidden = true; }
  });

  tplBtn?.addEventListener("click", () => {
    const csv =
      "vin,type,model,color,icon,plate_number\n" +
      "1HGCM82633A004352,Sedan,Honda Accord,White,M,123456\n" +
      "5YJSA1E26HF123456,SUV,Tesla Model X,Black,B,789012\n";
    downloadFile("add_cars_template.csv", csv);
  });

  upBtn?.addEventListener("click", async () => {
    if (!selected){ toast(t("upload.no.file"), "error"); return; }
    const fd = new FormData();
    fd.append("file", selected);

    try {
      const r = await fetch(API.url("/api/cars/upload-csv"), {
        method: "POST",
        // No "Content-Type" header — the browser fills it in with the
        // multipart boundary for FormData.
        headers: { ...authHeaders() },
        body: fd,
      });
      const data = await r.json().catch(() => ({}));

      // The endpoint now returns 400 with the full error list when any
      // row is invalid (all-or-nothing). Render the same way as a 200
      // response so the user can see which rows to fix.
      const failed = data.failed || [];
      const inserted = data.inserted || 0;

      $("#add-car-upload-ok").textContent   = inserted;
      $("#add-car-upload-fail").textContent = failed.length;
      $("#add-car-upload-errors").innerHTML = failed.length
        ? failed.map(e => `<li><strong>Row ${escape(String(e.row))}</strong>: ${escape(e.error)}</li>`).join("")
        : "";
      results.classList.toggle("rejected", !r.ok);
      results.hidden = false;

      if (!r.ok){
        toast(data.error || t("addCar.bulk.rejected"), "error");
      } else if (inserted > 0){
        toast(t("toast.added"), "success");
      }
    } catch (err){
      toast(err.message || t("toast.error"), "error");
    }
  });
}

function setupBranchModal(){
  // The branch form is inline inside the Company Info tab. Each click of
  // "+ Add Branch" appends a fresh form instance to #branch-forms-list, so
  // multiple branches can be filled in and saved independently.
  $("#btn-toggle-branch-form")?.addEventListener("click", appendInlineBranchForm);
}

/* ============== TABLE FILTERS (admin) ============== */
function debounce(fn, ms = 120){
  let timer;
  return () => { clearTimeout(timer); timer = setTimeout(fn, ms); };
}

/* Clear a filter <select> back to its placeholder ("— All —") and refresh
   the SearchSelect wrapper so the trigger label updates. */
function clearFilterSelect(sel){
  if (!sel) return;
  sel.value = "";
  if (sel._ss) sel._ss.sync();
}

function rebuildCarsVinDropdown(){
  const company = $("#filter-cars-company")?.value || "";
  const vinSel  = $("#filter-cars-vin");
  if (!vinSel) return;
  if (company){
    const vins = state.cars
      .filter(c => c.companyname === company)
      .map(c => c.vin);
    populateFilterSelect(vinSel, vins);
    vinSel.disabled = false;
  } else {
    // Reset the VIN dropdown to its disabled placeholder.
    const placeholder = vinSel.querySelector('option[disabled][hidden]')?.outerHTML
      || `<option value="" disabled selected hidden>${escape(t("filter.vinHint"))}</option>`;
    vinSel.innerHTML = placeholder;
    vinSel.value = "";
    vinSel.disabled = true;
    if (vinSel._ss) vinSel._ss.sync();
  }
}

function setupReportSearch(){
  // ---------- Companies toolbar ----------
  $("#filter-companies-name")?.addEventListener("change", () => { Pager.reset("companies"); renderCompanies(); });
  $("#filter-companies-clear")?.addEventListener("click", () => {
    clearFilterSelect($("#filter-companies-name"));
    Pager.reset("companies");
    renderCompanies();
  });

  // ---------- Cars toolbar (with cascading VIN) ----------
  $("#filter-cars-company")?.addEventListener("change", () => {
    rebuildCarsVinDropdown();
    Pager.reset("cars");
    renderCars();
  });
  $("#filter-cars-vin")?.addEventListener("change", () => { Pager.reset("cars"); renderCars(); });
  $("#filter-cars-clear")?.addEventListener("click", () => {
    clearFilterSelect($("#filter-cars-company"));
    rebuildCarsVinDropdown();
    Pager.reset("cars");
    renderCars();
  });

  // ---------- Clients toolbar ----------
  $("#filter-clients-lic")?.addEventListener("change", () => { Pager.reset("clients"); renderClients(); });
  $("#filter-clients-name")?.addEventListener("change", () => { Pager.reset("clients"); renderClients(); });
  $("#filter-clients-clear")?.addEventListener("click", () => {
    clearFilterSelect($("#filter-clients-lic"));
    clearFilterSelect($("#filter-clients-name"));
    Pager.reset("clients");
    renderClients();
  });

  // ---------- Report toolbar ----------
  $("#filter-report-company")?.addEventListener("change", () => { Pager.reset("report"); renderReport(); });
  $("#filter-report-client")?.addEventListener("change", () => { Pager.reset("report"); renderReport(); });
  $("#filter-report-lic")?.addEventListener("change", () => { Pager.reset("report"); renderReport(); });
  $("#report-from")?.addEventListener("change", () => { Pager.reset("report"); renderReport(); });
  $("#report-to")?.addEventListener("change", () => { Pager.reset("report"); renderReport(); });
  $("#report-reset")?.addEventListener("click", () => {
    clearFilterSelect($("#filter-report-company"));
    clearFilterSelect($("#filter-report-client"));
    clearFilterSelect($("#filter-report-lic"));
    const f = $("#report-from"); if (f) f.value = "";
    const t2 = $("#report-to");  if (t2) t2.value = "";
    Pager.reset("report");
    renderReport();
  });

  // ---------- Report toolbar (company user) ----------
  $("#filter-report-client-co")?.addEventListener("change", () => { Pager.reset("report"); renderReport(); });
  $("#filter-report-car-co")?.addEventListener("change",    () => { Pager.reset("report"); renderReport(); });
  $("#report-from-co")?.addEventListener("change", () => { Pager.reset("report"); renderReport(); });
  $("#report-to-co")?.addEventListener("change",   () => { Pager.reset("report"); renderReport(); });
  $("#report-reset-co")?.addEventListener("click", () => {
    clearFilterSelect($("#filter-report-client-co"));
    clearFilterSelect($("#filter-report-car-co"));
    const f = $("#report-from-co"); if (f) f.value = "";
    const t2 = $("#report-to-co");  if (t2) t2.value = "";
    Pager.reset("report");
    renderReport();
  });
}

/* Common header for endpoints that need the current-user identity. */
function authHeaders(){
  const u = (typeof AUTH !== "undefined") ? AUTH.user() : null;
  return u ? { "X-Auth-User": u.username } : {};
}

/* ============== AUTH (validated against users table) ============== */
const AUTH = {
  KEY: "carrental.auth",
  isAuthed(){ return sessionStorage.getItem(this.KEY) === "1"; },
  user(){
    try { return JSON.parse(sessionStorage.getItem(this.KEY + ".user") || "null"); }
    catch (e){ return null; }
  },
  async signIn(u, p){
    try {
      const r = await fetch(API.url("/api/login"), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ username: u, password: p }),
      });
      if (!r.ok) return false;
      const user = await r.json();
      sessionStorage.setItem(this.KEY, "1");
      sessionStorage.setItem(this.KEY + ".user", JSON.stringify(user));
      return true;
    } catch (e){
      console.error(e);
      return false;
    }
  },
  signOut(){
    sessionStorage.removeItem(this.KEY);
    sessionStorage.removeItem(this.KEY + ".user");
  }
};

/* ----- header profile (logo + username) ----- */
function renderHeaderProfile(){
  const profile = $("#user-profile");
  const logoEl  = $("#user-profile-logo");
  const fbEl    = $("#user-profile-fallback");
  const nameEl  = $("#user-profile-name");
  if (!profile) return;

  const user = AUTH.user();
  if (!user){
    profile.hidden = true;
    return;
  }

  const company = user.company || null;
  const displayName = company ? company.companyname : user.username;
  nameEl.textContent = displayName || "";

  const logo = company && company.logo ? company.logo : "";
  if (logo){
    logoEl.src = logo;
    logoEl.alt = displayName || "";
    logoEl.hidden = false;
    fbEl.hidden = true;
  } else {
    logoEl.hidden = true;
    logoEl.removeAttribute("src");
    fbEl.textContent = (displayName || "?").trim().charAt(0).toUpperCase();
    fbEl.hidden = false;
  }
  profile.hidden = false;
}

/* Refresh the header profile from the latest companies list (for logo
   changes that happen *after* login, e.g. an admin uploaded one). */
function refreshHeaderFromCompanies(){
  const user = AUTH.user();
  if (!user || !user.company_id) return;
  const fresh = state.companies.find(c => c.id === user.company_id);
  if (!fresh) return;
  user.company = {
    ...(user.company || {}),
    id:          fresh.id,
    companyname: fresh.companyname,
    location:    fresh.location,
    companyid:   fresh.companyid,
    phonenumber: fresh.phonenumber,
    x:           fresh.x,
    y:           fresh.y,
    logo:        fresh.logo,
  };
  sessionStorage.setItem(AUTH.KEY + ".user", JSON.stringify(user));
  renderHeaderProfile();
  renderReportCompanyHead();
}

function updateStatsDashboard(){
  const el = (id, val) => { const e = $(`#${id}`); if (e) e.textContent = val; };
  el("stat-companies", state.companies.length);
  el("stat-cars",      state.cars.length);
  el("stat-clients",   state.clients.length);
  el("stat-rentals",   state.report.length);

  const dateEl = $("#dash-date");
  if (dateEl){
    const now = new Date();
    dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
  }
}

/* ---- Dashboard feed helpers ---- */
const DASH_PAGE_SIZE = 20;

function _matchSearch(text, query){
  if (!query) return true;
  return text.toLowerCase().includes(query.toLowerCase());
}

function _searchText(c){
  return `${c.companyname} ${c.phonenumber||""} ${c.location||""} ${c.owner_name||""} ${c.username||""}`;
}

/* Relative "time ago" from an ISO timestamp, e.g. "3h", "2d", "just now". */
function _timeAgo(iso){
  if (!iso) return "";
  const then = new Date(iso);
  if (isNaN(then)) return "";
  const secs = Math.max(0, (Date.now() - then.getTime()) / 1000);
  const mins = Math.floor(secs / 60);
  const hrs  = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (days >= 1) return `${days}${t("time.d")}`;
  if (hrs  >= 1) return `${hrs}${t("time.h")}`;
  if (mins >= 1) return `${mins}${t("time.m")}`;
  return t("time.now");
}

/* One row in a company's expand-on-click activity timeline. */
function _timelineItemHtml(a){
  const verb = t(`activity.${a.action}`);
  const ent  = t(`activity.entity.${a.entity}`);
  const when = a.created_at ? _timeAgo(a.created_at) : "";
  const who  = a.username ? ` · ${escape(a.username)}` : "";
  return `<div class="dash-timeline-item">
    <span class="dash-timeline-when">${escape(when)}</span>
    <span class="dash-timeline-text">${escape(verb)} ${escape(ent)}${a.detail ? ` — ${escape(a.detail)}` : ""}${who}</span>
  </div>`;
}

function _activityItemHtml(c){
  const phone = c.phonenumber
    ? c.phonenumber.split(",").map(p => p.trim()).filter(Boolean)
        .map(p => `<a href="tel:${escape(p)}">${escape(p)}</a>`).join(" · ")
    : `<span style="color:var(--muted)">—</span>`;
  const dotCls = c.active_24h ? "active" : "idle";
  const chips = [];
  if (c.cars_24h > 0)
    chips.push(`<span class="dash-activity-chip cars">${c.cars_24h} ${escape(t("dash.chip.cars"))}</span>`);
  if (c.clients_24h > 0)
    chips.push(`<span class="dash-activity-chip clients">${c.clients_24h} ${escape(t("dash.chip.clients"))}</span>`);
  if (c.rentals_24h > 0)
    chips.push(`<span class="dash-activity-chip rentals">${c.rentals_24h} ${escape(t("dash.chip.rentals"))}</span>`);
  if (c.reservations_24h > 0)
    chips.push(`<span class="dash-activity-chip reservations">${c.reservations_24h} ${escape(t("dash.chip.reservations"))}</span>`);
  if (!c.has_activity)
    chips.push(`<span class="dash-activity-chip none">${escape(t("dash.chip.noData"))}</span>`);
  else if (!c.active_24h)
    chips.push(`<span class="dash-activity-chip none">${escape(t("dash.chip.idle"))}</span>`);
  // Sub-line: last login + whether they've ever added data.
  const login = c.last_login
    ? `${escape(t("dash.lastLogin"))}: ${escape(_timeAgo(c.last_login))} ${escape(t("dash.ago"))}`
    : escape(t("dash.neverLoggedIn"));
  return `<div class="dash-activity-item" data-company-id="${c.id}">
    <div class="dash-activity-row">
      <span class="dash-activity-dot ${dotCls}"></span>
      <div class="dash-activity-info">
        <span class="dash-activity-name">${escape(c.companyname)} <span class="dash-activity-expand">▾</span></span>
        <span class="dash-activity-meta">📞 ${phone}${c.location ? ` · 📍 ${escape(c.location)}` : ""}${c.owner_name ? ` · ${escape(c.owner_name)}` : ""}</span>
        <span class="dash-activity-sub">${login}</span>
      </div>
      <div class="dash-activity-stats">${chips.join("")}</div>
    </div>
    <div class="dash-activity-timeline" hidden></div>
  </div>`;
}

function _inactiveItemHtml(c){
  const phone = c.phonenumber
    ? c.phonenumber.split(",").map(p => p.trim()).filter(Boolean)
        .map(p => `<a href="tel:${escape(p)}">${escape(p)}</a>`).join(" · ")
    : `<span style="color:var(--muted)">—</span>`;
  const owner = c.owner_name ? escape(c.owner_name) : "";
  const ownerBit = owner ? ` · ${owner}` : "";
  const days = c.days_inactive >= 1
    ? `${c.days_inactive} ${t("alert.inactive.days")}`
    : `${c.hours_inactive}h`;
  const login = c.last_login
    ? `${escape(t("dash.lastLogin"))}: ${escape(_timeAgo(c.last_login))} ${escape(t("dash.ago"))}`
    : escape(t("dash.neverLoggedIn"));
  const dataNote = c.has_activity ? "" : ` &middot; ${escape(t("dash.chip.noData"))}`;
  return `<div class="alert-card">
    <div class="alert-card-info">
      <span class="alert-card-name">${escape(c.companyname)}${ownerBit}</span>
      <span class="alert-card-meta">
        📞 ${phone}
        ${c.location ? ` · 📍 ${escape(c.location)}` : ""}
        · 👤 ${escape(c.username)}
      </span>
      <span class="alert-card-meta">${login}${dataNote}</span>
    </div>
    <span class="alert-card-badge">${escape(days)} ${t("alert.inactive.ago")}</span>
  </div>`;
}

function _loadMoreBar(shown, total){
  if (shown >= total) return "";
  return `<div class="dash-load-more">
    <button type="button" class="dash-load-more-btn">
      ${escape(t("dash.loadMore"))} <span class="dash-load-more-count">(${shown} / ${total})</span>
    </button>
  </div>`;
}

/* Populate a dashboard company <select> with all registered company names.
   Keeps the "— All companies —" placeholder and re-syncs SearchSelect. */
function _populateDashCompanySelect(selectEl, companies){
  if (!selectEl) return;
  const cur = selectEl.value;
  const placeholder = selectEl.querySelector('option[disabled][hidden]')?.outerHTML || "";
  const names = Array.from(new Set(companies.map(c => c.companyname).filter(Boolean)))
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: "base" }));
  selectEl.innerHTML = placeholder
    + `<option value="">${escape(t("dash.search.allCompanies"))}</option>`
    + names.map(n => `<option value="${escape(n)}">${escape(n)}</option>`).join("");
  if (cur && names.includes(cur)) selectEl.value = cur;
  if (selectEl._ss) selectEl._ss.sync();
}

/* ---- Dashboard: activity feed ---- */
let _dashActivityData = [];
let _dashActivityShown = DASH_PAGE_SIZE;

function renderDashActivity(){
  const list = $("#dash-activity-list");
  const countBadge = $("#dash-active-count");
  if (!list) return;
  const selected = ($("#dash-activity-search")?.value || "").trim();
  const filtered = selected
    ? _dashActivityData.filter(c => c.companyname === selected)
    : _dashActivityData;
  const activeCount = filtered.filter(c => c.active_24h).length;
  if (countBadge) countBadge.textContent = `${activeCount} / ${filtered.length}`;

  if (!filtered.length){
    list.innerHTML = `<p class="dash-empty">${escape(selected ? t("dash.search.none") : t("dash.activity.empty"))}</p>`;
    return;
  }
  const page = filtered.slice(0, _dashActivityShown);
  list.innerHTML = page.map(_activityItemHtml).join("")
    + _loadMoreBar(_dashActivityShown, filtered.length);

  const moreBtn = list.querySelector(".dash-load-more-btn");
  if (moreBtn) moreBtn.addEventListener("click", () => {
    _dashActivityShown += DASH_PAGE_SIZE;
    renderDashActivity();
  });

  // Click a company row to expand a timeline of what they've been doing.
  list.querySelectorAll(".dash-activity-row").forEach(rowEl => {
    rowEl.addEventListener("click", async () => {
      const item = rowEl.closest(".dash-activity-item");
      const tl   = item?.querySelector(".dash-activity-timeline");
      if (!tl) return;
      if (!tl.hidden){ tl.hidden = true; return; }
      if (!tl.dataset.loaded){
        tl.innerHTML = `<p class="dash-empty">${escape(t("dash.loading"))}</p>`;
        try {
          const r = await fetch(API.url(`/api/company-activity/${item.dataset.companyId}`),
                                { headers: authHeaders() });
          const data = r.ok ? await r.json() : [];
          tl.innerHTML = data.length
            ? data.map(_timelineItemHtml).join("")
            : `<p class="dash-empty">${escape(t("dash.timeline.empty"))}</p>`;
        } catch (e){
          tl.innerHTML = `<p class="dash-empty">${escape(t("dash.timeline.empty"))}</p>`;
        }
        tl.dataset.loaded = "1";
      }
      tl.hidden = false;
    });
  });
}

let _dashActivityRaw = "";
async function loadDashboardActivity(silent = false){
  const u = AUTH.user();
  if (!u || u.role !== "admin") return;
  let raw;
  try {
    const r = await fetch(API.url("/api/dashboard-activity"), { headers: authHeaders() });
    if (!r.ok) return;
    raw = await r.text();
  } catch (e){
    if (silent) return;        // transient error on an auto-poll → keep current view
    raw = "[]";
  }
  // On a silent auto-refresh, skip the whole re-render when nothing changed.
  // This keeps any expanded company timeline + "load more" position intact.
  if (silent && raw === _dashActivityRaw){ DashboardLive.ensure(); return; }
  _dashActivityRaw = raw;
  try { _dashActivityData = JSON.parse(raw) || []; } catch (e){ _dashActivityData = []; }
  if (!silent) _dashActivityShown = DASH_PAGE_SIZE;
  // The dropdown lists every registered company (both active + inactive).
  _populateDashCompanySelect($("#dash-activity-search"), _dashActivityData);
  _populateDashCompanySelect($("#dash-inactive-search"), _dashActivityData);
  renderDashActivity();
  const searchEl = $("#dash-activity-search");
  if (searchEl && !searchEl._wired){
    searchEl._wired = true;
    searchEl.addEventListener("change", () => { _dashActivityShown = DASH_PAGE_SIZE; renderDashActivity(); });
  }
  DashboardLive.ensure();   // start the live auto-refresh once the admin lands here
}

/* ---- Dashboard: inactive alerts ---- */
let _dashInactiveData = [];
let _dashInactiveShown = DASH_PAGE_SIZE;

function renderInactiveAlerts(){
  const box  = $("#inactive-alert-box");
  const list = $("#inactive-alert-list");
  const cnt  = $("#inactive-alert-count");
  if (!box || !list) return;
  if (!_dashInactiveData.length){ box.hidden = true; return; }
  box.hidden = false;

  const selected = ($("#dash-inactive-search")?.value || "").trim();
  const filtered = selected
    ? _dashInactiveData.filter(c => c.companyname === selected)
    : _dashInactiveData;
  if (cnt) cnt.textContent = filtered.length;

  if (!filtered.length){
    list.innerHTML = `<p class="dash-empty" style="padding:.8rem 1rem">${escape(t("dash.search.none"))}</p>`;
    return;
  }
  const page = filtered.slice(0, _dashInactiveShown);
  list.innerHTML = page.map(_inactiveItemHtml).join("")
    + _loadMoreBar(_dashInactiveShown, filtered.length);

  const moreBtn = list.querySelector(".dash-load-more-btn");
  if (moreBtn) moreBtn.addEventListener("click", () => {
    _dashInactiveShown += DASH_PAGE_SIZE;
    renderInactiveAlerts();
  });
}

let _dashInactiveRaw = "";
async function loadInactiveAlerts(silent = false){
  const u = AUTH.user();
  if (!u || u.role !== "admin") return;
  let raw;
  try {
    const r = await fetch(API.url("/api/inactive-companies"), { headers: authHeaders() });
    if (!r.ok) return;
    raw = await r.text();
  } catch (e){
    if (silent) return;
    raw = "[]";
  }
  if (silent && raw === _dashInactiveRaw) return;
  _dashInactiveRaw = raw;
  try { _dashInactiveData = JSON.parse(raw) || []; } catch (e){ _dashInactiveData = []; }
  if (!silent) _dashInactiveShown = DASH_PAGE_SIZE;
  renderInactiveAlerts();
  const searchEl = $("#dash-inactive-search");
  if (searchEl && !searchEl._wired){
    searchEl._wired = true;
    searchEl.addEventListener("change", () => { _dashInactiveShown = DASH_PAGE_SIZE; renderInactiveAlerts(); });
  }
}

/* ---- Dashboard live auto-refresh ----
   Re-polls the activity + inactive feeds every few seconds so the admin
   sees logins and newly-added data appear without a manual refresh.
   Polling only runs while an admin is signed in, the browser tab is
   visible, and the dashboard section is on screen — so it costs nothing
   otherwise. Plain polling (no shared server state) so it works with the
   multi-worker gunicorn deployment. The loaders above no-op the re-render
   when the payload is unchanged, so this is cheap and non-disruptive. */
const DashboardLive = (() => {
  const INTERVAL_MS = 5000;
  let timer = null;

  function dashboardVisible(){
    const sd = document.getElementById("stats-dashboard");
    // The admin sidebar toggles this section between display "" and "none".
    return !!sd && sd.style.display !== "none" && !sd.hidden;
  }

  // Refresh whichever admin tab is currently open, so the admin sees a
  // company's new cars / clients / rentals / reservations appear without
  // touching the page. Each refresher re-fetches + re-renders; the Pager
  // keeps the current page, and filter dropdowns keep their selection.
  async function refreshActivePanel(){
    const panel = (typeof AdminSidebar !== "undefined" && AdminSidebar.current)
      ? AdminSidebar.current() : "dashboard";
    try {
      switch (panel){
        case "dashboard":
          await loadDashboardActivity(true);
          await loadInactiveAlerts(true);
          // Keep the stat cards (companies / cars / clients / rentals) moving
          // too — refresh the underlying datasets, then recompute the totals.
          await Promise.all([
            refreshCompanies(), refreshCars(), refreshClients(), refreshReport(),
          ]);
          updateStatsDashboard();
          break;
        case "companies":         await refreshCompanies(); break;
        case "cars":              await refreshCars();      break;
        case "clients":           await refreshClients();   break;
        case "report":            await refreshReport();    break;
        case "admin-reservations":await Reservations.refresh(); break;
        // "support" has nothing live to poll.
      }
    } catch (e){ /* transient fetch error on a poll → keep current view */ }
  }

  async function tick(){
    const u = AUTH.user();
    if (!u || u.role !== "admin") return;          // not an admin (e.g. logged out)
    if (document.visibilityState !== "visible") return;
    await refreshActivePanel();
  }

  function ensure(){ if (!timer) timer = setInterval(tick, INTERVAL_MS); }
  function stop(){ if (timer){ clearInterval(timer); timer = null; } }

  return { ensure, stop };
})();

function showApp(){
  $("#login-overlay").style.display = "none";
  document.body.style.overflow = "";
  renderHeaderProfile();
  renderReportCompanyHead();
  applyRoleUI();
}

/* Branded header at the top of the Report tab — only shown when a
   company user is signed in. Uses the cached company on the user object. */
function renderReportCompanyHead(){
  const u = AUTH.user();
  if (!u || u.role !== "company") return;
  const c = u.company || {};
  const logo  = $("#report-company-logo");
  const name  = $("#report-company-name");
  const meta  = $("#report-company-meta");
  if (!name || !meta) return;
  name.textContent = c.companyname || u.username || "—";
  if (logo){
    if (c.logo){ logo.src = c.logo; logo.hidden = false; }
    else { logo.removeAttribute("src"); logo.hidden = true; }
  }
  const phones = String(c.phonenumber || "").split(",").map(s => s.trim()).filter(Boolean);
  const bits = [];
  if (c.location)  bits.push(`<span>${escape(c.location)}</span>`);
  if (c.companyid) bits.push(`<code>${escape(c.companyid)}</code>`);
  if (phones.length){
    bits.push(`<span>${phones.map(p => `<a href="tel:${escape(p)}">${escape(p)}</a>`).join(" · ")}</span>`);
  }
  meta.innerHTML = bits.join(" · ");
}
function showLogin(){
  $("#login-overlay").style.display = "grid";
  $("#login-error").hidden = true;
  $("#form-login").reset();
  document.body.style.overflow = "hidden";
  $("#user-profile").hidden = true;
  document.body.classList.remove("role-admin", "role-company");
}

/* ----- role-based UI gate ----- */
/* ============== ADMIN SIDEBAR PANEL TOGGLE ============== */
const AdminSidebar = (() => {
  const PANELS = ["dashboard", "companies", "cars", "clients", "admin-reservations", "report", "support"];
  let _current = "dashboard";

  function show(panel){
    if (panel === "register-modal"){
      showModal("#register-modal");
      return;
    }
    _current = panel;
    PANELS.forEach(p => {
      if (p === "dashboard"){
        const sd = $("#stats-dashboard");
        const ia = $("#inactive-alerts");
        if (sd) sd.style.display = panel === "dashboard" ? "" : "none";
        if (ia) ia.style.display = panel === "dashboard" ? "" : "none";
      } else {
        const el = $(`#${p}`);
        if (!el) return;
        el.classList.toggle("admin-panel-active", p === panel);
      }
    });
    $$(".sidebar-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.panel === panel);
    });
  }

  function setup(){
    $$(".sidebar-btn").forEach(btn => {
      btn.addEventListener("click", () => show(btn.dataset.panel));
    });
    show("dashboard");
  }

  function current(){ return _current; }

  return { setup, show, current };
})();

function applyRoleUI(){
  const user = AUTH.user();
  document.body.classList.remove("role-admin", "role-company");
  if (!user) return;

  document.body.classList.add(`role-${user.role}`);

  if (user.role === "admin"){
    AdminSidebar.setup();
    const collapseBtn = $("#sidebar-collapse-btn");
    if (collapseBtn){
      collapseBtn.addEventListener("click", () => {
        const sidebar = $("#admin-sidebar");
        if (sidebar) sidebar.classList.toggle("collapsed");
        document.body.classList.toggle("sidebar-collapsed");
      });
    }
    $$(".dash-toggle-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const panel = $(`#${btn.dataset.panel}`);
        if (panel) panel.classList.toggle("collapsed");
      });
    });
  }

  if (user.role === "company"){
    const COMPANY_PANELS = ["report", "reservations", "company-info", "company-cars", "company-clients", "support"];
    let _compCurrent = "report";

    function showCompanyPanel(panel){
      _compCurrent = panel;
      COMPANY_PANELS.forEach(p => {
        const el = $(`#${p}`);
        if (el) el.classList.toggle("company-panel-active", p === panel);
      });
      $$("#company-sidebar .sidebar-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.cpanel === panel);
      });
    }

    $$("#company-sidebar .sidebar-btn").forEach(btn => {
      btn.addEventListener("click", () => showCompanyPanel(btn.dataset.cpanel));
    });

    const compCollapseBtn = $("#company-sidebar-collapse");
    if (compCollapseBtn){
      compCollapseBtn.addEventListener("click", () => {
        const sidebar = $("#company-sidebar");
        if (sidebar) sidebar.classList.toggle("collapsed");
        document.body.classList.toggle("sidebar-collapsed");
      });
    }

    showCompanyPanel("report");
  }
}

function setupAuth(){
  let _pendingCreds = null;

  $("#form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const username = fd.get("username")?.trim();
    const password = fd.get("password");
    const ok = await AUTH.signIn(username, password);
    if (ok){
      $("#login-error").hidden = true;
      const user = AUTH.user();
      if (user && user.must_reset_password){
        _pendingCreds = { username, oldPassword: password };
        showModal("#reset-pw-modal");
        return;
      }
      showApp();
      await loadAllData();
    } else {
      $("#login-error").hidden = false;
    }
  });

  const resetForm = $("#form-reset-pw");
  if (resetForm){
    resetForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(resetForm);
      const newPw = (fd.get("new_password") || "").toString();
      const confirm = (fd.get("confirm_password") || "").toString();
      const errEl = $("#reset-pw-error");
      if (newPw !== confirm){
        errEl.textContent = t("resetPw.mismatch");
        errEl.hidden = false;
        return;
      }
      if (newPw.length < 4){
        errEl.textContent = "Password must be at least 4 characters.";
        errEl.hidden = false;
        return;
      }
      try {
        const r = await fetch(API.url("/api/change-password"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: _pendingCreds?.username,
            old_password: _pendingCreds?.oldPassword,
            new_password: newPw,
          }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok){
          errEl.textContent = data.error || t("toast.error");
          errEl.hidden = false;
          return;
        }
        // Re-sign in with the new password so the session is fresh
        await AUTH.signIn(_pendingCreds?.username, newPw);
        _pendingCreds = null;
        hideModal("#reset-pw-modal");
        toast(t("resetPw.success"), "success");
        showApp();
        await loadAllData();
      } catch (err){
        errEl.textContent = err.message || t("toast.error");
        errEl.hidden = false;
      }
    });
  }

  $("#btn-logout").addEventListener("click", () => {
    AUTH.signOut();
    showLogin();
  });
}

/* ============== CSV UPLOAD ============== */
const SCHEMAS = {
  companies: {
    required: ["companyname", "location", "companyid", "phonenumber"],
    sample:   ["Acme Rentals", "Beirut, Lebanon", "CMP-100", "+961-1-987654"],
    coerce: (r) => r,
    endpoint: "/api/companies",
  },
  cars: {
    required: ["company_id", "vin", "type", "model", "color", "platenumber", "has_gps"],
    sample:   ["1", "ABCDE12345FGHIJK7", "SUV", "Toyota Camry", "White", "BEY-9999", "true"],
    coerce: (r) => ({
      company_id:  Number(r.company_id),
      vin:         r.vin,
      type:        r.type,
      model:       r.model,
      color:       r.color,
      platenumber: r.platenumber,
      has_gps:     /^(1|true|yes|y|on)$/i.test(String(r.has_gps).trim()),
    }),
    validateExtra: (row, idx) => {
      if (!Number.isInteger(Number(row.company_id))) {
        return t("upload.row.invalid").replace("{n}", idx).replace("{f}", "company_id");
      }
      return null;
    },
    endpoint: "/api/cars",
  },
  clients: {
    required: ["personid","name","fathername","mothername","phonenumber",
               "dateofbirth","licenseid","startdatelicense","enddatelicense"],
    sample:   ["PID-2001","Layla Saad","Saad","Nour","+961-71-555000",
               "1996-03-12","LIC-B2001","2020-01-10","2030-01-10"],
    coerce: (r) => r,
    endpoint: "/api/clients",
  }
};

// Minimal CSV parser: supports quoted values + escaped quotes ("") + commas in quotes
function parseCSV(text){
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (inQ){
      if (c === '"' && text[i+1] === '"'){ field += '"'; i++; }
      else if (c === '"'){ inQ = false; }
      else { field += c; }
    } else {
      if (c === '"'){ inQ = true; }
      else if (c === ','){ row.push(field); field = ""; }
      else if (c === '\r'){ /* skip */ }
      else if (c === '\n'){ row.push(field); rows.push(row); row = []; field = ""; }
      else { field += c; }
    }
  }
  if (field.length || row.length){ row.push(field); rows.push(row); }
  // strip trailing fully-empty rows
  while (rows.length && rows[rows.length-1].every(v => v === "")) rows.pop();
  return rows;
}

function buildCSV(headers, rows){
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(","), ...rows.map(r => r.map(esc).join(","))].join("\n");
}

function downloadFile(name, text){
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function updateUploadHint(){
  const type = $("#upload-type").value;
  const schema = SCHEMAS[type];
  $("#upload-required").textContent = schema.required.join(", ");

  const ref = $("#upload-ref");
  if (type === "cars" && state.companies.length){
    ref.hidden = false;
    $("#upload-ref-list").innerHTML = state.companies
      .map(c => `<li><code>${c.id}</code> — ${escape(c.companyname)} (${escape(c.location)})</li>`)
      .join("");
  } else {
    ref.hidden = true;
  }
}

function formatBytes(n){
  if (n < 1024) return n + " B";
  if (n < 1024*1024) return (n/1024).toFixed(1) + " KB";
  return (n/(1024*1024)).toFixed(1) + " MB";
}

function setupUpload(){
  const typeSel    = $("#upload-type");
  const fileInp    = $("#upload-file");
  const chipsWrap  = $("#upload-file-chips");
  const results    = $("#upload-results");
  const okBadge    = $("#upload-ok");
  const failBadge  = $("#upload-fail");
  const errList    = $("#upload-errors");

  // The picker keeps its own queue of File objects. The native input
  // can't append on subsequent picks, so we maintain this list ourselves.
  const queue = [];

  function renderChips(){
    if (!queue.length){
      chipsWrap.hidden = true;
      chipsWrap.innerHTML = "";
      return;
    }
    chipsWrap.hidden = false;
    chipsWrap.innerHTML = queue.map((f, i) => `
      <div class="file-chip" data-idx="${i}">
        <span class="file-chip-icon">📄</span>
        <span class="file-chip-name" title="${escape(f.name)}">${escape(f.name)}</span>
        <span class="file-chip-size">${formatBytes(f.size)}</span>
        <button type="button" class="file-chip-x" data-idx="${i}"
                data-i18n-title="upload.remove" title="${escape(t("upload.remove"))}"
                aria-label="Remove">×</button>
      </div>`).join("");

    chipsWrap.querySelectorAll(".file-chip-x").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        queue.splice(idx, 1);
        renderChips();
        clearResults();
      });
    });
  }

  function clearResults(){
    results.hidden       = true;
    okBadge.textContent  = "0";
    failBadge.textContent = "0";
    errList.innerHTML    = "";
  }

  function clearAll(){
    queue.length = 0;
    fileInp.value = "";
    renderChips();
    clearResults();
  }

  fileInp.addEventListener("change", () => {
    const incoming = Array.from(fileInp.files);
    incoming.forEach(f => {
      // dedupe by name+size so re-picking the same file doesn't double it
      if (!queue.some(x => x.name === f.name && x.size === f.size)) {
        queue.push(f);
      }
    });
    // Reset input so the same filename can be picked again later if removed
    fileInp.value = "";
    renderChips();
    clearResults();
  });

  $("#btn-upload-clear").addEventListener("click", () => {
    clearAll();
    toast(t("upload.cleared"), "success");
  });

  typeSel.addEventListener("change", updateUploadHint);
  document.addEventListener("lang:changed", () => {
    updateUploadHint();
    renderChips();          // re-translate the × tooltip when language changes
  });

  $("#btn-template").addEventListener("click", () => {
    const type = typeSel.value;
    const schema = SCHEMAS[type];
    const csv = buildCSV(schema.required, [schema.sample]);
    downloadFile(`${type}_template.csv`, csv);
  });

  $("#btn-upload").addEventListener("click", async () => {
    if (!queue.length){ toast(t("upload.no.file"), "error"); return; }
    const type = typeSel.value;
    const schema = SCHEMAS[type];

    const errors = [];
    let ok = 0;

    for (const file of queue){
      const tag = `[${file.name}] `;
      let text;
      try { text = await file.text(); }
      catch (e){ errors.push(tag + (e.message || "read error")); continue; }

      const rows = parseCSV(text);
      if (!rows.length){ errors.push(tag + t("upload.empty")); continue; }

      const headers  = rows[0].map(h => h.trim());
      const dataRows = rows.slice(1);

      // header check (per-file)
      const missingHdr = schema.required.filter(c => !headers.includes(c));
      if (missingHdr.length){
        errors.push(tag + `${t("upload.bad.headers")} ${schema.required.join(", ")}`);
        continue;
      }

      for (let i = 0; i < dataRows.length; i++){
        const rawRow = dataRows[i];
        if (rawRow.every(v => String(v).trim() === "")) continue;

        const obj = {};
        headers.forEach((h, idx) => { obj[h] = (rawRow[idx] ?? "").toString().trim(); });

        const missField = schema.required.find(c => obj[c] === "" || obj[c] == null);
        if (missField){
          errors.push(tag + t("upload.row.missing").replace("{n}", i+2).replace("{f}", missField));
          continue;
        }

        if (schema.validateExtra){
          const e = schema.validateExtra(obj, i+2);
          if (e){ errors.push(tag + e); continue; }
        }

        try{
          const body = schema.coerce(obj);
          const r = await fetch(API.url(schema.endpoint), {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify(body),
          });
          if (!r.ok){
            const msg = await r.json().then(j => j.error || r.statusText).catch(() => r.statusText);
            errors.push(tag + t("upload.row.failed").replace("{n}", i+2).replace("{err}", msg));
            continue;
          }
          ok++;
        } catch (err){
          errors.push(tag + t("upload.row.failed").replace("{n}", i+2).replace("{err}", err.message));
        }
      }
    }

    okBadge.textContent   = ok;
    failBadge.textContent = errors.length;
    errList.innerHTML     = errors.map(e => `<li>${escape(e)}</li>`).join("");
    results.hidden        = false;

    if (ok > 0){
      if (type === "companies") await refreshCompanies();
      if (type === "cars")      await refreshCars();
      if (type === "clients")   await refreshClients();
      await refreshReport();
    }
  });

  // initial state
  updateUploadHint();
  renderChips();
}

/* ============== ENTITY CONFIG (drives the edit modal) ============== */
const ENTITY = {
  companies: {
    titleKey: "companies.title",
    endpoint: "/api/companies",
    fields: [
      { name: "companyname", labelKey: "companies.f.name",  required: true },
      { name: "owner_name",  labelKey: "register.f.owner" },
      { name: "location",    labelKey: "companies.f.loc",   required: true },
      { name: "companyid",   labelKey: "companies.f.cid",   required: true },
      { name: "phonenumber", labelKey: "companies.f.phone" },
      { type: "maplocation", xName: "x", yName: "y", labelKey: "companies.f.maploc" },
      { type: "logo", name: "logo", labelKey: "companies.f.logo" },
    ],
    afterDelete: refreshCompanies,
    afterEdit:   refreshCompanies,
  },
  cars: {
    titleKey: "cars.title",
    endpoint: "/api/cars",
    fields: [
      { name: "company_id",  labelKey: "cars.f.company", required: true,
        type: "select", optionsFrom: () => state.companies, valueKey: "id",
        labelFn: (c) => `${c.companyname} — ${c.location}` },
      { name: "vin",         labelKey: "cars.f.vin",   required: true, readOnly: true,
        help: "VIN cannot be changed (rentals reference it)" },
      { name: "type",        labelKey: "cars.f.type",  required: true },
      { name: "model",       labelKey: "cars.f.model", required: true },
      { name: "color",       labelKey: "cars.f.color", required: true },
      { name: "platenumber", labelKey: "cars.f.plate", required: true },
      { name: "has_gps",     labelKey: "cars.f.gps",   type: "checkbox" },
    ],
    afterDelete: refreshCars,
    afterEdit:   refreshCars,
  },
  clients: {
    titleKey: "clients.title",
    endpoint: "/api/clients",
    fields: [
      { name: "personid",         labelKey: "clients.f.pid" },
      { name: "firstname",        labelKey: "clients.f.firstname" },
      { name: "lastname",         labelKey: "clients.f.lastname" },
      { name: "fathername",       labelKey: "clients.f.father" },
      { name: "mothername",       labelKey: "clients.f.mother" },
      { name: "nationality",      labelKey: "addClient.nationality" },
      { name: "phonenumber",      labelKey: "clients.f.phone" },
      { name: "dateofbirth",      labelKey: "clients.f.dob",      type: "date" },
      { name: "licenseid",        labelKey: "clients.f.lic",      required: true },
      { name: "startdatelicense", labelKey: "clients.f.licstart", required: true, type: "date" },
      { name: "enddatelicense",   labelKey: "clients.f.licend",   required: true, type: "date" },
    ],
    afterDelete: refreshClients,
    afterEdit:   refreshClients,
  },
};

/* ============== EDIT MODAL ============== */
const Editor = (() => {
  let cfg = null;
  let record = null;

  function open(entityKey, rec){
    cfg    = ENTITY[entityKey];
    record = rec;
    if (!cfg) return;

    $("#edit-title").textContent = `${t("edit.title")} — ${t(cfg.titleKey)}`;
    const wrap = $("#edit-fields");
    wrap.innerHTML = cfg.fields.map(f => fieldHtml(f, rec[f.name], rec)).join("");

    // populate selects with live options
    cfg.fields.filter(f => f.type === "select").forEach(f => {
      const sel = wrap.querySelector(`[name="${f.name}"]`);
      f.optionsFrom().forEach(opt => {
        const o = document.createElement("option");
        o.value = opt[f.valueKey];
        o.textContent = f.labelFn(opt);
        if (String(rec[f.name]) === String(opt[f.valueKey])) o.selected = true;
        sel.appendChild(o);
      });
    });

    // wire up the "Pick on map" button when a maplocation field is present
    const pickBtn = wrap.querySelector("#edit-btn-pick-map");
    if (pickBtn){
      pickBtn.addEventListener("click", () => {
        MapPicker.openPick({
          xSel:      "#edit-company-x",
          ySel:      "#edit-company-y",
          statusSel: "#edit-map-loc-status",
        });
      });
    }

    // wire up the logo picker when a logo field is present
    if (wrap.querySelector("#edit-logo-file")){
      LogoPicker.bind({
        fileSel:     "#edit-logo-file",
        previewSel:  "#edit-logo-preview",
        fallbackSel: "#edit-logo-fallback",
        clearSel:    "#edit-logo-clear",
        dataSel:     "#edit-logo-data",
      });
    }

    showModal("#edit-modal");
  }

  function fieldHtml(f, value, rec){
    const lbl   = `<label>${escape(t(f.labelKey))}${f.required ? " *" : ""}</label>`;
    const help  = f.help ? `<small style="color:var(--muted)">${escape(f.help)}</small>` : "";
    const ro    = f.readOnly ? "readonly" : "";
    const req   = f.required ? "required" : "";
    if (f.type === "checkbox"){
      const checked = value ? "checked" : "";
      return `<div class="field field-check">
        <label><input type="checkbox" name="${f.name}" ${checked}>
          <span>${escape(t(f.labelKey))}</span></label></div>`;
    }
    if (f.type === "select"){
      return `<div class="field">${lbl}<select name="${f.name}" ${req}></select>${help}</div>`;
    }
    if (f.type === "logo"){
      const logoVal = rec?.[f.name] || "";
      const initial = escape(logoVal);
      const hasLogo = Boolean(logoVal);
      return `<div class="field logo-field">
        <label>${escape(t(f.labelKey))}</label>
        <input type="hidden" name="${f.name}" id="edit-logo-data" value="${initial}">
        <div class="logo-picker">
          <img id="edit-logo-preview" class="logo-preview"
               ${hasLogo ? `src="${initial}"` : ""}
               alt="" ${hasLogo ? "" : "hidden"}>
          <span id="edit-logo-fallback"
                class="logo-preview logo-preview-empty"
                ${hasLogo ? "hidden" : ""}>+</span>
          <input type="file" id="edit-logo-file" accept="image/*" hidden>
          <label for="edit-logo-file" class="file-picker-btn logo-picker-btn">
            <span class="file-picker-icon">🖼️</span>
            <span>${escape(t("companies.logo.choose"))}</span>
          </label>
          <button type="button" id="edit-logo-clear" class="btn btn-ghost-dark logo-clear-btn"
                  ${hasLogo ? "" : "hidden"}>${escape(t("action.clear"))}</button>
        </div>
      </div>`;
    }
    if (f.type === "maplocation"){
      const xVal = rec?.[f.xName];
      const yVal = rec?.[f.yName];
      const has  = xVal != null && yVal != null && xVal !== "" && yVal !== "";
      const xAttr = has ? escape(String(xVal)) : "";
      const yAttr = has ? escape(String(yVal)) : "";
      const statusInner = has
        ? `<span class="dot"></span>` +
          `<span class="map-loc-label">${escape(t("companies.maploc.set"))}</span>` +
          `<code>${Number(yVal).toFixed(6)}, ${Number(xVal).toFixed(6)}</code>`
        : escape(t("companies.maploc.empty"));
      const statusClass = has ? "map-loc-status filled" : "map-loc-status empty";
      return `<div class="field map-status-field">
        <label>${escape(t(f.labelKey))}</label>
        <input type="hidden" name="${f.xName}" id="edit-company-x" value="${xAttr}">
        <input type="hidden" name="${f.yName}" id="edit-company-y" value="${yAttr}">
        <div id="edit-map-loc-status" class="${statusClass}">${statusInner}</div>
        <button type="button" id="edit-btn-pick-map" class="btn btn-ghost-dark">
          ${escape(t("companies.pick"))}
        </button>
      </div>`;
    }
    const tp   = f.type || "text";
    const step = f.step ? `step="${f.step}"` : "";
    const v    = value == null ? "" : escape(String(value));
    return `<div class="field">${lbl}
      <input type="${tp}" name="${f.name}" value="${v}" ${step} ${req} ${ro}>
      ${help}</div>`;
  }

  $("#edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!cfg || !record) return;
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd);
    cfg.fields.forEach(f => {
      if (f.type === "checkbox") body[f.name] = fd.get(f.name) === "on";
      if (f.type === "number")   body[f.name] = body[f.name] === "" ? null : Number(body[f.name]);
      if (f.type === "maplocation"){
        body[f.xName] = body[f.xName] === "" || body[f.xName] == null ? null : Number(body[f.xName]);
        body[f.yName] = body[f.yName] === "" || body[f.yName] == null ? null : Number(body[f.yName]);
      }
      if (f.type === "logo"){
        body[f.name] = body[f.name] === "" || body[f.name] == null ? null : body[f.name];
      }
      if (f.name === "company_id") body[f.name] = Number(body[f.name]);
    });
    try{
      const r = await fetch(API.url(`${cfg.endpoint}/${record.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok){
        const err = await r.json().catch(() => ({error: r.statusText}));
        toast(err.error || t("toast.error"), "error");
        return;
      }
      toast(t("toast.saved"), "success");
      hideModal("#edit-modal");
      await cfg.afterEdit?.();
      await refreshReport();
    } catch (err){
      toast(err.message || t("toast.error"), "error");
    }
  });

  $("#edit-close" ).addEventListener("click", () => hideModal("#edit-modal"));
  $("#edit-cancel").addEventListener("click", () => hideModal("#edit-modal"));

  return { open };
})();

/* ============== DELETE (soft) ============== */
async function softDelete(entityKey, id){
  const cfg = ENTITY[entityKey];
  if (!confirm(t("confirm.delete"))) return;
  try{
    const r = await fetch(API.url(`${cfg.endpoint}/${id}`), { method: "DELETE" });
    if (!r.ok && r.status !== 204){
      const err = await r.json().catch(() => ({error: r.statusText}));
      toast(err.error || t("toast.error"), "error");
      return;
    }
    toast(t("toast.deleted"), "success");
    await cfg.afterDelete?.();
    await refreshReport();
  } catch (err){
    toast(err.message || t("toast.error"), "error");
  }
}

/* ============== ROW DETAIL + PDF (per-row + full report) ============== */
const Detail = (() => {
  let currentRow = null;

  function rowDl(r){
    const k = (key) => escape(t(key));
    const v = (x)   => x == null || x === "" ? "—" : escape(String(x));
    const gps = r.car_has_gps
      ? `<span class="badge yes">${t("yes")}</span>`
      : `<span class="badge no">${t("no")}</span>`;
    // Optional client photo strip — sits above the client info, only
    // when one was uploaded for this client.
    const photoStrip = r.client_photo
      ? `<div class="client-photo-strip">
           <img src="${escape(r.client_photo)}" alt="" class="client-photo">
         </div>`
      : "";
    return photoStrip + `
      <dl class="detail-grid">
        <dt>${k("report.client")}</dt>      <dd><strong>${v(r.client_name)}</strong></dd>
        <dt>${k("report.father")}</dt>      <dd>${v(r.client_father)}</dd>
        <dt>${k("clients.f.mother")}</dt>   <dd>${v(r.client_mother)}</dd>
        <dt>${k("clients.f.pid")}</dt>      <dd>${v(r.client_personid)}</dd>
        <dt>${k("addClient.nationality")}</dt><dd>${v(r.client_nationality)}</dd>
        <dt>${k("clients.f.dob")}</dt>      <dd>${v(r.client_dob)}</dd>
        <dt>${k("report.phone")}</dt>       <dd>${v(r.client_phone)}</dd>
        <dt>${k("report.license")}</dt>     <dd><code>${v(r.client_licenseid)}</code></dd>
        <div class="full"></div>
        <dt>${k("report.company")}</dt>     <dd>${v(r.company_name)} <code>(${v(r.company_code)})</code></dd>
        <dt>${k("report.cphone")}</dt>      <dd>${v(r.company_phone)}</dd>
        <dt>${k("report.location")}</dt>    <dd>${v(r.company_location)}</dd>
        <dt>${k("companies.f.coords")}</dt> <dd>${
          r.company_x != null && r.company_y != null
            ? `<code>${Number(r.company_y).toFixed(5)}, ${Number(r.company_x).toFixed(5)}</code>`
            : "—"
        }</dd>
        <div class="full"></div>
        <dt>${k("report.car")}</dt>         <dd>${v(r.car_model)} (${v(r.car_type)})</dd>
        <dt>${k("cars.f.vin")}</dt>         <dd><code>${v(r.car_vin)}</code></dd>
        <dt>${k("report.plate")}</dt>       <dd>${v(r.car_plate)}</dd>
        <dt>${k("cars.f.color")}</dt>       <dd>${v(r.car_color)}</dd>
        <dt>${k("report.gps")}</dt>         <dd>${gps}</dd>
        <div class="full"></div>
        <dt>${k("report.start")}</dt>       <dd>${v(r.start_date)}</dd>
        <dt>${k("report.end")}</dt>         <dd>${v(r.end_date)}</dd>
      </dl>`;
  }

  function companyHeadHtml(){
    const u = AUTH.user();
    if (!u || u.role !== "company") return "";
    const c = u.company || {};
    const phones = String(c.phonenumber || "").split(",").map(s => s.trim()).filter(Boolean);
    const meta = [
      c.location && `<span>${escape(c.location)}</span>`,
      c.companyid && `<code>${escape(c.companyid)}</code>`,
      phones.length && `<span>${phones.map(p =>
        `<a href="tel:${escape(p)}">${escape(p)}</a>`).join(" · ")}</span>`,
    ].filter(Boolean).join(" · ");
    const logoHtml = c.logo
      ? `<img class="report-company-logo" src="${escape(c.logo)}" alt="">`
      : "";
    return `
      <div class="detail-company-grid">
        ${logoHtml}
        <div>
          <h3 class="report-company-name">${escape(c.companyname || u.username || "—")}</h3>
          <div class="report-company-meta">${meta}</div>
        </div>
      </div>`;
  }

  async function loadMedia(rentalId){
    const photosGrid = $("#detail-photos-grid");
    const videosGrid = $("#detail-videos-grid");
    if (photosGrid) photosGrid.innerHTML = "";
    if (videosGrid) videosGrid.innerHTML = "";
    if (!rentalId) return;
    try {
      const r = await fetch(API.url(`/api/rentals/${rentalId}/media`), {
        headers: { ...authHeaders() },
      });
      if (!r.ok) return;
      const list = await r.json();
      list.forEach(m => {
        const grid = m.kind === "photo" ? photosGrid : videosGrid;
        if (!grid) return;
        const cell = document.createElement("div");
        cell.className = `media-cell media-cell-${m.kind}`;
        const url = API.url(m.url);
        cell.innerHTML = m.kind === "photo"
          ? `<img src="${escape(url)}" alt="${escape(m.original_name || "")}">
             <button type="button" class="media-remove" data-id="${m.id}" title="${escape(t("action.delete"))}">&times;</button>`
          : `<video src="${escape(url)}" controls></video>
             <button type="button" class="media-remove" data-id="${m.id}" title="${escape(t("action.delete"))}">&times;</button>`;
        grid.appendChild(cell);
      });
    } catch (e){ /* soft-fail */ }
  }

  async function uploadMedia(file, kind){
    if (!currentRow || !currentRow.rental_id) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    try {
      const r = await fetch(API.url(`/api/rentals/${currentRow.rental_id}/media`), {
        method: "POST",
        headers: { ...authHeaders() },
        body: fd,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok){
        toast(data.error || t("toast.error"), "error");
        return;
      }
      toast(t("detail.uploaded"), "success");
      await loadMedia(currentRow.rental_id);
    } catch (err){
      toast(err.message || t("toast.error"), "error");
    }
  }

  async function deleteMedia(mediaId){
    if (!currentRow || !currentRow.rental_id) return;
    if (!confirm(t("confirm.delete"))) return;
    try {
      const r = await fetch(API.url(`/api/rentals/${currentRow.rental_id}/media/${mediaId}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      if (!r.ok && r.status !== 204){
        const err = await r.json().catch(() => ({error: r.statusText}));
        toast(err.error || t("toast.error"), "error");
        return;
      }
      toast(t("toast.deleted"), "success");
      await loadMedia(currentRow.rental_id);
    } catch (err){
      toast(err.message || t("toast.error"), "error");
    }
  }

  function open(row){
    currentRow = row;
    const head = $("#detail-company");
    if (head) head.innerHTML = companyHeadHtml();
    $("#detail-body").innerHTML = rowDl(row);
    loadMedia(row.rental_id);
    loadCoRenters(row.rental_id);
    showModal("#detail-modal");
  }

  $("#detail-close" ).addEventListener("click", () => hideModal("#detail-modal"));
  $("#detail-cancel").addEventListener("click", () => hideModal("#detail-modal"));

  $("#detail-pdf").addEventListener("click", () => {
    if (!currentRow) return;
    const id = currentRow.rental_id;
    if (!id){ toast("Missing rental_id in row.", "error"); return; }
    downloadFromUrl(API.url(`/api/report.pdf?rental_id=${id}&lang=${currentLang()}`));
  });

  // Photo upload
  $("#detail-upload-photo")?.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) await uploadMedia(f, "photo");
    e.target.value = "";
  });

  // Video upload
  $("#detail-upload-video")?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (f) await uploadMedia(f, "video");
    e.target.value = "";
  });

  // Delegated remove buttons on photo/video cells
  ["#detail-photos-grid", "#detail-videos-grid"].forEach(sel => {
    const grid = $(sel);
    if (!grid) return;
    grid.addEventListener("click", (e) => {
      const btn = e.target.closest(".media-remove");
      if (btn) deleteMedia(Number(btn.dataset.id));
    });
  });

  // Co-renters
  function showClientDetail(cr){
    const body = $("#client-detail-body");
    if (!body) return;
    const k = (key) => escape(t(key));
    const v = (x) => x == null || x === "" ? "—" : escape(String(x));
    const name = [cr.firstname, cr.lastname].filter(Boolean).join(" ") || cr.name || "—";
    const photoHtml = cr.photo
      ? `<div class="client-photo-strip"><img src="${escape(cr.photo)}" alt="" class="client-photo"></div>`
      : "";
    body.innerHTML = `${photoHtml}
      <dl class="detail-grid">
        <dt>${k("clients.f.name")}</dt>        <dd><strong>${escape(name)}</strong></dd>
        <dt>${k("clients.f.pid")}</dt>         <dd>${v(cr.personid)}</dd>
        <dt>${k("clients.f.father")}</dt>      <dd>${v(cr.fathername)}</dd>
        <dt>${k("clients.f.mother")}</dt>      <dd>${v(cr.mothername)}</dd>
        <dt>${k("addClient.nationality")}</dt> <dd>${v(cr.nationality)}</dd>
        <dt>${k("clients.f.dob")}</dt>         <dd>${v(cr.dateofbirth)}</dd>
        <dt>${k("clients.f.phone")}</dt>       <dd>${cr.phonenumber ? `<a href="tel:${escape(cr.phonenumber)}">${escape(cr.phonenumber)}</a>` : "—"}</dd>
        <div class="full"></div>
        <dt>${k("clients.f.lic")}</dt>         <dd><code>${v(cr.licenseid)}</code></dd>
        <dt>${k("addClient.idType")}</dt>      <dd>${v(cr.id_type)}</dd>
        <dt>${k("clients.f.licstart")}</dt>    <dd>${v(cr.startdatelicense)}</dd>
        <dt>${k("clients.f.licend")}</dt>      <dd>${v(cr.enddatelicense)}</dd>
      </dl>`;
    showModal("#client-detail-modal");
  }
  $("#client-detail-close")?.addEventListener("click", () => hideModal("#client-detail-modal"));
  $("#client-detail-cancel")?.addEventListener("click", () => hideModal("#client-detail-modal"));

  async function loadCoRenters(rentalId){
    const list = $("#detail-co-renters-list");
    if (!list || !rentalId) return;
    try {
      const r = await fetch(API.url(`/api/rentals/${rentalId}/co-renters`), { headers: authHeaders() });
      if (!r.ok){ list.innerHTML = ""; return; }
      const data = await r.json();
      if (!data.length){
        list.innerHTML = `<p class="co-renters-empty">${escape(t("detail.noCoRenters"))}</p>`;
        return;
      }
      list.innerHTML = data.map((cr, idx) => {
        const name = [cr.firstname, cr.lastname].filter(Boolean).join(" ") || cr.name || "—";
        const phone = cr.phonenumber
          ? `<a href="tel:${escape(cr.phonenumber)}">${escape(cr.phonenumber)}</a>`
          : "—";
        return `<div class="co-renter-row">
          <div class="co-renter-info">
            <span class="co-renter-name co-renter-clickable" data-cr-idx="${idx}">${escape(name)}</span>
            <span class="co-renter-meta">📞 ${phone} · ${escape(cr.licenseid || "")}</span>
          </div>
          <button type="button" class="co-renter-remove" data-co-id="${cr.id}" title="${escape(t("action.delete"))}">&times;</button>
        </div>`;
      }).join("");
      list.querySelectorAll(".co-renter-clickable").forEach(el => {
        el.addEventListener("click", () => {
          const cr = data[Number(el.dataset.crIdx)];
          if (cr) showClientDetail(cr);
        });
      });
      list.querySelectorAll(".co-renter-remove").forEach(btn => {
        btn.addEventListener("click", async () => {
          if (!confirm(t("confirm.delete"))) return;
          try {
            await fetch(API.url(`/api/rentals/${rentalId}/co-renters/${btn.dataset.coId}`), {
              method: "DELETE", headers: authHeaders(),
            });
            toast(t("toast.deleted"), "success");
            await loadCoRenters(rentalId);
          } catch (e){ toast(e.message || t("toast.error"), "error"); }
        });
      });
    } catch (e){ list.innerHTML = ""; }
  }

  function openCoRenterPicker(){
    if (!currentRow || !currentRow.rental_id) return;
    const rentalId = currentRow.rental_id;
    showModal("#co-renter-modal");
    const listEl = $("#co-renter-list");
    const searchEl = $("#co-renter-search");
    if (searchEl) searchEl.value = "";

    async function loadClients(){
      let clients = [];
      try {
        const r = await fetch(API.url("/api/clients"), { headers: authHeaders() });
        if (r.ok) clients = await r.json();
      } catch (e){}
      renderPicker(clients);
    }

    function renderPicker(clients){
      const q = (searchEl?.value || "").trim().toLowerCase();
      const filtered = q
        ? clients.filter(c => {
            const txt = `${c.firstname||""} ${c.lastname||""} ${c.name||""} ${c.phonenumber||""} ${c.licenseid||""}`.toLowerCase();
            return txt.includes(q);
          })
        : clients;
      if (!filtered.length){
        listEl.innerHTML = `<p class="dash-empty">${escape(t("dash.search.none"))}</p>`;
        return;
      }
      listEl.innerHTML = filtered.map(c => {
        const name = [c.firstname, c.lastname].filter(Boolean).join(" ") || c.name || "—";
        return `<div class="co-renter-pick-item" data-client-id="${c.id}">
          <div class="co-renter-pick-info">
            <span class="co-renter-pick-name">${escape(name)}</span>
            <span class="co-renter-pick-meta">${escape(c.licenseid || "")} · ${escape(c.phonenumber || "")}</span>
          </div>
          <button type="button" class="co-renter-pick-btn">${escape(t("action.add"))}</button>
        </div>`;
      }).join("");

      listEl.querySelectorAll(".co-renter-pick-item").forEach(item => {
        item.querySelector(".co-renter-pick-btn").addEventListener("click", async () => {
          const clientId = item.dataset.clientId;
          try {
            const r = await fetch(API.url(`/api/rentals/${rentalId}/co-renters`), {
              method: "POST",
              headers: { "Content-Type": "application/json", ...authHeaders() },
              body: JSON.stringify({ client_id: Number(clientId) }),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok){
              toast(data.error || t("toast.error"), "error");
              return;
            }
            toast(t("toast.added"), "success");
            item.remove();
            await loadCoRenters(rentalId);
          } catch (e){ toast(e.message || t("toast.error"), "error"); }
        });
      });
    }

    loadClients().then(() => {
      if (searchEl && !searchEl._coWired){
        searchEl._coWired = true;
        let _clients = [];
        fetch(API.url("/api/clients"), { headers: authHeaders() })
          .then(r => r.json()).then(d => { _clients = d; });
        searchEl.addEventListener("input", () => renderPicker(_clients));
      }
    });
  }

  $("#detail-add-client")?.addEventListener("click", openCoRenterPicker);
  $("#co-renter-close")?.addEventListener("click", () => hideModal("#co-renter-modal"));
  $("#co-renter-cancel")?.addEventListener("click", () => hideModal("#co-renter-modal"));

  return { open };
})();

/* =====================================================
   PDF download — server-side rendering.
   Backend uses reportlab + arabic-reshaper + python-bidi
   so Arabic text shapes and bidis correctly.
===================================================== */
function downloadFromUrl(url){
  // Use a hidden anchor instead of window.open() so the browser
  // honours the Content-Disposition filename and doesn't get blocked
  // as a popup in some browsers.
  const a = document.createElement("a");
  a.href = url;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
}

function currentLang(){
  return (typeof LangStore !== "undefined" && LangStore.get) ? LangStore.get() : "en";
}

function setupReportPdf(){
  $("#btn-export-pdf").addEventListener("click", () => {
    const rows = state.report || [];
    if (!rows.length){ toast(t("table.empty"), "error"); return; }
    downloadFromUrl(API.url(`/api/report.pdf?lang=${currentLang()}`));
  });
}

/* ============== MAP PICKER (Lebanon) ============== */
const MapPicker = (() => {
  const CENTER = [33.8547, 35.8623];
  const BOUNDS = [[33.05, 35.10], [34.70, 36.62]];

  let map = null;
  let marker = null;
  let picked = null;          // {lat, lng}
  let mode   = "pick";        // "pick" | "view"
  const DEFAULT_TARGET = { xSel: "#company-x", ySel: "#company-y", statusSel: "#map-loc-status" };
  let target = { ...DEFAULT_TARGET };

  function ensureMap(){
    if (map) return;
    if (typeof L === "undefined"){
      console.error("Leaflet failed to load");
      toast("Map library failed to load — check your internet.", "error");
      return;
    }
    map = L.map("leaflet-map", {
      maxBounds: BOUNDS,
      maxBoundsViscosity: 0.7,
      zoomControl: true,
    }).setView(CENTER, 8);

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, minZoom: 7,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    map.on("click", (e) => {
      if (mode !== "pick") return;
      placeMarker(e.latlng.lat, e.latlng.lng);
      picked = { lat: e.latlng.lat, lng: e.latlng.lng };
      const txt = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
      $("#map-coords").textContent = txt;
      $("#map-confirm").disabled = false;
      $("#map-confirm").classList.add("ready");
      $(".map-host-wrap")?.classList.add("has-pin");
      toast(`📍 ${txt}`, "success");
    });
  }

  function placeMarker(lat, lng, label){
    if (!map) return;
    if (marker) map.removeLayer(marker);
    marker = L.marker([lat, lng]).addTo(map);
    if (label) marker.bindPopup(label).openPopup();
  }

  // Wait two animation frames so the modal is in the layout AND its
  // children have their final sizes — only then is Leaflet safe to init.
  function nextPaint(){
    return new Promise(r =>
      requestAnimationFrame(() =>
        requestAnimationFrame(r)));
  }

  async function show(){
    $("#map-modal").hidden = false;
    document.body.classList.add("modal-open");
    await nextPaint();
    ensureMap();
    if (map) map.invalidateSize(true);
  }

  function hide(){
    $("#map-modal").hidden = true;
    document.body.classList.remove("modal-open");
  }

  async function openPick(opts = {}){
    mode   = "pick";
    picked = null;
    target = {
      xSel:      opts.xSel      || DEFAULT_TARGET.xSel,
      ySel:      opts.ySel      || DEFAULT_TARGET.ySel,
      statusSel: opts.statusSel || DEFAULT_TARGET.statusSel,
    };
    await show();
    if (!map) return;

    // Reset UI state
    $("#map-coords").textContent = "—";
    if (marker) { map.removeLayer(marker); marker = null; }
    $("#map-confirm").style.display = "";
    $("#map-confirm").disabled = true;
    $(".map-host-wrap")?.classList.remove("has-pin");

    // Pre-centre on existing coords, if any
    const x = parseFloat($(target.xSel)?.value);
    const y = parseFloat($(target.ySel)?.value);
    if (!Number.isNaN(x) && !Number.isNaN(y)){
      placeMarker(y, x);
      picked = { lat: y, lng: x };
      $("#map-coords").textContent = `${y.toFixed(6)}, ${x.toFixed(6)}`;
      $("#map-confirm").disabled = false;
      $(".map-host-wrap")?.classList.add("has-pin");
      map.setView([y, x], 12);
    } else {
      map.setView(CENTER, 8);
    }

    setTimeout(() => map.invalidateSize(true), 200);
  }

  async function openView({ x, y, label }){
    mode = "view";
    await show();
    if (!map) return;
    placeMarker(y, x, label);
    $("#map-coords").textContent = `${Number(y).toFixed(6)}, ${Number(x).toFixed(6)}`;
    map.setView([y, x], 13);
    $("#map-confirm").style.display = "none";
    setTimeout(() => map.invalidateSize(true), 200);
  }

  function setup(){
    $("#btn-pick-map").addEventListener("click", openPick);
    $("#map-close" ).addEventListener("click", hide);
    $("#map-cancel").addEventListener("click", hide);
    $("#map-confirm").addEventListener("click", () => {
      if (!picked){ toast(t("map.no.pick"), "error"); return; }
      const xEl = $(target.xSel);
      const yEl = $(target.ySel);
      if (xEl) xEl.value = picked.lng.toFixed(6);  // x = longitude
      if (yEl) yEl.value = picked.lat.toFixed(6);  // y = latitude
      setMapStatusOn(target.statusSel, picked.lat, picked.lng);
      hide();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("#map-modal").hidden) hide();
    });
  }

  return { setup, openPick, openView };
})();

/* ============== RESERVATIONS ============== */
const Reservations = (() => {
  let _data = [];

  async function refresh(){
    const u = AUTH.user();
    if (!u) return;
    try {
      const r = await fetch(API.url("/api/reservations"), { headers: authHeaders() });
      if (!r.ok) return;
      _data = await r.json();
    } catch (e){ _data = []; }
    render();
  }

  // Newest-first: most recently booked reservation on top. Falls back to
  // start_date when created_at is missing on older rows.
  function _byNewest(a, b){
    const ka = a.created_at || a.start_date || "";
    const kb = b.created_at || b.start_date || "";
    return kb < ka ? -1 : (kb > ka ? 1 : 0);
  }

  function _carLabel(rv){
    const m = rv.car_model || "";
    const p = rv.car_plate || "";
    return p ? `${m} — ${p}` : m;
  }

  // Format an ISO/SQL timestamp as a short, locale-aware date+time.
  function _fmtBooked(ts){
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d)) return String(ts).slice(0, 16).replace("T", " ");
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  function _populateAdminFilters(){
    populateFilterSelect($("#filter-arv-company"), _data.map(rv => rv.companyname));
    populateFilterSelect($("#filter-arv-client"),  _data.map(rv => rv.client_name));
    populateFilterSelect($("#filter-arv-car"),     _data.map(_carLabel));
    populateFilterSelect($("#filter-arv-plate"),   _data.map(rv => rv.car_plate));
  }

  function _getAdminFiltered(){
    const company = $("#filter-arv-company")?.value || "";
    const client  = $("#filter-arv-client")?.value  || "";
    const car     = $("#filter-arv-car")?.value     || "";
    const plate   = $("#filter-arv-plate")?.value   || "";
    const status  = $("#filter-arv-status")?.value  || "";
    const from    = ($("#arv-from")?.value || "").trim();
    const to      = ($("#arv-to")?.value   || "").trim();

    let rows = _data.slice();
    if (company) rows = rows.filter(rv => (rv.companyname || "") === company);
    if (client)  rows = rows.filter(rv => (rv.client_name || "") === client);
    if (car)     rows = rows.filter(rv => _carLabel(rv) === car);
    if (plate)   rows = rows.filter(rv => (rv.car_plate || "") === plate);
    if (status)  rows = rows.filter(rv => (rv.status || "") === status);
    // Date filter = "reservations active in this range" (overlap), same
    // semantics as the Report tab.
    if (from) rows = rows.filter(rv => rv.end_date   && rv.end_date   >= from);
    if (to)   rows = rows.filter(rv => rv.start_date && rv.start_date <= to);

    rows.sort(_byNewest);
    return rows;
  }

  function renderAdmin(){
    const tbl = $("#tbl-admin-reservations");
    if (!tbl) return;
    _populateAdminFilters();
    const rows = _getAdminFiltered();
    if (!rows.length){
      const pt = $("#pager-top-admin-reservations"); if (pt) pt.hidden = true;
      const pb = $("#pager-admin-reservations"); if (pb) pb.hidden = true;
      return emptyRow(tbl, 10);
    }
    const dash = `<span class="badge no">—</span>`;
    const today = _today();
    const info = Pager.slice("admin-reservations", rows);
    tbl.tBodies[0].innerHTML = info.rows.map((rv, i) => {
      const statusCls = rv.status || "pending";
      const statusLabel = t(`reservations.${statusCls}`) || rv.status;
      // Highlight reservations booked today so the newest stand out.
      const isToday = (rv.created_at || "").slice(0, 10) === today;
      return `<tr${isToday ? ' class="rv-row-today"' : ""}>
        <td>${(info.page - 1) * info.size + i + 1}</td>
        <td>${escape(rv.companyname || "")}</td>
        <td>${escape(rv.client_name || "")}</td>
        <td>${rv.client_phone ? `<a href="tel:${escape(rv.client_phone)}">${escape(rv.client_phone)}</a>` : dash}</td>
        <td>${escape(rv.car_model || "")}</td>
        <td>${escape(rv.car_plate || "")}</td>
        <td>${escape(rv.start_date || "")}</td>
        <td>${escape(rv.end_date || "")}</td>
        <td>${rv.created_at ? escape(_fmtBooked(rv.created_at)) : dash}</td>
        <td><span class="reservation-status-badge ${statusCls}">${escape(statusLabel)}</span></td>
      </tr>`;
    }).join("");
    Pager.render("admin-reservations", "#pager-top-admin-reservations",
                 "#pager-admin-reservations", info, renderAdmin);
  }

  function _today(){ return new Date().toISOString().slice(0, 10); }

  function renderTodayBanner(){
    const banner = $("#rv-today-banner");
    const list   = $("#rv-today-list");
    const count  = $("#rv-today-count");
    if (!banner || !list) return;
    const today = _today();
    const todayItems = _data.filter(rv =>
      rv.status === "pending" && rv.start_date === today
    );
    if (!todayItems.length){
      banner.hidden = true; list.hidden = true; return;
    }
    banner.hidden = false; list.hidden = false;
    if (count) count.textContent = todayItems.length;
    const dash = `<span style="color:var(--muted)">—</span>`;
    list.innerHTML = todayItems.map(rv => {
      const phone = rv.client_phone
        ? `<a href="tel:${escape(rv.client_phone)}">${escape(rv.client_phone)}</a>`
        : dash;
      return `<div class="rv-today-item">
        <div>
          <strong>${escape(rv.client_name || "")}</strong> — ${escape(rv.car_model || "")} (${escape(rv.car_plate || "")})
          <span class="rv-today-meta"> · 📞 ${phone}</span>
        </div>
        <div class="row-actions">
          <button type="button" class="rv-action-btn activate" data-rv-id="${rv.id}" data-action="active">${escape(t("reservations.activate"))}</button>
          <button type="button" class="rv-action-btn cancel"   data-rv-id="${rv.id}" data-action="inactive">${escape(t("reservations.cancel"))}</button>
        </div>
      </div>`;
    }).join("");
    _wireActions(list);
  }

  function _getFiltered(){
    const dateVal   = ($("#rv-filter-date")?.value || "").trim();
    const statusVal = ($("#rv-filter-status")?.value || "").trim();
    let rows = _data;
    if (dateVal){
      rows = rows.filter(rv => rv.start_date <= dateVal && rv.end_date >= dateVal);
    }
    if (statusVal){
      rows = rows.filter(rv => rv.status === statusVal);
    }
    return rows;
  }

  function _wireActions(container){
    container.querySelectorAll("[data-rv-id]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.rvId);
        const action = btn.dataset.action;
        if (action === "delete"){
          if (!confirm(t("confirm.delete"))) return;
          try {
            await fetch(API.url(`/api/reservations/${id}`), {
              method: "DELETE", headers: authHeaders(),
            });
            toast(t("toast.deleted"), "success");
            await refresh();
          } catch (e){ toast(e.message || t("toast.error"), "error"); }
        } else {
          try {
            const r = await fetch(API.url(`/api/reservations/${id}`), {
              method: "PUT",
              headers: { "Content-Type": "application/json", ...authHeaders() },
              body: JSON.stringify({ status: action }),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok){
              toast(data.error || t("toast.error"), "error");
              return;
            }
            toast(action === "active" ? t("reservations.activated") : t("reservations.cancelled"), "success");
            await refresh();
            await refreshReport();
          } catch (e){ toast(e.message || t("toast.error"), "error"); }
        }
      });
    });
  }

  function render(){
    const u = AUTH.user();
    if (u && u.role === "admin"){ renderAdmin(); return; }
    renderTodayBanner();
    const tbl = $("#tbl-reservations");
    if (!tbl) return;
    const filtered = _getFiltered();
    if (!filtered.length) return emptyRow(tbl, 9);
    const dash = `<span class="badge no">—</span>`;
    tbl.tBodies[0].innerHTML = filtered.map((rv, i) => {
      const statusCls = rv.status || "pending";
      const statusLabel = t(`reservations.${statusCls}`) || rv.status;
      let actions = "";
      if (rv.status === "pending"){
        actions = `
          <button type="button" class="rv-action-btn activate" data-rv-id="${rv.id}" data-action="active">${escape(t("reservations.activate"))}</button>
          <button type="button" class="rv-action-btn cancel"   data-rv-id="${rv.id}" data-action="inactive">${escape(t("reservations.cancel"))}</button>`;
      }
      actions += `<button type="button" class="rv-action-btn delete" data-rv-id="${rv.id}" data-action="delete">${escape(t("action.delete"))}</button>`;
      return `<tr>
        <td>${i + 1}</td>
        <td>${escape(rv.client_name || "")}</td>
        <td>${rv.client_phone ? `<a href="tel:${escape(rv.client_phone)}">${escape(rv.client_phone)}</a>` : dash}</td>
        <td>${escape(rv.car_model || "")}</td>
        <td>${escape(rv.car_plate || "")}</td>
        <td>${escape(rv.start_date || "")}</td>
        <td>${escape(rv.end_date || "")}</td>
        <td><span class="reservation-status-badge ${statusCls}">${escape(statusLabel)}</span></td>
        <td><div class="row-actions">${actions}</div></td>
      </tr>`;
    }).join("");
    _wireActions(tbl);
  }

  async function refreshPickers(){
    const u = AUTH.user();
    if (!u || u.role !== "company" || !u.company_id) return;
    let cars = [], clients = [];
    try { cars = await fetch(API.url(`/api/cars?company_id=${u.company_id}`)).then(r => r.json()); } catch (e){}
    try { clients = await fetch(API.url("/api/clients"), { headers: authHeaders() }).then(r => r.json()); } catch (e){}

    const carSel = $("#reservation-car-select");
    if (carSel){
      const ph = carSel.querySelector('option[disabled][hidden]')?.outerHTML || "";
      carSel.innerHTML = ph + cars.map(c =>
        `<option value="${escape(c.vin)}">${escape(`${c.model} — ${c.platenumber} (${c.vin})`)}</option>`
      ).join("");
      carSel.value = "";
      if (carSel._ss) carSel._ss.sync();
    }
    const clientSel = $("#reservation-client-select");
    if (clientSel){
      const ph = clientSel.querySelector('option[disabled][hidden]')?.outerHTML || "";
      clientSel.innerHTML = ph + clients.map(c =>
        `<option value="${c.id}">${escape(`${c.name || c.personid} — ${c.licenseid || ""}`)}</option>`
      ).join("");
      clientSel.value = "";
      if (clientSel._ss) clientSel._ss.sync();
    }
  }

  function setup(){
    const form = $("#form-create-reservation");
    if (!form) return;

    // Filter controls
    $("#rv-filter-today")?.addEventListener("click", () => {
      const dateEl = $("#rv-filter-date");
      if (dateEl) dateEl.value = _today();
      render();
    });
    $("#rv-filter-all")?.addEventListener("click", () => {
      const dateEl = $("#rv-filter-date");
      const statusEl = $("#rv-filter-status");
      if (dateEl) dateEl.value = "";
      if (statusEl) statusEl.value = "";
      render();
    });
    $("#rv-filter-date")?.addEventListener("change", render);
    $("#rv-filter-status")?.addEventListener("change", render);

    // Admin reservations filters — per-column dropdowns + status + date range.
    const arvIds = ["filter-arv-company", "filter-arv-client", "filter-arv-car",
                    "filter-arv-plate", "filter-arv-status", "arv-from", "arv-to"];
    arvIds.forEach(id => {
      $(`#${id}`)?.addEventListener("change", () => {
        Pager.reset("admin-reservations");
        renderAdmin();
      });
    });
    $("#arv-reset")?.addEventListener("click", () => {
      clearFilterSelect($("#filter-arv-company"));
      clearFilterSelect($("#filter-arv-client"));
      clearFilterSelect($("#filter-arv-car"));
      clearFilterSelect($("#filter-arv-plate"));
      const st = $("#filter-arv-status"); if (st){ st.value = ""; if (st._ss) st._ss.sync(); }
      const f = $("#arv-from"); if (f) f.value = "";
      const t2 = $("#arv-to");  if (t2) t2.value = "";
      Pager.reset("admin-reservations");
      renderAdmin();
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const u = AUTH.user();
      if (!u || u.role !== "company") return;
      const fd = new FormData(form);
      const body = {
        car_vin:    (fd.get("car_vin")    || "").toString().trim(),
        client_id:  Number(fd.get("client_id")) || null,
        start_date: (fd.get("start_date") || "").toString().trim(),
        end_date:   (fd.get("end_date")   || "").toString().trim(),
        notes:      (fd.get("notes")      || "").toString().trim(),
      };
      if (!body.car_vin || !body.client_id || !body.start_date || !body.end_date){
        toast(t("toast.fillAll"), "error");
        return;
      }
      if (body.end_date < body.start_date){
        toast(t("rental.create.err.range"), "error");
        return;
      }
      try {
        const r = await fetch(API.url("/api/reservations"), {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(body),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok){
          toast(data.error || t("toast.error"), "error");
          return;
        }
        form.reset();
        ["#reservation-car-select", "#reservation-client-select"].forEach(sel => {
          const el = $(sel);
          if (el){ el.value = ""; if (el._ss) el._ss.sync(); }
        });
        toast(t("reservations.saved"), "success");
        await refresh();
      } catch (err){ toast(err.message || t("toast.error"), "error"); }
    });
  }

  return { refresh, refreshPickers, setup };
})();

/* ============== CONTACT SUPPORT ============== */
function setupSupportForm(){
  const form = $("#form-support");
  if (!form) return;

  const fileInput = $("#support-screenshot");
  const fileName  = $("#support-file-name");
  if (fileInput){
    fileInput.addEventListener("change", () => {
      const f = fileInput.files[0];
      if (f && fileName){
        fileName.textContent = f.name;
        fileName.hidden = false;
      } else if (fileName){
        fileName.hidden = true;
      }
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = (form.querySelector('[name="message"]')?.value || "").trim();
    if (!message){
      toast(t("support.error"), "error");
      return;
    }
    const fd = new FormData(form);
    const screenshot = fileInput?.files[0];
    if (screenshot) fd.append("screenshot", screenshot);

    try {
      const r = await fetch(API.url("/api/support"), {
        method: "POST",
        body: fd,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok){
        toast(data.error || t("toast.error"), "error");
        return;
      }
      form.reset();
      if (fileName) fileName.hidden = true;
      toast(t("support.sent"), "success");
    } catch (err){
      toast(err.message || t("toast.error"), "error");
    }
  });
}

/* ============== INIT ============== */
async function loadAllData(){
  try{
    const u = AUTH.user();
    if (u && u.role === "company"){
      await Promise.all([
        refreshReport(),
        loadCompanyInfo(),
        refreshRentalPickers(),
        Reservations.refresh(),
        Reservations.refreshPickers(),
      ]);
    } else {
      await Promise.all([
        refreshCompanies(), refreshCars(), refreshClients(),
        refreshBranches(), refreshReport(), Reservations.refresh(),
      ]);
      updateStatsDashboard();
      loadInactiveAlerts();
      loadDashboardActivity();
      updateUploadHint();
    }
  } catch (err){
    console.error(err);
    toast("Backend not reachable — start the Flask server.", "error");
  }
}

async function init(){
  setupAuth();
  setupCompanyForm();
  setupCarForm();
  setupClientForm();
  setupRentFlow();
  setupUpload();
  setupRegisterForm();
  setupCompanyInfo();
  setupBranchModal();
  setupAddCarForm();
  setupAddCarCsv();
  setupAddClientForm();
  setupCreateRentalForm();
  Reservations.setup();
  setupSupportForm();
  setupReportSearch();
  MapPicker.setup();
  setupReportPdf();

  // Enhance every <select> on the page with a searchable dropdown.
  if (typeof enhanceSelects === "function") enhanceSelects();
  // The VIN dropdown starts disabled until a company is picked.
  rebuildCarsVinDropdown();

  if (AUTH.isAuthed()){
    showApp();
    await loadAllData();
  } else {
    showLogin();
  }
}

document.addEventListener("DOMContentLoaded", init);

// Re-render dynamic content when language changes
document.addEventListener("lang:changed", () => {
  renderCompanies();
  renderCars();
  renderClients();
  renderReport();
});
