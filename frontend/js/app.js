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

    listCars:      (companyId) => fetch(url("/api/cars" + (companyId ? `?company_id=${companyId}` : "")), { headers: authHeaders() }).then(json),
    listCarsPaged: (qs) => fetch(url("/api/cars?" + qs), { headers: authHeaders() }).then(json),
    listCarsFiltered: (qs) => fetch(url("/api/cars?" + qs), { headers: authHeaders() }).then(json),
    carsSummary:   (qs) => fetch(url("/api/cars/summary" + (qs ? "?" + qs : "")), { headers: authHeaders() }).then(json),
    listGpsCars:   () => fetch(url("/api/cars?gps=1"), { headers: authHeaders() }).then(json),
    addCar:        (b) => fetch(url("/api/cars"),      { method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify(b)}).then(json),

    listClients:   () => fetch(url("/api/clients"), { headers: authHeaders() }).then(json),
    addClient:     (b) => fetch(url("/api/clients"),   { method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify(b)}).then(json),

    listPlates:    () => fetch(url("/api/plates"), { headers: authHeaders() }).then(json),
    addPlate:      (b) => fetch(url("/api/plates"), { method:"POST", headers:{ "Content-Type":"application/json", ...authHeaders() }, body: JSON.stringify(b)}).then(json),
    delPlate:      (id) => fetch(url(`/api/plates/${id}`), { method:"DELETE", headers: authHeaders() }),

    listBranches:  () => fetch(url("/api/branches")).then(json),
    setHeadOffice: (id) => fetch(url(`/api/branches/${id}/head-office`), { method:"PUT", headers: authHeaders() }).then(json),

    addRental:     (b) => fetch(url("/api/rentals"),   { method:"POST", headers:{ "Content-Type":"application/json"}, body: JSON.stringify(b)}).then(json),
    report:        () => fetch(url("/api/rentals/report"), { headers: authHeaders() }).then(json),

    listSpecialRentals: () => fetch(url("/api/special-rentals"), { headers: authHeaders() }).then(json),
    listAdminSpecialRentals: () => fetch(url("/api/admin/special-rentals"), { headers: authHeaders() }).then(json),
    listAdminActiveRentals: () => fetch(url("/api/admin/active-rentals"), { headers: authHeaders() }).then(json),
    addSpecialRental:   (b) => fetch(url("/api/special-rentals"), { method:"POST", headers:{ "Content-Type":"application/json", ...authHeaders() }, body: JSON.stringify(b)}).then(json),
    updSpecialRental:   (id, b) => fetch(url(`/api/special-rentals/${id}`), { method:"PUT", headers:{ "Content-Type":"application/json", ...authHeaders() }, body: JSON.stringify(b)}).then(json),
    delSpecialRental:   (id) => fetch(url(`/api/special-rentals/${id}`), { method:"DELETE", headers: authHeaders() }),
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
                <option value="50" ${info.size === 50 ? "selected" : ""}>50</option>
                <option value="100" ${info.size === 100 ? "selected" : ""}>100</option>
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

  // Server-side pager: the caller already knows the true `total` row count and
  // supplies only the current page's rows. We fake an `info` object so the same
  // render() (size selector + nav) drives it, and `onChange` re-fetches instead
  // of re-slicing an in-memory array.
  function renderServer(key, topSel, bottomSel, total, onChange){
    const s = _get(key);
    const totalPages = Math.ceil(total / s.size) || 1;
    if (s.page > totalPages) s.page = totalPages;
    const info = { rows: [], page: s.page, total: totalPages, allCount: total, size: s.size };
    render(key, topSel, bottomSel, info, onChange);
  }

  return { reset, slice, render, renderServer, state: _get };
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

// A car sits at a named branch, or — when unassigned / its company has no
// branches — at "Main" (the head office). The two render distinctly so the
// admin can tell a real branch from the default at a glance.
function branchCell(name){
  const s = String(name || "").trim();
  if (!s) return `<span class="branch-pill branch-pill-main">${escape(t("cars.branch.main"))}</span>`;
  return `<span class="branch-pill">${escape(s)}</span>`;
}

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

/* A clickable value in the admin report / reservation tables. Clicking it opens
   the matching entity's read-only detail modal (company / car / client).
   `key` is the id (company/client) or VIN (car) the modal loads from; `text` is
   what the cell shows. Empty key or text falls back to a plain dash. */
function drillCell(kind, key, text, strong){
  const disp = text == null ? "" : String(text).trim();
  const id   = key  == null ? "" : String(key).trim();
  if (!disp || !id) return `<span class="cell-dash">—</span>`;
  const cls = "cell-drill" + (strong ? " is-strong" : "");
  return `<button type="button" class="${cls}" data-drill="${escape(kind)}"`
       + ` data-drillkey="${escape(id)}" title="${escape(t("detail.viewInfo"))}">${escape(disp)}</button>`;
}

// Parse an activity "kind:key" ref (e.g. "car:<vin>", "client:42", "branch:7")
// into { kind, key } for a drill-down, or null if it isn't a known drillable ref.
function _parseRef(ref){
  if (!ref || typeof ref !== "string") return null;
  const i = ref.indexOf(":");
  if (i < 0) return null;
  const kind = ref.slice(0, i), key = ref.slice(i + 1);
  if (!key) return null;
  return ["car", "client", "branch", "company"].includes(kind) ? { kind, key } : null;
}

// A "View details" button that opens the referenced car / client / branch.
function refDrillButton(ref){
  const p = _parseRef(ref);
  if (!p) return "";
  const label = t("audit.view." + p.kind) || t("detail.viewInfo");
  const ico = p.kind === "car" ? "🚗" : p.kind === "client" ? "👤"
            : p.kind === "branch" ? "📍" : "🏢";
  return `<button type="button" class="btn btn-primary audit-drill-btn"`
       + ` data-drill="${escape(p.kind)}" data-drillkey="${escape(p.key)}">`
       + `${ico} ${escape(label)}</button>`;
}

// Wire every .audit-drill-btn inside `root` to open its entity's detail modal.
function wireRefDrills(root){
  if (!root) return;
  root.querySelectorAll(".audit-drill-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      EntityDetail.open(btn.dataset.drill, btn.dataset.drillkey);
    });
  });
}

function refreshFilterDropdowns(){
  const companyNames = state.companies.map(c => c.companyname);
  const clientNames  = state.clients.map(c => c.name);
  const clientLics   = state.clients.map(c => c.licenseid);
  const reportCompanies = (state.report || []).map(r => r.company_name);
  const reportClients   = (state.report || []).map(r => r.client_name);
  const reportLics      = (state.report || []).map(r => r.client_licenseid);

  populateFilterSelect($("#filter-cars-company"),   companyNames);
  // Companies-table dropdown filters (name / owner / location union).
  populateFilterSelect($("#filter-companies-name"),  companyNames);
  populateFilterSelect($("#filter-companies-owner"), state.companies.map(c => c.owner_name));
  populateFilterSelect($("#filter-companies-loc"), [
    ...state.companies.map(c => c.location),
    ...(state.branches || []).map(b => b.location),
  ]);
  // Cars type/model dropdowns need every car's distinct values → fetched async.
  populateCarTypeModelFilters();
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
  // Cars & Rentals → "rented by individuals" toolbar. Same rows, but its own
  // pair of dropdowns: the hub's filters are deliberately kept apart from the
  // Report tab's so neither clears the other.
  populateFilterSelect($("#filter-ind-client"), coRows.map(r => r.client_name));
  populateFilterSelect($("#filter-ind-car"),    coRows.map(carLabel));
}

// Applied companies-table filters. Only updated when the admin clicks "Search",
// so opening/changing a dropdown changes nothing until they commit — and there
// is no free-text box, every filter is a dropdown pick.
const companyFilters = { name: "", owner: "", location: "" };

function companyFiltersActive(){
  return !!(companyFilters.name || companyFilters.owner || companyFilters.location);
}

function getCompaniesRows(){
  const f = companyFilters;
  if (!companyFiltersActive()) return state.companies;
  return (state.companies || []).filter(c => {
    if (f.name  && c.companyname !== f.name)   return false;
    if (f.owner && c.owner_name  !== f.owner)  return false;
    if (f.location){
      // A location match keeps the company if EITHER its own location or any of
      // its branches sits at that place, so a branch location still surfaces it.
      const own = (c.location || "") === f.location;
      const inBranch = (state.branches || []).some(b =>
        b.company_id === c.id && (b.location || "") === f.location);
      if (!own && !inBranch) return false;
    }
    return true;
  });
}

// Fill the companies-table filter dropdowns from the loaded data. Locations are
// the union of company + branch locations so a branch-only place is selectable.
function populateCompanyFilters(){
  populateFilterSelect($("#filter-companies-name"),  (state.companies || []).map(c => c.companyname));
  populateFilterSelect($("#filter-companies-owner"), (state.companies || []).map(c => c.owner_name));
  populateFilterSelect($("#filter-companies-loc"), [
    ...(state.companies || []).map(c => c.location),
    ...(state.branches  || []).map(b => b.location),
  ]);
}

// Companies whose branch sub-rows are currently expanded. Collapsed by default
// so the table stays one line per company — essential at 100+ companies.
const expandedCompanies = new Set();

function renderCompanies(){
  const tbl = $("#tbl-companies");
  const rows = getCompaniesRows();
  const searching = companyFiltersActive();
  const countEl = $("#companies-count");
  if (countEl){
    const total = (state.companies || []).length;
    countEl.textContent = searching ? `${rows.length} / ${total}` : String(total);
  }
  if (!rows.length){
    const pt = $("#pager-top-companies"); if (pt) pt.hidden = true;
    const pb = $("#pager-companies"); if (pb) pb.hidden = true;
    return emptyRow(tbl, 7);
  }

  const info = Pager.slice("companies", rows);
  const html = [];
  // The whole Location cell is clickable: it shows a map pin + the place name,
  // and opens the map on click. If exact coordinates are stored we drop the pin
  // there directly; otherwise we geocode the place name on the fly — so every
  // named location opens a map, whether or not it was pinned when registered.
  const locCell = (name, x, y) => {
    if (!name) return `<span class="badge no">—</span>`;
    const hasCoords = x != null && y != null;
    const coordAttrs = hasCoords ? ` data-x="${x}" data-y="${y}"` : "";
    return `<button type="button" class="company-loc-link" data-name="${escape(name)}"${coordAttrs} title="${escape(t("companies.viewOnMap"))}" aria-label="${escape(t("companies.viewOnMap"))}">
        <svg class="company-loc-link-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>
        <span class="company-loc-link-text">${escape(name)}</span>
      </button>`;
  };

  info.rows.forEach((c, i) => {
    const phone = formatPhonesCell(c.phonenumber);
    const logo = c.logo
      ? `<img src="${escape(c.logo)}" alt="${escape(c.companyname)}" class="company-logo-thumb">`
      : `<span class="company-logo-thumb company-logo-thumb-empty" style="background:${_avatarColor(c.companyname)}">${escape(_initials(c.companyname))}</span>`;

    // Branches belonging to this company → grouped, readable sub-rows. Head
    // office first so it reads as the company's primary location.
    const branches = (state.branches || [])
      .filter(b => b.company_id === c.id)
      .sort((a, b) => (b.is_head_office ? 1 : 0) - (a.is_head_office ? 1 : 0));
    const hasBranches = branches.length > 0;
    const expanded = hasBranches && expandedCompanies.has(c.id);
    // Expand/collapse toggle + branch-count badge (one combined control).
    const branchToggle = hasBranches
      ? `<button type="button" class="branch-toggle${expanded ? " is-open" : ""}" data-company="${c.id}" aria-expanded="${expanded}" title="${escape(t("companies.toggleBranches"))}" aria-label="${escape(t("companies.toggleBranches"))}">
           <svg class="branch-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
           <span class="branch-count-badge">${branches.length} ${escape(t(branches.length === 1 ? "companies.branchOne" : "companies.branchMany"))}</span>
         </button>`
      : "";

    // Main company row. When NO branch is flagged head office, the company's
    // MAIN location IS the head office — badge it so the admin can see it.
    const owner = c.owner_name ? escape(c.owner_name) : `<span class="badge no">—</span>`;
    const mainIsHead = !branches.some(b => b.is_head_office);
    const mainHeadBadge = mainIsHead
      ? `<span class="branch-head-badge" title="${escape(t("companyInfo.branch.headOffice"))}">★ ${escape(t("fleet.headOffice"))}</span>`
      : "";
    html.push(`
      <tr class="company-main-row${hasBranches ? " company-has-branches" : ""}${expanded ? " is-expanded" : ""}">
        <td data-label="#">${(info.page - 1) * info.size + i + 1}</td>
        <td data-label="${escape(t("companies.f.logo"))}">${logo}</td>
        <td data-label="${escape(t("companies.f.name"))}"><span class="company-name-cell"><span class="company-name-text">${escape(c.companyname)}</span>${branchToggle}</span></td>
        <td data-label="${escape(t("register.f.owner"))}">${owner}</td>
        <td class="company-loc-td" data-label="${escape(t("companies.f.loc"))}">${mainHeadBadge
          ? `<span class="company-loc-stack">${locCell(c.location, c.x, c.y)}${mainHeadBadge}</span>`
          : locCell(c.location, c.x, c.y)}</td>
        <td data-label="${escape(t("companies.f.cid"))}">${escape(c.companyid)}</td>
        <td data-label="${escape(t("companies.f.phone"))}">${phone}</td>
      </tr>`);

    branches.forEach((b, bi) => {
      const last = bi === branches.length - 1;
      html.push(`
        <tr class="company-branch-row${last ? " company-branch-last" : ""}" data-branch-of="${c.id}"${expanded ? "" : " hidden"}>
          <td></td>
          <td></td>
          <td class="branch-cell" data-label="${escape(t("companies.f.name"))}">
            <span class="branch-tag${b.is_head_office ? " branch-tag-head" : ""}">
              <svg class="branch-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4v10a3 3 0 0 0 3 3h6"/><circle cx="6" cy="4" r="1.6"/><circle cx="18" cy="17" r="1.6"/></svg>
              <span class="branch-name">${escape(t("companies.branch"))} ${bi + 1}</span>
              ${b.is_head_office ? `<span class="branch-head-badge" title="${escape(t("companyInfo.branch.headOffice"))}">★ ${escape(t("fleet.headOffice"))}</span>` : ""}
            </span>
          </td>
          <td></td>
          <td class="company-loc-td" data-label="${escape(t("companies.f.loc"))}">${locCell(b.location, b.x, b.y)}</td>
          <td></td>
          <td data-label="${escape(t("companies.f.phone"))}">${formatPhonesCell(b.phonenumber)}</td>
        </tr>`);
    });
  });
  tbl.tBodies[0].innerHTML = html.join("");

  // Expand / collapse a company's branch rows in place (no full re-render).
  $$(".branch-toggle", tbl).forEach(btn => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.company);
      const open = !expandedCompanies.has(id);
      if (open) expandedCompanies.add(id); else expandedCompanies.delete(id);
      btn.classList.toggle("is-open", open);
      btn.setAttribute("aria-expanded", String(open));
      btn.closest("tr")?.classList.toggle("is-expanded", open);
      $$(`.company-branch-row[data-branch-of="${id}"]`, tbl)
        .forEach(r => { r.hidden = !open; });
    });
  });

  // Clicking a Location cell opens the map. Exact coordinates open instantly;
  // a name without coordinates is geocoded first (openLocation handles both).
  $$(".company-loc-link", tbl).forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      MapPicker.openLocation({
        x: a.dataset.x != null ? Number(a.dataset.x) : null,
        y: a.dataset.y != null ? Number(a.dataset.y) : null,
        label: a.dataset.name,
      });
    });
  });
  bindRowActions(tbl);
  Pager.render("companies", "#pager-top-companies", "#pager-companies", info, renderCompanies);
}

/* ============== CARS ============== */
// Total row count of the last server page fetch, so re-renders (e.g. language
// switch) can redraw the pager without another round-trip.
let _carsTotal = 0;
// True unfiltered fleet size for the dashboard stat card — kept separate from
// _carsTotal (which reflects the current filter) and from state.cars (one page).
let _carsCount = 0;

// Cheap COUNT-only fetch (page_size=1) for the dashboard "Cars" stat, so it
// shows the real fleet total no matter which page/filter the table is on.
async function refreshCarsCount(){
  try {
    const d = await API.listCarsPaged("page=1&page_size=1");
    _carsCount = d.total || 0;
  } catch (e){ /* leave the previous value */ }
}

function companyIdByName(name){
  if (!name) return "";
  const c = (state.companies || []).find(co => co.companyname === name);
  return c ? c.id : "";
}

/* ============== ADMIN FLEET (grouped Company → Branch → Cars tree) ========
   At 100+ cars per company a flat table repeats the company name on every row
   and is unreadable. Instead the admin fleet is an expandable tree: companies
   collapse to one line, expand to their branches, and each branch expands to
   its own small cars table. Counts come from a single /api/cars/summary
   aggregate (no car rows shipped); the actual cars of ONE branch are fetched
   lazily only when that branch is opened — so the view scales indefinitely. */
const fleet = {
  summary: {},              // { "<cid>": {total, unassigned, branches:{"<bid>":n}} }
  openCompanies: new Set(), // company ids currently expanded
  openBranches: new Set(),  // keys "cid:bid" currently expanded (bid = id or "none")
  cars: new Map(),          // key "cid:bid" -> lazily-loaded car array
};

const FLEET_CHEVRON = `<svg class="fleet-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;
// Three-dot ("more") icon used by admin table row actions in place of the old 👁.
const ROW_MORE_ICO = `<svg class="row-more-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;
const FLEET_BRANCH_ICO = `<svg class="fleet-br-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4v10a3 3 0 0 0 3 3h6"/><circle cx="6" cy="4" r="1.6"/><circle cx="18" cy="17" r="1.6"/></svg>`;
const FLEET_HEAD_ICO = `<svg class="fleet-br-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6"/></svg>`;

// Applied cars-toolbar filters. Like the companies table these are all
// dropdown picks (no free-text) committed only on "Search".
const carFilters = { company: "", type: "", model: "", gps: "" };

// Current toolbar filters as query params, shared by the summary fetch and each
// branch's lazy car fetch so counts always match the drill-down.
function fleetParams(){
  const p = new URLSearchParams();
  if (carFilters.company){
    const co = (state.companies || []).find(c => c.companyname === carFilters.company);
    if (co) p.set("company_id", co.id);
  }
  if (carFilters.type)  p.set("type",  carFilters.type);
  if (carFilters.model) p.set("model", carFilters.model);
  if (carFilters.gps)   p.set("gps",   carFilters.gps);
  return p;
}

// The distinct type/model lists need every car, so fetch the flat list once.
// (Company is populated from loaded state in refreshFilterDropdowns.) Admin-only
// endpoint — silently skipped for company users, who never see this toolbar.
// refreshFilterDropdowns runs on every data refresh, so we fetch the (large)
// car list at most once and reuse it; `force` re-fetches after a car changes.
let _carFilterOptions = null;
async function populateCarTypeModelFilters(force){
  const typeSel = $("#filter-cars-type"); const modelSel = $("#filter-cars-model");
  if (!typeSel || !modelSel) return;
  if (force) _carFilterOptions = null;
  if (!_carFilterOptions){
    try { _carFilterOptions = await API.listCars() || []; }
    catch (e){ return; /* dropdowns just stay at "All" if the fetch fails */ }
  }
  populateFilterSelect(typeSel,  _carFilterOptions.map(c => c.type));
  populateFilterSelect(modelSel, _carFilterOptions.map(c => c.model));
}

// (Re)load the whole tree: fetch the aggregate, drop stale branch caches, and
// re-render. Any filter change routes here. Company users never reach this.
async function loadFleet(){
  const host = $("#cars-tree");
  if (!host) return;
  const p = fleetParams();
  const anyFilter = [...p.keys()].length > 0;
  try {
    const data = await API.carsSummary(p.toString());
    fleet.summary = data.companies || {};
  } catch (e){ fleet.summary = {}; }
  // A filter change invalidates any cached branch cars and open branch rows.
  fleet.cars.clear();
  fleet.openBranches.clear();
  // Filtering: auto-expand every matching company so hits are immediately
  // visible. No filter: keep whatever the admin had open (or all collapsed).
  if (anyFilter){
    fleet.openCompanies = new Set(Object.keys(fleet.summary).map(Number));
  }
  // Keep the dashboard "Cars" stat in sync only when nothing is filtered.
  if (!anyFilter){
    _carsCount = Object.values(fleet.summary).reduce((s, e) => s + (e.total || 0), 0);
  }
  renderFleet();
}

// Back-compat aliases: existing callers (panel nav, afterEdit/Delete, language
// switch) still call these names.
async function refreshCars(){ await loadFleet(); }
function loadCarsPage(){ return loadFleet(); }
function renderCars(){ renderFleet(); }

function renderFleet(){
  const host = $("#cars-tree");
  if (!host) return;
  const sum = fleet.summary || {};
  const companies = Object.keys(sum)
    .map(id => (state.companies || []).find(c => String(c.id) === id))
    .filter(Boolean)
    .sort((a, b) => a.companyname.localeCompare(b.companyname, undefined, { sensitivity: "base" }));

  const countEl = $("#cars-count");
  if (countEl){
    const totalCars = Object.values(sum).reduce((s, e) => s + (e.total || 0), 0);
    const nCo = companies.length;
    countEl.textContent = totalCars
      ? `${nCo} ${t(nCo === 1 ? "fleet.company" : "fleet.companies")} · ${totalCars} ${t(totalCars === 1 ? "fleet.carOne" : "fleet.carMany")}`
      : "";
  }

  // The tab badge counts the same cars this tree is about to draw, so it moves
  // with the fleet filters rather than lagging a filter behind.
  if (typeof AdminCarsHub !== "undefined") AdminCarsHub.syncCounts();

  if (!companies.length){
    host.innerHTML = `<div class="fleet-empty">${escape(t("report.none"))}</div>`;
    return;
  }
  host.innerHTML = companies.map(c => fleetCompanyBlock(c, sum[String(c.id)] || {})).join("");
  $$(".fleet-co-head", host).forEach(btn =>
    btn.addEventListener("click", () => fleetToggleCompany(Number(btn.dataset.coToggle))));
  fleetBindBranches(host);
}

function fleetCarPill(n){
  return `<span class="fleet-pill fleet-pill-cars">${n} ${escape(t(n === 1 ? "fleet.carOne" : "fleet.carMany"))}</span>`;
}

function fleetCompanyBlock(c, entry){
  const open = fleet.openCompanies.has(c.id);
  const total = entry.total || 0;
  const branchCount = (state.branches || []).filter(b => b.company_id === c.id).length;
  const logo = c.logo
    ? `<img src="${escape(c.logo)}" alt="" class="fleet-co-logo">`
    : `<span class="fleet-co-logo fleet-co-logo-empty" style="background:${_avatarColor(c.companyname)}">${escape(_initials(c.companyname))}</span>`;
  const brPill = `<span class="fleet-pill fleet-pill-br">${branchCount} ${escape(t(branchCount === 1 ? "companies.branchOne" : "companies.branchMany"))}</span>`;
  return `
    <div class="fleet-co${open ? " is-open" : ""}" data-cid="${c.id}">
      <button type="button" class="fleet-co-head" aria-expanded="${open}" data-co-toggle="${c.id}">
        ${FLEET_CHEVRON}
        ${logo}
        <span class="fleet-co-name">${escape(c.companyname)}</span>
        <span class="fleet-co-meta">${fleetCarPill(total)}${brPill}</span>
      </button>
      <div class="fleet-co-body"${open ? "" : " hidden"}>${open ? fleetBranchGroups(c, entry) : ""}</div>
    </div>`;
}

function fleetBranchGroups(c, entry){
  const groups = [];
  (state.branches || [])
    .filter(b => b.company_id === c.id)
    .sort((a, b) => (a.branchname || "").localeCompare(b.branchname || "", undefined, { sensitivity: "base" }))
    .forEach(b => {
      const n = (entry.branches || {})[String(b.id)] || 0;
      if (!n) return;   // hide branches with no matching cars
      groups.push(fleetBranchGroup(c.id, String(b.id), b.branchname || t("companies.branch"), b.location, n, false));
    });
  if (entry.unassigned){
    groups.push(fleetBranchGroup(c.id, "none", t("fleet.headOffice"), "", entry.unassigned, true));
  }
  return groups.join("") || `<div class="fleet-br-empty">${escape(t("report.none"))}</div>`;
}

function fleetBranchGroup(cid, bid, name, location, n, isHead){
  const key = cid + ":" + bid;
  const open = fleet.openBranches.has(key);
  const cars = fleet.cars.get(key);
  const loc = location && location !== name ? `<span class="fleet-br-loc">${escape(location)}</span>` : "";
  const inner = open
    ? (cars ? fleetCarsTable(cars) : `<div class="fleet-loading">${escape(t("fleet.loading"))}</div>`)
    : "";
  return `
    <div class="fleet-br${open ? " is-open" : ""}${isHead ? " is-head-office" : ""}" data-key="${key}">
      <button type="button" class="fleet-br-head" aria-expanded="${open}" data-cid="${cid}" data-bid="${bid}">
        ${FLEET_CHEVRON}
        ${isHead ? FLEET_HEAD_ICO : FLEET_BRANCH_ICO}
        <span class="fleet-br-name">${escape(name)}</span>${loc}
        ${fleetCarPill(n)}
      </button>
      <div class="fleet-br-body"${open ? "" : " hidden"}>${inner}</div>
    </div>`;
}

function fleetCarsTable(cars){
  if (!cars.length) return `<div class="fleet-br-empty">${escape(t("report.none"))}</div>`;
  const rows = cars.map((c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><code class="vin-code">${escape(c.vin)}</code></td>
      <td>${escape(c.type)}</td>
      <td><span class="car-model-cell">${escape(c.model)}</span></td>
      <td>${formatColorCell(c.color)}</td>
      <td>${c.platenumber ? `<span class="plate-pill">${escape(c.platenumber)}</span>` : `<span class="badge no">—</span>`}</td>
      <td>${c.has_gps ? `<span class="badge yes">${t("yes")}</span>` : `<span class="badge no">${t("no")}</span>`}</td>
    </tr>`).join("");
  return `
    <div class="fleet-cars-wrap">
      <table class="data-table fleet-cars-table">
        <thead><tr>
          <th>#</th>
          <th>${escape(t("cars.f.vin"))}</th>
          <th>${escape(t("cars.f.type"))}</th>
          <th>${escape(t("cars.f.model"))}</th>
          <th>${escape(t("cars.f.color"))}</th>
          <th>${escape(t("cars.f.plate"))}</th>
          <th>${escape(t("cars.f.gps"))}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function fleetBindBranches(scope){
  $$(".fleet-br-head", scope).forEach(btn => {
    if (btn._fleetBound) return;
    btn._fleetBound = true;
    btn.addEventListener("click", () => fleetToggleBranch(btn.dataset.cid, btn.dataset.bid));
  });
}

function fleetToggleCompany(cid){
  const open = !fleet.openCompanies.has(cid);
  if (open) fleet.openCompanies.add(cid); else fleet.openCompanies.delete(cid);
  const block = $(`.fleet-co[data-cid="${cid}"]`);
  if (!block) return;
  block.classList.toggle("is-open", open);
  $(".fleet-co-head", block)?.setAttribute("aria-expanded", String(open));
  const body = $(".fleet-co-body", block);
  if (!body) return;
  if (open){
    const c = (state.companies || []).find(x => x.id === cid);
    body.innerHTML = fleetBranchGroups(c, fleet.summary[String(cid)] || {});
    body.hidden = false;
    fleetBindBranches(body);
  } else {
    body.hidden = true;
    body.innerHTML = "";
  }
}

async function fleetToggleBranch(cid, bid){
  const key = cid + ":" + bid;
  const open = !fleet.openBranches.has(key);
  if (open) fleet.openBranches.add(key); else fleet.openBranches.delete(key);
  const block = $(`.fleet-br[data-key="${key}"]`);
  if (!block) return;
  block.classList.toggle("is-open", open);
  $(".fleet-br-head", block)?.setAttribute("aria-expanded", String(open));
  const body = $(".fleet-br-body", block);
  if (!body) return;
  if (!open){ body.hidden = true; body.innerHTML = ""; return; }
  body.hidden = false;
  let cars = fleet.cars.get(key);
  if (!cars){
    body.innerHTML = `<div class="fleet-loading">${escape(t("fleet.loading"))}</div>`;
    const p = fleetParams();
    p.set("company_id", cid);
    p.set("branch_id", bid);   // "none" → the server's IS NULL / Head-office bucket
    try { cars = await API.listCarsFiltered(p.toString()); } catch (e){ cars = []; }
    cars = Array.isArray(cars) ? cars : [];
    fleet.cars.set(key, cars);
    if (!fleet.openBranches.has(key)) return;   // collapsed again while loading
  }
  body.innerHTML = fleetCarsTable(cars);
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
  // Keep the location filter's options in sync with branch locations too
  // (branches may resolve after the first dropdown fill).
  populateFilterSelect($("#filter-companies-loc"), [
    ...(state.companies || []).map(c => c.location),
    ...(state.branches  || []).map(b => b.location),
  ]);
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

/* The client record currently shown in the shared client-detail modal, so its
   "Download PDF" button knows what to print (set on every open). */
let _detailClient = null;

/* Populate + open the shared client-detail modal for a full-record view. */
function openClientDetail(cr){
  const body = $("#client-detail-body");
  if (!body || !cr) return;
  _detailClient = cr;
  const k = (key) => escape(t(key));
  const v = (x) => x == null || x === "" ? "—" : escape(String(x));
  const name = [cr.firstname, cr.lastname].filter(Boolean).join(" ") || cr.name || "—";
  const idTypeKeys = {
    passport: "addClient.idType.passport",
    national_id: "addClient.idType.national",
    license: "addClient.idType.license",
    international_license: "addClient.idType.international",
  };
  const idType = cr.id_type ? escape(t(idTypeKeys[cr.id_type] || cr.id_type)) : "—";
  // The uploaded "photo" is the client's DOCUMENT (ID / passport / licence),
  // so show it full-width and rectangular (contain, not a cropped avatar) and
  // let a click open it full-size in a new tab. A PDF gets a link instead.
  const isPdf = cr.photo && /^data:application\/pdf|\.pdf($|\?)/i.test(cr.photo);
  const docBody = !cr.photo
    ? `<p class="client-doc-empty">${k("clients.noDoc")}</p>`
    : isPdf
      ? `<a href="${escape(cr.photo)}" target="_blank" rel="noopener" class="btn btn-ghost-dark client-doc-pdf">📄 ${k("action.view")}</a>`
      : `<a href="${escape(cr.photo)}" target="_blank" rel="noopener" class="client-doc-link" title="${k("action.view")}">
           <img src="${escape(cr.photo)}" alt="${k("addClient.photoOrDoc")}" class="client-doc-photo" loading="lazy">
         </a>`;
  body.innerHTML = `
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
      <dt>${k("addClient.idType")}</dt>      <dd>${idType}</dd>
      <dt>${k("clients.f.licstart")}</dt>    <dd>${v(cr.startdatelicense)}</dd>
      <dt>${k("clients.f.licend")}</dt>      <dd>${v(cr.enddatelicense)}</dd>
    </dl>
    <section class="client-doc-section">
      <h4 class="client-doc-title">${k("addClient.photoOrDoc")}</h4>
      ${docBody}
    </section>`;
  showModal("#client-detail-modal");
}

/* ============== SHARED PDF PRINT HELPERS ==============
   Client-side "Download PDF" used by every detail modal (company / car / client
   / B2B rental). Renders a clean one-page document into an off-screen iframe and
   fires the browser's print → Save-as-PDF — no popup, no server, no library. */
const _pdfEsc = (x) => escape(x == null || x === "" ? "—" : String(x));
// Each pair is [label, value] or [label, rawHtml, true] to inject HTML (e.g. a link).
function pdfRows(pairs){
  return `<table class="pdf-tbl">${pairs.map(([k, val, isHtml]) =>
    `<tr><th>${escape(k)}</th><td>${isHtml ? (val || "—") : _pdfEsc(val)}</td></tr>`).join("")}</table>`;
}
function printDoc(title, subtitle, bodyHtml){
  const dir  = document.documentElement.dir  || "ltr";
  const lang = document.documentElement.lang || "en";
  const now  = new Date();
  const stamp = `${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
  const align = dir === "rtl" ? "right" : "left";
  const doc = `<!doctype html><html dir="${dir}" lang="${lang}"><head><meta charset="utf-8">
<title>${escape(title)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'Inter','Cairo',Arial,sans-serif;color:#1a1d29;margin:32px}
  .pdf-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;border-bottom:2px solid #4f46e5;padding-bottom:10px;margin-bottom:18px}
  .pdf-brand{font-size:12px;font-weight:700;color:#4f46e5;letter-spacing:.05em;text-transform:uppercase}
  .pdf-title{font-size:20px;font-weight:800;margin:2px 0 0}
  .pdf-sub{color:#6b7180;font-size:13px;margin:3px 0 0}
  .pdf-stamp{font-size:11px;color:#9096a5;white-space:nowrap}
  .pdf-tbl{width:100%;border-collapse:collapse;margin:0 0 12px}
  .pdf-tbl th,.pdf-tbl td{text-align:${align};padding:7px 10px;border-bottom:1px solid #e6e8ef;font-size:13px;vertical-align:top}
  .pdf-tbl th{width:38%;color:#6b7180;font-weight:600}
  .pdf-tbl td{color:#1a1d29;font-weight:600}
  .pdf-h{font-size:14px;margin:18px 0 8px;color:#4f46e5}
  .pdf-empty{color:#9096a5}
  @media print{body{margin:14mm}}
</style></head><body>
  <div class="pdf-head">
    <div>
      <div class="pdf-brand">${escape(t("brand"))}</div>
      <h1 class="pdf-title">${escape(title)}</h1>
      ${subtitle ? `<p class="pdf-sub">${escape(subtitle)}</p>` : ""}
    </div>
    <div class="pdf-stamp">${escape(stamp)}</div>
  </div>
  ${bodyHtml}
</body></html>`;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(iframe);
  const w = iframe.contentWindow;
  w.document.open(); w.document.write(doc); w.document.close();
  const fire = () => { try { w.focus(); w.print(); } catch (e){} setTimeout(() => iframe.remove(), 1500); };
  const imgs = Array.from(w.document.images || []);
  if (!imgs.length){ setTimeout(fire, 200); return; }
  let n = imgs.length;
  const dec = () => { if (--n <= 0) fire(); };
  imgs.forEach(im => { if (im.complete) dec(); else { im.onload = dec; im.onerror = dec; } });
  setTimeout(fire, 2500);
}

/* ============== ENTITY DETAIL MODALS + PDF (admin cross-links) ==============
   In the admin report and reservation tables the company, car and client
   values are clickable (see drillCell). Each opens a read-only modal with the
   full record: the company with its branches, the car with the branch + company
   it belongs to, the client with everything the company entered. Every modal
   has a "Download PDF" button that prints a clean one-page document via the
   browser's Save-as-PDF (an off-screen iframe — no popup, no extra library). */
const EntityDetail = (() => {
  let curCompany = null, curCar = null;
  const V = (x) => x == null || x === "" ? "—" : escape(String(x));
  const K = (key) => escape(t(key));

  /* A saved company/branch coordinate is (x = lng, y = lat) — Google Maps wants
     "lat,lng", so the query is y,x. Only the PDF export builds a Google link
     now; on screen the location opens the in-app map instead (see locView). */
  const mapsUrl = (x, y) => (x != null && y != null)
    ? `https://www.google.com/maps?q=${encodeURIComponent(y)},${encodeURIComponent(x)}` : "";

  /* ONE location control: the place name and the map opener are the same thing.
     This used to be two rows — "Location" (the name + a small pin button) and
     "Map location" (a link out to Google Maps) — which named one place twice
     and offered two different maps for it. Now the whole row is the control,
     and it opens the in-app map full-page. Coordinates open it directly; a bare
     place name is geocoded (MapPicker.openLocation handles both), so a company
     that was never pinned still opens a map. */
  const locView = (name, x, y) => {
    const hasXY = x != null && y != null && x !== "";
    if (!name && !hasXY) return "—";
    const coordAttrs = hasXY ? ` data-x="${x}" data-y="${y}"` : "";
    return `<button type="button" class="rd-loc-view" data-name="${escape(name || "")}"${coordAttrs} title="${K("companies.viewOnMap")}">`
      + `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>`
      + `<span class="rd-loc-view-text">${name ? escape(name) : K("companies.seeLoc")}</span>`
      + `</button>`;
  };

  /* A clickable map-pin that opens the location on the in-app map. Coordinates
     open it directly; a bare place name is geocoded (MapPicker.openLocation
     handles both). Only rendered when there's something to locate. */
  const locPin = (name, x, y) => {
    if (!name && (x == null || y == null)) return "";
    const coordAttrs = (x != null && y != null) ? ` data-x="${x}" data-y="${y}"` : "";
    return ` <button type="button" class="rd-loc-pin" data-name="${escape(name || "")}"${coordAttrs} title="${K("companies.viewOnMap")}" aria-label="${K("companies.viewOnMap")}">`
      + `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>`
      + `</button>`;
  };

  /* ---- Company (from already-loaded state) ---- */
  function companyBody(c, branches){
    const logo = c.logo
      ? `<img src="${escape(c.logo)}" alt="" class="rd-logo-img">`
      : `<span class="rd-logo-img rd-logo-empty" style="background:${_avatarColor(c.companyname)}">${escape(_initials(c.companyname))}</span>`;
    const brHtml = branches.length
      ? `<ul class="rd-branch-list">${branches.map((b, i) =>
          `<li><span class="rd-branch-n">${K("companies.branch")} ${i + 1}</span>`
          + `<span class="rd-branch-v">${V(b.location)}`
          + `${b.phonenumber ? ` · <span class="ltr">${escape(b.phonenumber)}</span>` : ""}`
          + `${locPin(b.location, b.x, b.y)}</span></li>`).join("")}</ul>`
      : `<p class="client-doc-empty">${K("detail.noBranches")}</p>`;
    return `
      <div class="rd-idhead">${logo}<div class="rd-idname">${escape(c.companyname)}</div></div>
      <dl class="detail-grid">
        <dt>${K("register.f.owner")}</dt>  <dd>${V(c.owner_name)}</dd>
        <dt>${K("companies.f.cid")}</dt>   <dd>${V(c.companyid)}</dd>
        <dt>${K("companies.f.loc")}</dt>   <dd>${locView(c.location, c.x, c.y)}</dd>
        <dt>${K("companies.f.phone")}</dt> <dd>${c.phonenumber ? formatPhonesCell(c.phonenumber) : "—"}</dd>
      </dl>
      <section class="rd-branch-section">
        <h4 class="rd-h">${K("detail.branches")} (${branches.length})</h4>
        ${brHtml}
      </section>`;
  }
  // Wire every map control in the company modal to open the in-app map viewer:
  // the one big location row (.rd-loc-view) and the small per-branch pins in the
  // branch list (.rd-loc-pin), which point at different places and so stay.
  function bindLocPins(root){
    $$(".rd-loc-pin, .rd-loc-view", root).forEach(btn => {
      btn.addEventListener("click", () => {
        MapPicker.openLocation({
          x: btn.dataset.x != null ? Number(btn.dataset.x) : null,
          y: btn.dataset.y != null ? Number(btn.dataset.y) : null,
          label: btn.dataset.name,
        });
      });
    });
  }
  function openCompany(companyId){
    const c = (state.companies || []).find(co => co.id === Number(companyId));
    if (!c){ toast(t("toast.error"), "error"); return; }
    const branches = (state.branches || []).filter(b => b.company_id === c.id);
    curCompany = { c, branches };
    const body = $("#company-detail-body");
    body.innerHTML = companyBody(c, branches);
    bindLocPins(body);
    showModal("#company-detail-modal");
  }

  /* ---- Car (fetched by VIN so we get its branch + company) ---- */
  function carBody(car){
    return `
      <dl class="detail-grid">
        <dt>${K("cars.f.company")}</dt><dd><strong>${V(car.companyname)}</strong></dd>
        <dt>${K("cars.f.branch")}</dt> <dd>${car.branchname ? V(car.branchname) : K("detail.mainOffice")}</dd>
        <dt>${K("cars.f.vin")}</dt>    <dd><code>${V(car.vin)}</code></dd>
        <dt>${K("cars.f.type")}</dt>   <dd>${V(car.type)}</dd>
        <dt>${K("cars.f.model")}</dt>  <dd>${V(car.model)}</dd>
        <dt>${K("cars.f.color")}</dt>  <dd>${V(car.color)}</dd>
        <dt>${K("cars.f.plate")}</dt>  <dd><span class="ltr">${V(car.platenumber)}</span></dd>
        <dt>${K("cars.f.gps")}</dt>    <dd>${car.has_gps ? K("yes") : K("no")}</dd>
      </dl>`;
  }
  async function openCar(vin){
    curCar = null;
    const body = $("#car-detail-body");
    if (body) body.innerHTML = `<p class="rd-loading">…</p>`;
    showModal("#car-detail-modal");
    try {
      const d = await API.listCarsPaged(`page=1&page_size=1&vin=${encodeURIComponent(vin)}`);
      const car = (d.rows || [])[0];
      if (!car){ if (body) body.innerHTML = `<p class="client-doc-empty">${K("toast.error")}</p>`; return; }
      curCar = car;
      if (body) body.innerHTML = carBody(car);
    } catch (e){
      if (body) body.innerHTML = `<p class="client-doc-empty">${K("toast.error")}</p>`;
    }
  }

  /* ---- Client (reuse the existing rich client modal) ---- */
  function openClient(clientId){
    const cr = (state.clients || []).find(c => c.id === Number(clientId));
    if (!cr){ toast(t("toast.error"), "error"); return; }
    openClientDetail(cr);   // sets _detailClient for the PDF button
  }

  /* ---- Branch (from already-loaded state.branches) with a map pin ---- */
  function branchBody(b){
    const head = b.is_head_office
      ? ` <span class="rd-badge">${K("detail.headOffice")}</span>` : "";
    return `
      <div class="rd-idhead"><div class="rd-idname">${V(b.branchname)}${head}</div></div>
      <dl class="detail-grid">
        <dt>${K("cars.f.company")}</dt> <dd><strong>${V(b.companyname)}</strong></dd>
        <dt>${K("companies.f.loc")}</dt> <dd>${locView(b.location, b.x, b.y)}</dd>
        <dt>${K("companies.f.phone")}</dt> <dd>${b.phonenumber ? `<span class="ltr">${escape(b.phonenumber)}</span>` : "—"}</dd>
      </dl>`;
  }
  function openBranch(branchId){
    const b = (state.branches || []).find(x => x.id === Number(branchId));
    const body = $("#branch-detail-body");
    if (!body) return;
    if (!b){ toast(t("toast.error"), "error"); return; }
    body.innerHTML = branchBody(b);
    bindLocPins(body);
    showModal("#branch-detail-modal");
  }

  function open(kind, key){
    if (kind === "company") openCompany(key);
    else if (kind === "car") openCar(key);
    else if (kind === "client") openClient(key);
    else if (kind === "branch") openBranch(key);
  }

  /* ---- PDF (shared client-side print helpers: pdfRows / printDoc) ---- */
  function companyPdf(){
    if (!curCompany) return;
    const { c, branches } = curCompany;
    const mUrl = mapsUrl(c.x, c.y);
    let html = pdfRows([
      [t("companies.f.name"),  c.companyname],
      [t("register.f.owner"),  c.owner_name],
      [t("companies.f.cid"),   c.companyid],
      [t("companies.f.loc"),   c.location],
      [t("companies.f.phone"), c.phonenumber],
      // Keep the map link clickable in the saved PDF.
      [t("companies.f.maploc"), mUrl ? `<a href="${escape(mUrl)}">${escape(t("companies.seeLoc"))}</a>` : "—", true],
    ]);
    html += `<h3 class="pdf-h">${escape(t("detail.branches"))} (${branches.length})</h3>`;
    html += branches.length
      ? pdfRows(branches.map((b, i) => [`${t("companies.branch")} ${i + 1}`,
          [b.location, b.phonenumber].filter(Boolean).join(" · ")]))
      : `<p class="pdf-empty">—</p>`;
    printDoc(t("detail.companyInfo"), c.companyname, html);
  }
  function carPdf(){
    if (!curCar) return;
    const car = curCar;
    printDoc(t("detail.carInfo"), [car.model, car.platenumber].filter(Boolean).join(" — "), pdfRows([
      [t("cars.f.company"), car.companyname],
      [t("cars.f.branch"),  car.branchname || t("detail.mainOffice")],
      [t("cars.f.vin"),     car.vin],
      [t("cars.f.type"),    car.type],
      [t("cars.f.model"),   car.model],
      [t("cars.f.color"),   car.color],
      [t("cars.f.plate"),   car.platenumber],
      [t("cars.f.gps"),     car.has_gps ? t("yes") : t("no")],
    ]));
  }
  function clientPdf(){
    const cr = _detailClient;
    if (!cr) return;
    const name = [cr.firstname, cr.lastname].filter(Boolean).join(" ") || cr.name || "";
    const idTypeKeys = {
      passport: "addClient.idType.passport", national_id: "addClient.idType.national",
      license: "addClient.idType.license", international_license: "addClient.idType.international",
    };
    printDoc(t("detail.clientInfo"), name, pdfRows([
      [t("clients.f.name"),        name],
      [t("clients.f.pid"),         cr.personid],
      [t("clients.f.father"),      cr.fathername],
      [t("clients.f.mother"),      cr.mothername],
      [t("addClient.nationality"), cr.nationality],
      [t("clients.f.dob"),         cr.dateofbirth],
      [t("clients.f.phone"),       cr.phonenumber],
      [t("clients.f.lic"),         cr.licenseid],
      [t("addClient.idType"),      cr.id_type ? t(idTypeKeys[cr.id_type] || cr.id_type) : ""],
      [t("clients.f.licstart"),    cr.startdatelicense],
      [t("clients.f.licend"),      cr.enddatelicense],
    ]));
  }

  function setup(){
    $("#company-detail-close") ?.addEventListener("click", () => hideModal("#company-detail-modal"));
    $("#company-detail-cancel")?.addEventListener("click", () => hideModal("#company-detail-modal"));
    $("#company-detail-pdf")   ?.addEventListener("click", companyPdf);
    $("#car-detail-close")     ?.addEventListener("click", () => hideModal("#car-detail-modal"));
    $("#car-detail-cancel")    ?.addEventListener("click", () => hideModal("#car-detail-modal"));
    $("#car-detail-pdf")       ?.addEventListener("click", carPdf);
    $("#client-detail-pdf")    ?.addEventListener("click", clientPdf);
    $("#branch-detail-close")  ?.addEventListener("click", () => hideModal("#branch-detail-modal"));
    $("#branch-detail-cancel") ?.addEventListener("click", () => hideModal("#branch-detail-modal"));
  }

  return { open, setup };
})();

function renderClients(){
  const tbl = $("#tbl-clients");
  const rows = getClientsRows();
  if (!rows.length){
    const pt = $("#pager-top-clients"); if (pt) pt.hidden = true;
    const pb = $("#pager-clients"); if (pb) pb.hidden = true;
    return emptyRow(tbl, 10);
  }

  const info = Pager.slice("clients", rows);
  const dash = `<span class="badge no">—</span>`;
  const cell = (v) => v ? escape(v) : dash;
  const photo = (p, name) => p
    ? `<img src="${escape(p)}" alt="${escape(name||"")}" class="client-photo-thumb">`
    : `<span class="client-photo-thumb client-photo-thumb-empty" style="background:${_avatarColor(name)}">${escape(_initials(name))}</span>`;
  tbl.tBodies[0].innerHTML = info.rows.map((c,i) => `
    <tr>
      <td data-label="#">${(info.page - 1) * info.size + i + 1}</td>
      <td data-col="photo" data-label="${escape(t("addClient.photo"))}">${photo(c.photo, [c.firstname, c.lastname].filter(Boolean).join(" ") || c.name)}</td>
      <td data-label="${escape(t("clients.f.pid"))}">${cell(c.personid)}</td>
      <td data-label="${escape(t("clients.f.firstname"))}">${cell(c.firstname)}</td>
      <td data-label="${escape(t("clients.f.lastname"))}">${cell(c.lastname)}</td>
      <td data-label="${escape(t("addClient.nationality"))}">${cell(c.nationality)}</td>
      <td data-label="${escape(t("clients.f.phone"))}">${cell(c.phonenumber)}</td>
      <td data-label="${escape(t("clients.f.lic"))}">${cell(c.licenseid)}</td>
      <td data-label="${escape(t("clients.f.licend"))}">${cell(c.enddatelicense)}</td>
      <td data-col="view">
        <button type="button" class="row-btn client-view" data-id="${c.id}"
                title="${escape(t("action.view"))}" aria-label="${escape(t("action.view"))}">${ROW_MORE_ICO}</button>
      </td>
    </tr>`).join("");
  tbl.querySelectorAll(".client-view").forEach(btn => {
    btn.addEventListener("click", () => {
      const rec = (state.clients || []).find(x => x.id === Number(btn.dataset.id));
      if (rec) openClientDetail(rec);
    });
  });
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
    // No 30-day default here any more. The table groups these rows into one
    // row per client and calls the panel below it that client's HISTORY — a
    // history that silently stopped a month back would be a lie. Size is held
    // by paging the CLIENTS instead (see renderReportCompany), and From/To are
    // there for anyone who does want a window.
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

/* First-letters avatar fallback, e.g. "Ahmad Khalil" → "AK". */
function _initials(name){
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}
/* Deterministic avatar background from a name (stable per person). */
function _avatarColor(s){
  let h = 0;
  for (const ch of String(s || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return RA_PALETTE[h % RA_PALETTE.length];
}
/* Whole-day span between two ISO dates (inclusive of the start day). */
function _daysBetween(a, b){
  if (!a || !b) return null;
  const d1 = new Date(String(a).slice(0, 10)), d2 = new Date(String(b).slice(0, 10));
  if (isNaN(d1) || isNaN(d2)) return null;
  return Math.max(0, Math.round((d2 - d1) / 86400000));
}

/* ============== ADMIN REPORT: ONE RENTAL, ONE MODAL ==============
   The report row used to expand a panel underneath itself. It opens this modal
   instead — same receipt (Company / Vehicle / Client / Rental period), but with
   room to show the fields the row can't: both sides' phone lists, colour, plate,
   exact dates, booking status.

   `open()` is handed the report row OBJECT, and reads nothing back out of the
   DOM. That matters: the table underneath can re-render — a filter change, a
   page turn, a language switch — without this modal going stale or losing what
   it's showing.

   The three drill buttons leave for the company / client / vehicle modals, which
   are untouched. This one closes as they open, so two backdrops never stack. */
const ReportRow = (() => {
  let _cur = null;      // the rental currently on screen
  let _wired = false;

  const dash = `<span class="cell-dash">—</span>`;
  const ltr  = (v) => `<span class="ltr">${escape(v)}</span>`;
  const day  = (d) => d ? ltr(String(d).slice(0, 10)) : dash;
  // A phone field may hold several numbers joined by commas/semicolons — render
  // each on its own line as a tappable tel: link so two+ numbers stay readable.
  const telList = (raw) => {
    const parts = String(raw || "").split(/[,;\n/]+/).map(s => s.trim()).filter(Boolean);
    if (!parts.length) return dash;
    return parts.map(p => `<a href="tel:${escape(p)}" class="ltr rd-phone">${escape(p)}</a>`).join("");
  };
  const yn = (on) => on
    ? `<span class="badge yes">${escape(t("yes"))}</span>`
    : `<span class="badge no">${escape(t("no"))}</span>`;
  // A labelled field (key left, value right).
  const field = (key, val) =>
    `<div class="rd-item"><span class="rd-k">${escape(t(key))}</span><span class="rd-v">${val}</span></div>`;
  // A titled group of fields.
  const group = (titleKey, fieldsHtml) =>
    `<section class="rd-group"><h4 class="rd-h">${escape(t(titleKey))}</h4><div class="rd-fields">${fieldsHtml}</div></section>`;

  const ICO = {
    company: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M15 9h.01M9 13h.01M15 13h.01M10 21v-4h4v4"/></svg>`,
    client:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>`,
    car:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 17h14M4 17v-4l2-5h12l2 5v4"/><circle cx="7.5" cy="17" r="1.8"/><circle cx="16.5" cy="17" r="1.8"/></svg>`,
  };
  // A drill button, but only when there's actually something to open — a row
  // missing its client_id would otherwise render a button that does nothing.
  const drill = (kind, key, labelKey) => (key == null || key === "")
    ? ""
    : `<button type="button" class="rd-drill" data-drill="${escape(kind)}" data-drillkey="${escape(String(key))}">`
      + `${ICO[kind]}<span>${escape(t(labelKey))}</span></button>`;

  function bodyHtml(r){
    const status = _raStatus(r, _raToday()) === "active"
      ? `<span class="badge yes">${escape(t("report.active"))}</span>`
      : `<span class="badge no">${escape(t("report.ended"))}</span>`;
    return `
      <div class="report-detail">
        ${group("report.company",
            field("report.cname",  r.company_name ? escape(r.company_name) : dash) +
            field("report.cphone", telList(r.company_phone)))}
        ${group("report.vehicle",
            field("cars.f.model", r.car_model ? escape(r.car_model) : dash) +
            field("cars.f.color", r.car_color ? escape(r.car_color) : dash) +
            field("report.plate", r.car_plate ? ltr(r.car_plate) : dash) +
            field("report.gps",   yn(r.car_has_gps)))}
        ${group("report.client",
            field("report.cliName", r.client_name ? escape(r.client_name) : dash) +
            field("report.phone",   telList(r.client_phone)))}
        ${group("report.period",
            field("report.from",   day(r.start_date)) +
            field("report.to",     day(r.end_date)) +
            field("report.status", status))}
        <div class="rd-drills">
          ${drill("company", r.company_id, "report.openCompany")}
          ${drill("client",  r.client_id,  "report.openClient")}
          ${drill("car",     r.car_vin,    "report.openVehicle")}
        </div>
      </div>`;
  }

  function open(r){
    if (!r) return;
    _cur = r;
    const body = $("#report-row-body");
    if (body) body.innerHTML = bodyHtml(r);
    // Name the rental in the title bar so a stack of these is still legible.
    const ttl = $("#report-row-title");
    if (ttl){
      const who = [r.car_model, r.client_name].filter(Boolean).join(" · ");
      ttl.textContent = who ? `${t("report.rowTitle")} — ${who}` : t("report.rowTitle");
    }
    showModal("#report-row-modal");
  }
  const close = () => hideModal("#report-row-modal");

  function setup(){
    if (_wired) return;
    _wired = true;
    $("#report-row-close")?.addEventListener("click", close);
    $("#report-row-cancel")?.addEventListener("click", close);
    // Click the backdrop (not the card) to dismiss — the house pattern.
    $("#report-row-modal")?.addEventListener("click", (e) => {
      if (e.target.id === "report-row-modal") close();
    });
    // Photos / video / extra drivers live in the shared Detail modal. Hand off.
    $("#report-row-media")?.addEventListener("click", () => {
      const r = _cur;
      close();
      if (r) Detail.open(r);
    });
    // Drilling leaves for another modal; close first so only one is ever up.
    $("#report-row-body")?.addEventListener("click", (e) => {
      const b = e.target.closest(".rd-drill");
      if (!b) return;
      const { drill: kind, drillkey: key } = b.dataset;
      close();
      EntityDetail.open(kind, key);
    });
  }

  return { open, close, setup };
})();

/* The admin report's currently-rendered rows, and whether its tbody has been
   wired yet. The tbody OUTLIVES a re-render (only its innerHTML is replaced),
   so its click listener must be attached exactly once — attaching it per render
   would stack a fresh copy each time and open the modal once per past render.
   The listener therefore reads the rows from here rather than from a closure. */
let _reportRows = [];
let _reportRowsWired = false;

/* Delegated, so it survives the tbody's innerHTML being rewritten. The drill
   cells and the row itself both want the click; the innermost match wins:
     .cell-drill   -> that entity's own modal (company / vehicle / client)
     <a>           -> a tel: link, leave it alone
     anywhere else -> this rental's full record, in the ReportRow modal */
function wireReportRowClicks(tbl){
  if (_reportRowsWired || !tbl || !tbl.tBodies[0]) return;
  _reportRowsWired = true;
  tbl.tBodies[0].addEventListener("click", (e) => {
    const drill = e.target.closest(".cell-drill");
    if (drill){
      EntityDetail.open(drill.dataset.drill, drill.dataset.drillkey);
      return;
    }
    if (e.target.closest("a")) return;
    const tr = e.target.closest("tr.report-row");
    if (!tr) return;
    // data-row is the page-ABSOLUTE index, so page 2 opens page 2's rentals.
    ReportRow.open(_reportRows[Number(tr.dataset.row)]);
  });
}

function renderReport(){
  const tbl = $("#tbl-report");
  const rows = getReportRows();
  const _u = AUTH.user();
  // Company users get a compact, purpose-built table; the admin grid stays
  // the comprehensive premium layout.
  if (_u && _u.role === "company") return renderReportCompany(rows);
  renderReportAnalytics(rows);
  if (!rows.length){
    if (typeof AdminCarsHub !== "undefined") AdminCarsHub.syncReportCount(0);
    const pt = $("#pager-top-report-admin"); if (pt) pt.hidden = true;
    const pb = $("#pager-report-admin"); if (pb) pb.hidden = true;
    return emptyRow(tbl, 7);
  }

  // The admin report is a COMPACT summary — one row per rental showing
  //   company · vehicle · client · period · GPS(green/red) · status(picker)
  // plus a Details button. Clicking that button, or anywhere else on the row,
  // opens the ReportRow MODAL with every field (both phones, colour, plate,
  // exact dates, status) and the way out to photos / extra drivers.
  // Atomic Latin tokens (dates, phones, plate) are LTR-isolated so they read
  // correctly even when the UI is Arabic/RTL.
  const info  = Pager.slice("report", rows);
  const today = _raToday();
  const ltr   = (v) => `<span class="ltr">${escape(v)}</span>`;
  const dash  = `<span class="cell-dash">—</span>`;
  const day   = (d) => d ? String(d).slice(0, 10) : "";
  // green Yes / red No pill (badge yes|no).
  const yn = (on) => on
    ? `<span class="badge yes">${escape(t("yes"))}</span>`
    : `<span class="badge no">${escape(t("no"))}</span>`;
  // Between 721 and 1024px every row becomes a card and the <thead> is hidden,
  // so a cell's only label is its data-label. Without one it right-aligns bare
  // and you're left guessing which date is which.
  const lbl = (k) => escape(t(k));

  tbl.tBodies[0].innerHTML = info.rows.map((r, i) => {
    const idx = (info.page - 1) * info.size + i;
    // The status cell READS the booking state the owning company set — it is
    // not a control. Moving a booking is that company's call, from its own Cars
    // & Rentals tables; the admin sees the result across every company.
    // A RETURNED booking shows "Returned" and nothing else: the car is back, so
    // the booking is settled and the state it was in on the way there is
    // history. Pairing the two ("Active · Returned") read as a contradiction.
    // Only an ACTIVE booking carries the date-derived Overdue badge — a pending
    // or cancelled one has no car out to be late.
    const bs = r.status || "active";
    const status = r.returned_at
      ? `<span class="return-badge returned">${escape(t("special.status.returned"))}</span>`
      : statusTag(bs, bs === "active" && _raStatus(r, today) === "overdue"
          ? `<span class="return-badge overdue">${escape(t("returns.overdue"))}</span>` : "");
    const gps    = yn(r.car_has_gps);
    const period = `${ltr(day(r.start_date)) || dash}<span class="rp-arrow">→</span>${ltr(day(r.end_date)) || dash}`;

    return `<tr data-row="${idx}" class="report-row al-click-row">
        <td data-col="company" data-label="${lbl("report.company")}">${drillCell("company", r.company_id, r.company_name, true)}</td>
        <td data-col="vehicle" data-label="${lbl("report.vehicle")}">${drillCell("car", r.car_vin, r.car_model, false)}</td>
        <td data-col="client" data-label="${lbl("report.client")}">${drillCell("client", r.client_id, r.client_name, true)}</td>
        <td data-col="period" data-label="${lbl("report.period")}">${period}</td>
        <td data-col="gps" data-label="${lbl("report.gps")}">${gps}</td>
        <td data-col="status" data-label="${lbl("report.status")}">${status}</td>
        <td data-col="view">
          <button type="button" class="row-btn report-view" data-detail="${idx}"
                  title="${escape(t("report.rowTitle"))}"
                  aria-label="${escape(t("report.rowTitle"))}">${ROW_MORE_ICO}</button>
        </td>
      </tr>`;
  }).join("");

  // The rows the delegated listener resolves against. renderReport re-runs on
  // every filter change and page turn, so the listener can't close over `rows`
  // — it would answer with the first render's data forever.
  _reportRows = rows;
  wireReportRowClicks(tbl);

  // The tab badge counts what's ON SCREEN, so it tracks the toolbar filters
  // instead of lagging a filter behind. Same reason the fleet badge reads
  // fleet.summary. Guarded: the company role renders no hub.
  if (typeof AdminCarsHub !== "undefined") AdminCarsHub.syncReportCount(rows.length);

  Pager.render("report", "#pager-top-report-admin", "#pager-report-admin", info, renderReport);
}

/* Which clients' history panels are open in the company report. Keyed the same
   way the master rows are, so an open panel survives a re-render (a filter
   change, a page turn, a language switch) instead of snapping shut. */
const expandedReportClients = new Set();

/* Fold the filtered rental rows into ONE ENTRY PER CLIENT — the master rows of
   the company report. Every entry keeps its own rentals (newest first), so the
   panel below it reads as that client's history with this company.
   The rows arriving here are already scoped to the company and narrowed by the
   toolbar (see getReportRows), so both levels answer the same filter. */
function groupReportByClient(rows){
  const byClient = new Map();
  rows.forEach((r, idx) => {
    // client_id is the identity; the name is only a fallback for a row that
    // somehow arrives without one, so two same-named clients never merge.
    const key = r.client_id != null ? `id:${r.client_id}` : `name:${r.client_name || ""}`;
    let g = byClient.get(key);
    if (!g){
      g = { key, name: r.client_name || "", phone: r.client_phone || "", rentals: [] };
      byClient.set(key, g);
    }
    // Keep the row's index in `rows` — that's what the media button reopens.
    g.rentals.push({ r, idx });
    if (!g.phone && r.client_phone) g.phone = r.client_phone;
  });
  const started = (x) => String(x.r.start_date || "").slice(0, 10);
  const groups = [...byClient.values()];
  groups.forEach(g => {
    g.rentals.sort((a, b) => started(b).localeCompare(started(a)));
    // Distinct cars, not rentals: renting the same car twice is one car.
    g.cars   = new Set(g.rentals.map(x => x.r.car_vin || carLabel(x.r))).size;
    g.latest = g.rentals[0].r;
  });
  // Most recently active client first — the history you're most likely after.
  return groups.sort((a, b) =>
    String(b.latest.start_date || "").localeCompare(String(a.latest.start_date || "")));
}

/* Company rental report — a MASTER–DETAIL history of the company's own clients.
   Master row: client · phone · rentals · distinct cars · latest period · toggle.
   Detail panel: every car that client rented from this company, newest first,
   each with plate / colour / GPS / dates / booking status and a button to the
   shared Detail modal (photos, video, extra driver).
   Paging counts CLIENTS here, not rentals — the table's unit is the client. */
function renderReportCompany(rows){
  const tbl = $("#tbl-report-co");
  if (!tbl) return;
  const groups = groupReportByClient(rows);
  // Push the FILTERED client count at the hub's tab badge, same as the admin
  // report pushes its own (see AdminCarsHub.syncReportCount). Pulling it from
  // the hub would report the unfiltered feed and lag the toolbar by one change.
  if (typeof CoClientsHub !== "undefined") CoClientsHub.syncHistoryCount(groups.length);
  if (!groups.length){
    const pt = $("#pager-top-report"); if (pt) pt.hidden = true;
    const pb = $("#pager-report");     if (pb) pb.hidden = true;
    return emptyRow(tbl, 6);
  }
  const info  = Pager.slice("report", groups);
  const today = _raToday();
  const ltr   = (v) => `<span class="ltr">${escape(v)}</span>`;
  const dash  = `<span class="cell-dash">—</span>`;
  const day   = (d) => d ? ltr(String(d).slice(0, 10)) : dash;
  const lbl   = (key) => escape(t(key));
  const gpsPill = (on) => on
    ? `<span class="badge yes">${escape(t("yes"))}</span>`
    : `<span class="badge no">${escape(t("no"))}</span>`;

  // One rental inside a client's history panel.
  const historyItem = (r, idx) => {
    // Booking state (pending / active / cancelled) as a read-only pill — the
    // report reads history; moving a booking is the Cars & Rentals tables' job.
    // A RETURNED rental shows "Returned" ALONE: the car is back, the booking is
    // settled, and the state it held on the way there is history. Only an
    // un-returned, non-cancelled booking can still be out and therefore late.
    const st = BOOKING_STATUSES.includes(r.status) ? r.status : "active";
    let tags;
    if (r.returned_at){
      tags = `<span class="return-badge returned">${escape(t("special.status.returned"))}</span>`;
    } else {
      const late = st !== "cancelled" && _raStatus(r, today) === "overdue"
        ? `<span class="return-badge overdue">${escape(t("returns.overdue"))}</span>` : "";
      tags = `<span class="status-tag ${st}">${escape(t("status." + st + ".short"))}</span>${late}`;
    }
    return `<li class="ch-item${st === "cancelled" ? " ch-item-off" : ""}">
      <div class="ch-car">
        <span class="ch-model">${r.car_model ? escape(r.car_model) : dash}</span>
        <span class="ch-sub">
          <span class="ch-plate">${r.car_plate ? ltr(r.car_plate) : dash}</span>
          <span class="ch-dot" aria-hidden="true">·</span>
          <span class="ch-color">${r.car_color ? escape(r.car_color) : dash}</span>
          <span class="ch-dot" aria-hidden="true">·</span>
          <span class="ch-gps">${lbl("report.gps")} ${gpsPill(r.car_has_gps)}</span>
        </span>
      </div>
      <div class="ch-dates">${day(r.start_date)}<span class="rp-arrow">→</span>${day(r.end_date)}</div>
      <div class="ch-tags">${tags}</div>
      <button type="button" class="row-btn ch-media" data-media="${idx}">${lbl("report.openMedia")}</button>
    </li>`;
  };

  tbl.tBodies[0].innerHTML = info.rows.map((g, i) => {
    const open  = expandedReportClients.has(g.key);
    const panel = `history-${info.page}-${i}`;
    const count = g.rentals.length;
    const period = `${day(g.latest.start_date)}<span class="rp-arrow">→</span>${day(g.latest.end_date)}`;
    const avatar = `<span class="ch-avatar" style="background:${_avatarColor(g.name)}" aria-hidden="true">${escape(_initials(g.name))}</span>`;

    // The panel ships EMPTY — its list and pager are filled in below, by the
    // same function a page turn calls, so first paint and page 2 go through
    // one code path.
    return `<tr class="client-master-row${open ? " is-expanded" : ""}" data-client="${escape(g.key)}">
        <td data-col="client" data-label="${lbl("report.client")}">
          <span class="ch-client">${avatar}<strong>${escape(g.name) || "—"}</strong></span>
        </td>
        <td data-col="phone" data-label="${lbl("report.phone")}">${formatPhonesCell(g.phone)}</td>
        <td data-col="rentals" data-label="${lbl("report.rentals")}">${count}</td>
        <td data-col="cars" data-label="${lbl("report.carsCount")}">${g.cars}</td>
        <td data-col="latest" data-label="${lbl("report.latest")}">${period}</td>
        <td data-col="view">
          <button type="button" class="row-btn client-toggle" aria-expanded="${open}"
                  aria-controls="${panel}"
                  title="${escape(t(open ? "report.hide" : "report.history"))}"
                  aria-label="${escape(t(open ? "report.hide" : "report.history"))}">
            <span class="rv-eye" aria-hidden="true">${ROW_MORE_ICO}</span>
            <span class="rv-chev" aria-hidden="true">⌄</span>
          </button>
        </td>
      </tr>
      <tr class="client-history-row" id="${panel}"${open ? "" : " hidden"}>
        <td colspan="6">
          <div class="client-history">
            <h4 class="ch-h">${lbl("report.history")} · ${count} ${lbl(count === 1 ? "report.result" : "report.results")}</h4>
            <div id="${panel}-top" class="pager-wrap ch-pager" hidden></div>
            <ol id="${panel}-list" class="ch-list"></ol>
            <div id="${panel}-nav" class="pager-wrap ch-pager" hidden></div>
          </div>
        </td>
      </tr>`;
  }).join("");

  /* Fill (or re-fill) one client's history list — a long-standing client can
     have more rentals than anyone wants to scroll, so the panel pages too.
     Its pager is keyed by CLIENT, not by screen position, so the page a client
     is on survives a re-render and two open panels page independently. Pager
     hides itself at ≤10 entries, so a short history stays a plain list. */
  const renderHistory = (g, panel) => {
    const list = $(`#${panel}-list`);
    if (!list) return;
    const key = `report-history:${g.key}`;
    const hi  = Pager.slice(key, g.rentals);
    list.innerHTML = hi.rows.map(x => historyItem(x.r, x.idx)).join("");
    // Each entry's button opens that rental's full record (photos, video, extra
    // driver) — the same modal the flat list used to open on a row click. Bound
    // per page: these buttons are replaced on every page turn.
    $$(".ch-media", list).forEach(b => {
      b.addEventListener("click", () => Detail.open(rows[Number(b.dataset.media)]));
    });
    Pager.render(key, `#${panel}-top`, `#${panel}-nav`, hi, () => renderHistory(g, panel));
  };
  info.rows.forEach((g, i) => renderHistory(g, `history-${info.page}-${i}`));

  // Open / close a client's history in place — no re-render, so the rest of
  // the page (and any other open panel) stays exactly where it was.
  const toggle = (tr) => {
    const key  = tr.dataset.client;
    const btn  = $(".client-toggle", tr);
    const row  = tr.nextElementSibling;
    if (!row || !row.classList.contains("client-history-row")) return;
    const open = row.hasAttribute("hidden");
    row.hidden = !open;
    tr.classList.toggle("is-expanded", open);
    if (open) expandedReportClients.add(key); else expandedReportClients.delete(key);
    if (btn){
      btn.setAttribute("aria-expanded", String(open));
      const label = t(open ? "report.hide" : "report.history");
      btn.title = label; btn.setAttribute("aria-label", label);
    }
  };
  $$("tr.client-master-row", tbl).forEach(tr => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;   // don't hijack tel: links
      toggle(tr);
    });
  });
  Pager.render("report", "#pager-top-report", "#pager-report", info, renderReport);
}

/* ============== ADMIN ANALYTICS (Report tab) ==================
   A dependency-free visual summary of everything the companies have
   entered. All charts are drawn from the same report rows the table
   uses (already filtered by the admin toolbar), so they react live to
   the company / client / license / date filters. SVG donuts + CSS bars
   keep it lightweight and theme-aware (colors come from the rows, the
   chrome from the dark admin tokens). Re-runs on every renderReport(),
   which also fires on language change — so EN/AR stay in sync. */
const RA_PALETTE = [
  "#818cf8", "#34d399", "#fbbf24", "#f87171", "#22d3ee",
  "#a78bfa", "#fb923c", "#4ade80", "#f472b6", "#60a5fa",
];

/* The car-rental day count for a row, clamped to >= 1. Used nowhere
   critical — just a friendly KPI. */
function _raToday(){
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* Classify a rental row into one bucket: returned / overdue / active.
   returned_at is the source of truth for "back in stock"; an out car
   whose end_date has passed is overdue; everything else is active. */
function _raStatus(r, today){
  if (r.returned_at) return "returned";
  if (r.end_date && String(r.end_date).slice(0, 10) < today) return "overdue";
  return "active";
}

/* Tally rows by a key function → sorted [{label, value}] desc. */
function _raCountBy(rows, keyFn){
  const m = new Map();
  rows.forEach(r => {
    const k = keyFn(r);
    if (k == null || k === "") return;
    m.set(k, (m.get(k) || 0) + 1);
  });
  return [...m.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

/* Keep the top N, roll the rest into a single "Other" slice. */
function _raTopN(items, n){
  if (items.length <= n) return items;
  const top = items.slice(0, n);
  const rest = items.slice(n).reduce((s, i) => s + i.value, 0);
  if (rest > 0) top.push({ label: t("analytics.other"), value: rest, _other: true });
  return top;
}

/* Build one donut (SVG) + legend from segments [{label,value,color}].
   Uses the classic circumference-100 trick (r = 15.915) so percentages
   map straight to stroke-dasharray. */
function _raDonut(host, segments, centerValue, centerLabel){
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (!total){
    host.innerHTML = `<p class="ra-empty">${escape(t("analytics.noData"))}</p>`;
    return;
  }
  const R = 15.91549431;
  let cum = 0;
  const arcs = segments.map(s => {
    const pct = s.value / total * 100;
    const dash = `${pct.toFixed(3)} ${(100 - pct).toFixed(3)}`;
    const off = (25 - cum + 100) % 100;   // start segment at 12 o'clock, walk clockwise
    cum += pct;
    return `<circle class="ra-seg" cx="21" cy="21" r="${R}" fill="none"
            stroke="${s.color}" stroke-width="4.5"
            stroke-dasharray="${dash}" stroke-dashoffset="${off.toFixed(3)}"></circle>`;
  }).join("");

  const legend = segments.map(s => {
    const pct = Math.round(s.value / total * 100);
    return `
    <li class="ra-leg-item">
      <span class="ra-leg-dot" style="background:${s.color}"></span>
      <span class="ra-leg-name" title="${escape(s.label)}">${escape(s.label)}</span>
      <span class="ra-leg-val">${s.value}</span>
      <span class="ra-leg-pct">${pct}%</span>
    </li>`;
  }).join("");

  host.innerHTML = `
    <div class="ra-donut">
      <svg viewBox="0 0 42 42" class="ra-donut-svg" role="img" aria-hidden="true">
        <circle cx="21" cy="21" r="${R}" fill="none" stroke="var(--line)" stroke-width="4.5"></circle>
        ${arcs}
      </svg>
      <div class="ra-donut-center">
        <span class="ra-donut-num">${centerValue}</span>
        <span class="ra-donut-cap">${escape(centerLabel)}</span>
      </div>
    </div>
    <ul class="ra-legend">${legend}</ul>`;
}

let _raKpiAnimated = false;
function renderReportAnalytics(rows){
  const wrap = $("#report-analytics");
  if (!wrap) return;
  // Admin-only feature; the container is display:none for company users,
  // but skip the work entirely to be safe.
  if ((AUTH.user()?.role) !== "admin") return;

  rows = rows || [];
  const today = _raToday();

  // ---- KPI tiles ----
  const uniq = (fn) => new Set(rows.map(fn).filter(v => v != null && v !== "")).size;
  const byStatus = { active: 0, overdue: 0, returned: 0 };
  rows.forEach(r => { byStatus[_raStatus(r, today)]++; });

  const kpis = [
    { k: "analytics.kpi.total",     v: rows.length,                       cls: "ra-kpi-total" },
    { k: "analytics.kpi.active",    v: byStatus.active,                   cls: "ra-kpi-active" },
    { k: "analytics.kpi.overdue",   v: byStatus.overdue,                  cls: "ra-kpi-overdue" },
    { k: "analytics.kpi.returned",  v: byStatus.returned,                 cls: "ra-kpi-returned" },
    { k: "analytics.kpi.companies", v: uniq(r => r.company_id),           cls: "ra-kpi-companies" },
    { k: "analytics.kpi.cars",      v: uniq(r => r.car_vin),              cls: "ra-kpi-cars" },
    { k: "analytics.kpi.clients",   v: uniq(r => r.client_id ?? r.client_licenseid ?? r.client_name), cls: "ra-kpi-clients" },
    { k: "analytics.kpi.gps",       v: rows.filter(r => r.car_has_gps).length, cls: "ra-kpi-gps" },
  ];
  const kpiHost = $("#ra-kpis");
  if (kpiHost){
    kpiHost.innerHTML = kpis.map(c => `
      <div class="ra-kpi ${c.cls}">
        <span class="ra-kpi-val" data-count="${c.v}">${c.v}</span>
        <span class="ra-kpi-cap">${escape(t(c.k))}</span>
      </div>`).join("");
    // Count-up once per session land (kept subtle; re-renders just set values).
    if (!_raKpiAnimated){
      _raKpiAnimated = true;
      _raCountUp(kpiHost);
    }
  }

  // ---- Donut 1: status ----
  const statusSegs = [
    { label: t("analytics.kpi.active"),   value: byStatus.active,   color: "#34d399" },
    { label: t("analytics.kpi.overdue"),  value: byStatus.overdue,  color: "#f87171" },
    { label: t("analytics.kpi.returned"), value: byStatus.returned, color: "#94a3b8" },
  ].filter(s => s.value > 0);
  _raDonut($("#ra-status"), statusSegs, rows.length, t("analytics.kpi.total"));

  // ---- Donut 2: by company (top 6 + Other) ----
  const compSegs = _raTopN(_raCountBy(rows, r => r.company_name), 6)
    .map((s, i) => ({ ...s, color: s._other ? "#64748b" : RA_PALETTE[i % RA_PALETTE.length] }));
  _raDonut($("#ra-company"), compSegs, uniq(r => r.company_id), t("analytics.kpi.companies"));
}

/* Tiny count-up for the KPI tiles — eased, ~700ms, integer steps. */
function _raCountUp(host){
  host.querySelectorAll("[data-count]").forEach(el => {
    const target = Number(el.dataset.count) || 0;
    if (target <= 0){ el.textContent = "0"; return; }
    const dur = 700, start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased).toLocaleString();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/* ============== SHARED RETURN / EXTEND PICKERS ==============
   Both "Cars Rented by Individuals" (Returns) and "Cars Rented by Companies"
   (SpecialRentals) hand cars back to a branch and can push the return date
   out, so the branch picker and the extend-date picker live at module scope
   and are reused by both. Each resolves a Promise on confirm, null on cancel. */

// Ask which branch the car came back to. Resolves { branchId } (null = Main /
// head office) on confirm, or null if cancelled. Falls back to Main if the
// picker markup isn't present.
function pickReturnBranch(label){
  return new Promise((resolve) => {
    const listEl = $("#return-branch-list");
    const confirmBtn = $("#return-branch-confirm");
    const cancelBtn = $("#return-branch-cancel");
    const closeBtn = $("#return-branch-close");
    if (!listEl || !confirmBtn){ resolve({ branchId: null }); return; }
    const lab = $("#return-branch-carlabel");
    if (lab) lab.textContent = label || "";
    const u = AUTH.user();

    // Render EVERY branch of this company as a visible, selectable card — Main
    // (head office) first, then each branch — so the owner sees all options at
    // once instead of hunting through a dropdown. Main is preselected.
    const optionHtml = (val, name, sub, checked) => `
      <label class="rb-option${checked ? " selected" : ""}">
        <input type="radio" name="rb-branch" value="${val}"${checked ? " checked" : ""}>
        <span class="rb-option-mark" aria-hidden="true"></span>
        <span class="rb-option-body">
          <span class="rb-option-name">${escape(name)}</span>
          ${sub ? `<span class="rb-option-sub">${escape(sub)}</span>` : ""}
        </span>
      </label>`;
    const fill = (branches) => {
      const list = Array.isArray(branches) ? branches : [];
      listEl.innerHTML =
        optionHtml("", t("cars.branch.main"), t("returns.branch.mainSub"), true) +
        list.map(b => optionHtml(String(b.id), b.branchname || t("cars.branch.main"),
                                 b.location || "", false)).join("");
      // Keep the selected card visually highlighted as the choice changes.
      listEl.querySelectorAll("input[name='rb-branch']").forEach(inp => {
        inp.addEventListener("change", () => {
          listEl.querySelectorAll(".rb-option").forEach(o =>
            o.classList.toggle("selected", o.contains(inp) && inp.checked));
        });
      });
    };
    // Show at least Main immediately, then fill in branches when they load.
    fill([]);
    fetch(API.url(`/api/branches?company_id=${u ? u.company_id : ""}`),
          { headers: authHeaders() })
      .then(r => r.json()).then(fill).catch(() => fill([]));

    const cleanup = () => {
      hideModal("#return-branch-modal");
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn && cancelBtn.removeEventListener("click", onCancel);
      closeBtn && closeBtn.removeEventListener("click", onCancel);
    };
    const onConfirm = () => {
      const picked = listEl.querySelector("input[name='rb-branch']:checked");
      const v = picked ? picked.value : "";
      cleanup();
      resolve({ branchId: v ? Number(v) : null });
    };
    const onCancel = () => { cleanup(); resolve(null); };
    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn && cancelBtn.addEventListener("click", onCancel);
    closeBtn && closeBtn.addEventListener("click", onCancel);
    showModal("#return-branch-modal");
  });
}

// Ask for a new (later) return date. `currentEnd` is the current YYYY-MM-DD.
// Resolves the chosen YYYY-MM-DD on confirm (guaranteed > currentEnd), or null
// on cancel. Falls back to null if the markup isn't present.
function pickExtendDate(label, currentEnd){
  return new Promise((resolve) => {
    const dateEl = $("#extend-date");
    const confirmBtn = $("#extend-confirm");
    const cancelBtn = $("#extend-cancel");
    const closeBtn = $("#extend-close");
    const errEl = $("#extend-error");
    if (!dateEl || !confirmBtn){ resolve(null); return; }
    const lab = $("#extend-carlabel");
    if (lab) lab.textContent = label || "";
    const cur = $("#extend-current");
    if (cur) cur.textContent = currentEnd
      ? `${t("extend.current")}: ${currentEnd}` : "";
    if (errEl){ errEl.hidden = true; errEl.textContent = ""; }
    // The new date must be strictly after the current end; seed the min to the
    // day after and prefill one day later as a sensible default. Parse at local
    // noon and format in local time (not toISOString/UTC, which could shift the
    // date a day in far-east/west timezones).
    const _z = n => String(n).padStart(2, "0");
    const day = (d) => {
      const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + 1);
      return `${x.getFullYear()}-${_z(x.getMonth() + 1)}-${_z(x.getDate())}`;
    };
    const minDate = currentEnd ? day(currentEnd) : "";
    if (minDate){ dateEl.min = minDate; dateEl.value = minDate; }
    else { dateEl.removeAttribute("min"); dateEl.value = ""; }
    const cleanup = () => {
      hideModal("#extend-modal");
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn && cancelBtn.removeEventListener("click", onCancel);
      closeBtn && closeBtn.removeEventListener("click", onCancel);
    };
    const onConfirm = () => {
      const v = (dateEl.value || "").trim();
      if (!v){ if (errEl){ errEl.hidden = false; errEl.textContent = t("extend.err.required"); } return; }
      if (currentEnd && v <= currentEnd){ if (errEl){ errEl.hidden = false; errEl.textContent = t("extend.err.later"); } return; }
      cleanup(); resolve(v);
    };
    const onCancel = () => { cleanup(); resolve(null); };
    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn && cancelBtn.addEventListener("click", onCancel);
    closeBtn && closeBtn.addEventListener("click", onCancel);
    showModal("#extend-modal");
  });
}

/* ============== RETURNS DUE (company-user tab) ==============
   A schedule of when each rented car must come back, derived from the same
   rental report rows (no extra endpoint). Sorted by end_date so the most
   overdue / soonest-due cars sit on top. There's no "returned" flag in the
   data, so "Current & overdue" caps how far back we look to avoid showing
   long-finished rentals forever; "All" lifts the cap. */
const Returns = (() => {
  let filter = "active";                       // "active" | "overdue" | "all"
  let _view = "calendar";                      // "calendar" | "list"
  let _calCursor = null;                       // first-of-month shown in calendar
  const ACTIVE_WINDOW_DAYS = 30;               // how far back "active" reaches
  const MAX_CHIPS = 3;                          // chips shown per calendar day

  const _z = n => String(n).padStart(2, "0");
  function _dateStr(d){ return `${d.getFullYear()}-${_z(d.getMonth() + 1)}-${_z(d.getDate())}`; }
  function _today(){ return _dateStr(new Date()); }
  function _shiftToday(days){
    const d = new Date(); d.setDate(d.getDate() + days); return _dateStr(d);
  }
  // Whole days from one YYYY-MM-DD to another (b - a). Parsed as local noon
  // to sidestep DST edge cases.
  function _dayDiff(a, b){
    const pa = new Date(a + "T12:00:00"), pb = new Date(b + "T12:00:00");
    return Math.round((pb - pa) / 86400000);
  }

  function _rows(){
    const u = AUTH.user();
    if (!u || u.role !== "company") return [];
    const today = _today();
    // Only cars still out: a returned car is back in stock, so it drops off
    // this list. (Server already scopes to this company; the company_id
    // check is a belt-and-suspenders guard.)
    let rows = (state.report || []).filter(r =>
      Number(r.company_id) === Number(u.company_id) && r.end_date && !r.returned_at);
    // A specific return date takes precedence over the status window: show
    // exactly the cars due back on that day.
    const dateVal = ($("#returns-filter-date")?.value || "").trim();
    if (dateVal){
      rows = rows.filter(r => r.end_date === dateVal);
    } else if (filter === "overdue"){
      rows = rows.filter(r => r.end_date < today);
    } else if (filter === "active"){
      const cutoff = _shiftToday(-ACTIVE_WINDOW_DAYS);
      rows = rows.filter(r => r.end_date >= cutoff);
    }
    // Soonest end date first; overdue (earlier dates) bubble to the top.
    rows.sort((a, b) => (a.end_date < b.end_date ? -1 : a.end_date > b.end_date ? 1 : 0));
    return rows;
  }

  function _statusHtml(endDate, today){
    const diff = _dayDiff(today, endDate);     // <0 past, 0 today, >0 future
    if (diff < 0)
      return `<span class="return-badge overdue">${escape(t("returns.overdue"))} · ${escape(t("returns.daysOverdue").replace("{n}", -diff))}</span>`;
    if (diff === 0)
      return `<span class="return-badge today">${escape(t("returns.dueToday"))}</span>`;
    return `<span class="return-badge upcoming">${escape(t("returns.upcoming"))} · ${escape(t("returns.daysLeft").replace("{n}", diff))}</span>`;
  }

  // All cars still out for this company (ignores the list filters) — used by
  // the KPI summary and the calendar so they always show the full picture.
  function _allRows(){
    const u = AUTH.user();
    if (!u || u.role !== "company") return [];
    return (state.report || []).filter(r =>
      Number(r.company_id) === Number(u.company_id) && r.end_date && !r.returned_at);
  }

  function _statusOf(endDate, today){
    const diff = _dayDiff(today, endDate);
    return diff < 0 ? "overdue" : diff === 0 ? "today" : "upcoming";
  }

  function renderStats(){
    const today = _today();
    const weekEnd = _shiftToday(7);
    let overdue = 0, todayC = 0, weekC = 0;
    _allRows().forEach(r => {
      if (r.end_date < today) overdue++;
      else if (r.end_date === today) todayC++;
      if (r.end_date >= today && r.end_date <= weekEnd) weekC++;
    });
    const set = (id, v) => { const e = $(`#${id}`); if (e) e.textContent = v; };
    set("ret-stat-overdue", overdue);
    set("ret-stat-today", todayC);
    set("ret-stat-week", weekC);
  }

  /* ---------- Calendar (returns plotted on their due date) ---------- */
  function _firstOfMonth(){ const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); }
  function _addDays(d, n){ return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }

  function _shiftMonth(n){
    if (!_calCursor) _calCursor = _firstOfMonth();
    _calCursor = new Date(_calCursor.getFullYear(), _calCursor.getMonth() + n, 1);
    renderCalendar();
  }

  function renderCalendar(){
    const grid = $("#returns-calendar");
    if (!grid) return;
    if (!_calCursor) _calCursor = _firstOfMonth();
    const cur = _calCursor;
    const lang = (typeof currentLang === "function") ? currentLang() : "en";

    const titleEl = $("#returns-cal-title");
    if (titleEl) titleEl.textContent = new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }).format(cur);
    const wd = $("#returns-cal-weekdays");
    if (wd){
      const fmt = new Intl.DateTimeFormat(lang, { weekday: "short" });
      let h = "";
      for (let i = 0; i < 7; i++) h += `<div class="cal-weekday">${escape(fmt.format(new Date(2024, 8, 1 + i)))}</div>`;
      wd.innerHTML = h;
    }

    // Group returns by their due date.
    const today = _today();
    const byDate = {};
    _allRows().forEach(r => { (byDate[r.end_date] || (byDate[r.end_date] = [])).push(r); });

    const first = new Date(cur.getFullYear(), cur.getMonth(), 1);
    const gridStart = _addDays(first, -first.getDay());
    const last = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    const gridEnd = _addDays(last, 6 - last.getDay());
    const weeks = Math.round((gridEnd - gridStart) / 86400000 + 1) / 7;

    let html = "";
    for (let w = 0; w < weeks; w++){
      const weekStart = _addDays(gridStart, w * 7);
      let lanes = 1;
      let daysHtml = "";
      for (let i = 0; i < 7; i++){
        const d = _addDays(weekStart, i);
        const ymd = _dateStr(d);
        const inMonth = d.getMonth() === cur.getMonth();
        const isToday = ymd === today;
        const list = byDate[ymd] || [];
        const used = Math.min(list.length, MAX_CHIPS) + (list.length > MAX_CHIPS ? 1 : 0);
        if (used > lanes) lanes = used;
        let chips = "";
        list.slice(0, MAX_CHIPS).forEach(r => {
          const st = _statusOf(r.end_date, today);
          const label = `${r.car_plate || r.car_model || ""}${r.client_name ? " · " + r.client_name : ""}`;
          chips += `<button type="button" class="ret-chip ${st}" data-ret-id="${r.rental_id}" title="${escape(label)}">${escape(label)}</button>`;
        });
        if (list.length > MAX_CHIPS){
          chips += `<button type="button" class="ret-more" data-ret-date="${ymd}">+${list.length - MAX_CHIPS}</button>`;
        }
        daysHtml += `<div class="cal-day${inMonth ? "" : " other-month"}${isToday ? " today" : ""}">` +
          `<span class="cal-daynum">${d.getDate()}</span>` +
          (chips ? `<div class="cal-day-events">${chips}</div>` : "") +
          `</div>`;
      }
      html += `<div class="cal-week" style="--lanes:${lanes}"><div class="cal-week-grid">${daysHtml}</div></div>`;
    }
    grid.innerHTML = html;

    grid.querySelectorAll(".ret-chip").forEach(chip => {
      chip.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const row = _allRows().find(r => String(r.rental_id) === chip.dataset.retId);
        if (row) _openRetPop(row, chip);
      });
    });
    grid.querySelectorAll(".ret-more").forEach(btn => {
      btn.addEventListener("click", () => {
        // Jump to the list, filtered to that exact day.
        const dateEl = $("#returns-filter-date");
        if (dateEl) dateEl.value = btn.dataset.retDate;
        _setView("list");
      });
    });
  }

  function _closeRetPop(){
    const p = $("#returns-event-pop");
    if (p){ p.hidden = true; p.innerHTML = ""; }
    document.removeEventListener("mousedown", _onRetDoc, true);
    document.removeEventListener("keydown", _onRetKey, true);
  }
  function _onRetDoc(e){ const p = $("#returns-event-pop"); if (p && !p.contains(e.target)) _closeRetPop(); }
  function _onRetKey(e){ if (e.key === "Escape") _closeRetPop(); }

  function _openRetPop(row, anchor){
    const p = $("#returns-event-pop");
    if (!p || !row) return;
    const today = _today();
    const badge = _statusHtml(row.end_date, today);
    const phone = row.client_phone
      ? `<a href="tel:${escape(row.client_phone)}">${escape(row.client_phone)}</a>` : "—";
    p.innerHTML = `
      <div class="rv-pop-head">
        <h4 class="rv-pop-title">${escape(row.client_name || "")}</h4>
        <button type="button" class="rv-pop-close" aria-label="Close">&times;</button>
      </div>
      <div class="rv-pop-row"><span class="rv-pop-ico">🚗</span><span>${escape(row.car_model || "")}${row.car_plate ? " — " + escape(row.car_plate) : ""}</span></div>
      <div class="rv-pop-row"><span class="rv-pop-ico">📅</span><span>${escape(t("returns.returnDate"))}: ${escape(row.end_date || "")}</span></div>
      <div class="rv-pop-row"><span class="rv-pop-ico">📞</span><span>${phone}</span></div>
      <div class="rv-pop-row"><span class="rv-pop-ico">●</span><span>${badge}</span></div>
      <div class="rv-pop-actions">
        <button type="button" class="rv-action-btn" data-ret-open>${escape(t("action.open"))}</button>
        <button type="button" class="rv-action-btn" data-ret-extend>${escape(t("extend.action"))}</button>
        <button type="button" class="rv-action-btn activate" data-ret-return>${escape(t("returns.backToOffice"))}</button>
      </div>`;
    p.hidden = false;
    const r = anchor.getBoundingClientRect();
    const pw = p.offsetWidth, ph = p.offsetHeight;
    let left = r.left, top = r.bottom + 6;
    if (left + pw > window.innerWidth - 12) left = window.innerWidth - pw - 12;
    if (left < 12) left = 12;
    if (top + ph > window.innerHeight - 12) top = r.top - ph - 6;
    if (top < 12) top = 12;
    p.style.left = left + "px";
    p.style.top = top + "px";
    p.querySelector(".rv-pop-close")?.addEventListener("click", _closeRetPop);
    p.querySelector("[data-ret-open]")?.addEventListener("click", () => { _closeRetPop(); Detail.open(row); });
    p.querySelector("[data-ret-extend]")?.addEventListener("click", () => { _closeRetPop(); _extend(row); });
    p.querySelector("[data-ret-return]")?.addEventListener("click", () => { _closeRetPop(); _markReturned(row); });
    setTimeout(() => {
      document.addEventListener("mousedown", _onRetDoc, true);
      document.addEventListener("keydown", _onRetKey, true);
    }, 0);
  }

  function _setView(v){
    _view = v;
    $$(".returns-view-btn").forEach(b => b.classList.toggle("active", b.dataset.rview === v));
    render();
  }

  function render(){
    renderStats();
    const calView  = $("#returns-calendar-view");
    const listView = $("#returns-list-view");
    if (calView)  calView.hidden  = (_view !== "calendar");
    if (listView) listView.hidden = (_view !== "list");
    if (_view === "calendar") renderCalendar();
    else renderList();
  }

  function renderList(){
    const tbl = $("#tbl-returns");
    if (!tbl) return;
    const rows = _rows();
    if (!rows.length){
      const pt = $("#pager-top-returns"); if (pt) pt.hidden = true;
      const pb = $("#pager-returns");     if (pb) pb.hidden = true;
      return emptyRow(tbl, 8);
    }
    const today = _today();
    const info = Pager.slice("returns", rows);
    tbl.tBodies[0].innerHTML = info.rows.map((r, i) => {
      const idx = (info.page - 1) * info.size + i;
      return `
      <tr data-row="${idx}" class="returns-row">
        <td data-label="#">${idx + 1}</td>
        <td data-label="${escape(t("report.client"))}"><strong>${escape(r.client_name)}</strong></td>
        <td data-label="${escape(t("report.phone"))}">${escape(r.client_phone)}</td>
        <td data-label="${escape(t("report.car"))}">${escape(r.car_model)} <span style="color:#94a3b8">(${escape(r.car_type)})</span></td>
        <td data-label="${escape(t("report.plate"))}">${escape(r.car_plate)}</td>
        <td data-label="${escape(t("returns.returnDate"))}">${escape(r.end_date)}</td>
        <td data-label="${escape(t("returns.status"))}">${_statusHtml(r.end_date, today)}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="row-btn pdf" data-detail="${idx}">${escape(t("action.open"))}</button>
            <button type="button" class="row-btn extend-btn" data-extend="${idx}">${escape(t("extend.action"))}</button>
            <button type="button" class="row-btn return-btn" data-return="${idx}">${escape(t("returns.backToOffice"))}</button>
          </div>
        </td>
      </tr>`;
    }).join("");
    $$("tr.returns-row", tbl).forEach(tr => {
      tr.addEventListener("click", (e) => {
        // Let the row's own action buttons run their handlers.
        if (e.target.closest(".return-btn") || e.target.closest(".extend-btn")) return;
        Detail.open(rows[Number(tr.dataset.row)]);
      });
    });
    $$(".return-btn", tbl).forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        _markReturned(rows[Number(btn.dataset.return)]);
      });
    });
    $$(".extend-btn", tbl).forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        _extend(rows[Number(btn.dataset.extend)]);
      });
    });
    Pager.render("returns", "#pager-top-returns", "#pager-returns", info, render);
  }

  async function _markReturned(row){
    if (!row || !row.rental_id) return;
    const label = carLabel(row) || row.car_plate || row.car_vin || "";
    const pick = await pickReturnBranch(label);
    if (pick === null) return;   // cancelled
    try {
      const r = await fetch(API.url(`/api/rentals/${row.rental_id}/return`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ return_branch_id: pick.branchId }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok){
        toast(data.error || t("toast.error"), "error");
        return;
      }
      toast(t("returns.returned"), "success");
      await refresh();
      if (typeof Notifications !== "undefined") Notifications.refresh();
      if (typeof ReturnDue !== "undefined") ReturnDue.render();
    } catch (err){
      toast(err.message || t("toast.error"), "error");
    }
  }

  // Client keeps the car longer: pick a later return date, push end_date out.
  async function _extend(row){
    if (!row || !row.rental_id) return;
    const label = carLabel(row) || row.car_plate || row.car_vin || "";
    const newEnd = await pickExtendDate(label, row.end_date);
    if (newEnd === null) return;   // cancelled
    try {
      const r = await fetch(API.url(`/api/rentals/${row.rental_id}/extend`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ end_date: newEnd }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok){ toast(data.error || t("toast.error"), "error"); return; }
      toast(t("extend.done"), "success");
      await refresh();
      if (typeof Notifications !== "undefined") Notifications.refresh();
    } catch (err){
      toast(err.message || t("toast.error"), "error");
    }
  }

  // Pull fresh report rows, then render. Used when the tab is opened.
  async function refresh(){
    try { state.report = await API.report(); } catch (e){}
    render();
  }

  function setup(){
    const BTNS = ["returns-filter-active", "returns-filter-overdue", "returns-filter-all"];
    const setFilter = (f, activeId) => {
      filter = f;
      // Switching status window clears any specific-date filter.
      const dateEl = $("#returns-filter-date"); if (dateEl) dateEl.value = "";
      BTNS.forEach(id => {
        const b = $(`#${id}`);
        if (!b) return;
        b.classList.toggle("btn-primary", id === activeId);
        b.classList.toggle("btn-ghost-dark", id !== activeId);
      });
      Pager.reset("returns");
      render();
    };
    $("#returns-filter-active") ?.addEventListener("click", () => setFilter("active",  "returns-filter-active"));
    $("#returns-filter-overdue")?.addEventListener("click", () => setFilter("overdue", "returns-filter-overdue"));
    $("#returns-filter-all")    ?.addEventListener("click", () => setFilter("all",     "returns-filter-all"));
    // Filter by a specific return date.
    $("#returns-filter-date")?.addEventListener("change", () => { Pager.reset("returns"); render(); });

    // Calendar / List view toggle.
    $$(".returns-view-btn").forEach(btn => {
      btn.addEventListener("click", () => _setView(btn.dataset.rview || "calendar"));
    });
    // Calendar month navigation.
    $("#returns-cal-prev")?.addEventListener("click", () => _shiftMonth(-1));
    $("#returns-cal-next")?.addEventListener("click", () => _shiftMonth(1));
    $("#returns-cal-today")?.addEventListener("click", () => { _calCursor = _firstOfMonth(); renderCalendar(); });
  }

  return { render, refresh, setup };
})();

/* ============== RETURN DUE (company-home widget) ==============
   A compact, professional card on the company dashboard that lists the owner's
   OWN cars due back soon — overdue, today, tomorrow ("In 1 day") and the next
   couple of weeks — each with a one-tap "Back to office" that opens the branch
   picker so the returned car is placed at a branch. Reads the same rental
   report the Returns tab uses. The login alert (Notifications) still fires for
   cars due today; this is the always-on working view on the home screen. */
const ReturnDue = (() => {
  const WINDOW_DAYS = 14;   // how far ahead "upcoming" reaches
  const MAX_ROWS = 6;       // rows shown before the "+N more" link
  const _z = n => String(n).padStart(2, "0");
  function _fmt(d){ return `${d.getFullYear()}-${_z(d.getMonth() + 1)}-${_z(d.getDate())}`; }
  function _today(){ return _fmt(new Date()); }
  function _shift(days){ const d = new Date(); d.setDate(d.getDate() + days); return _fmt(d); }
  // Whole days from a→b (parsed at local noon to dodge DST edges).
  function _diff(a, b){
    const pa = new Date(a + "T12:00:00"), pb = new Date(b + "T12:00:00");
    return Math.round((pb - pa) / 86400000);
  }
  // Relative label: overdue / today / in 1 day / in N days.
  function _rel(diff){
    if (diff < 0)  return { cls: "overdue", text: (-diff === 1) ? t("returnDue.rel.overdue") : t("returnDue.rel.overdueN").replace("{n}", -diff) };
    if (diff === 0) return { cls: "today",   text: t("returnDue.rel.today") };
    if (diff === 1) return { cls: "soon",    text: t("returnDue.rel.tomorrow") };
    return { cls: "upcoming", text: t("returnDue.rel.inDays").replace("{n}", diff) };
  }

  function _rows(){
    const u = AUTH.user();
    if (!u || u.role !== "company") return [];
    const horizon = _shift(WINDOW_DAYS);
    // Own cars still out (not returned) due within the window; overdue included
    // (end_date can be < today). Soonest / most-overdue first.
    return (state.report || [])
      .filter(r => Number(r.company_id) === Number(u.company_id) &&
                   r.end_date && !r.returned_at && r.end_date <= horizon)
      .sort((a, b) => (a.end_date < b.end_date ? -1 : a.end_date > b.end_date ? 1 : 0));
  }

  function render(){
    const card = $("#return-due-card"), list = $("#return-due-list");
    if (!card || !list) return;
    const u = AUTH.user();
    const rows = (!u || u.role !== "company") ? [] : _rows();
    if (!rows.length){ card.hidden = true; list.innerHTML = ""; return; }
    card.hidden = false;
    const today = _today();
    const shown = rows.slice(0, MAX_ROWS);
    list.innerHTML = shown.map(r => {
      const rel = _rel(_diff(today, r.end_date));
      const car = escape(carLabel(r) || r.car_plate || r.car_vin || "");
      const who = escape(r.client_name || "");
      const meta = [who, r.end_date].filter(Boolean).map(escape).join(" · ");
      return `<li class="rd-item ${rel.cls}">
        <span class="rd-item-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11"/><path d="M3 11h18v5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><circle cx="7" cy="14" r="1"/><circle cx="17" cy="14" r="1"/></svg></span>
        <div class="rd-item-main">
          <span class="rd-item-car">${car}</span>
          <span class="rd-item-who">${meta}</span>
        </div>
        <span class="rd-rel ${rel.cls}">${escape(rel.text)}</span>
        <button type="button" class="rd-return-btn" data-rd-id="${r.rental_id}">${escape(t("returns.backToOffice"))}</button>
      </li>`;
    }).join("") + (rows.length > MAX_ROWS
      ? `<li class="rd-more"><button type="button" data-cgo="company-returns">+${rows.length - MAX_ROWS} ${escape(t("returnDue.more"))}</button></li>`
      : "");

    list.querySelectorAll(".rd-return-btn").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const row = rows.find(r => String(r.rental_id) === btn.dataset.rdId);
        if (row) await _return(row);
      });
    });
    list.querySelectorAll("[data-cgo]").forEach(btn => {
      btn.addEventListener("click", () => { if (window.showCompanyPanel) showCompanyPanel(btn.dataset.cgo); });
    });
  }

  async function _return(row){
    if (!row || !row.rental_id) return;
    const label = carLabel(row) || row.car_plate || row.car_vin || "";
    const pick = await pickReturnBranch(label);
    if (pick === null) return;   // cancelled
    try {
      const r = await fetch(API.url(`/api/rentals/${row.rental_id}/return`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ return_branch_id: pick.branchId }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok){ toast(data.error || t("toast.error"), "error"); return; }
      toast(t("returns.returned"), "success");
      await refresh();
      if (typeof Notifications !== "undefined") Notifications.refresh();
      if (typeof Returns !== "undefined") Returns.render();
    } catch (err){ toast(err.message || t("toast.error"), "error"); }
  }

  // Pull fresh report rows, then render.
  async function refresh(){
    try { state.report = await API.report(); } catch (e){}
    render();
  }

  return { render, refresh };
})();

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
    // The preview looks up the picked car in state.cars; the fleet tree no
    // longer fills it, so stash this company's cars here for the lookup.
    state.cars = Array.isArray(cars) ? cars : [];
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
  // Sync the "this is my head office" checkbox with the branch state.
  refreshCompanyHeadOffice();
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
      // Ticked = this main location is the head office (demotes any branch).
      is_head_office: !!$("#company-head-check")?.checked,
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
      refreshCompanyHeadOffice();
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
// Existing DB branches of the current company, cached while branch forms are
// open. Drives the head-office control: with existing branches present the user
// picks from a dropdown; with none, a single open form is head office
// automatically and several open forms let the user tick which one is head.
let _branchExisting = [];

async function _loadBranchExisting(companyId){
  try {
    const d = await fetch(API.url(`/api/branches?company_id=${companyId}`),
                          { headers: authHeaders() }).then(r => r.json());
    _branchExisting = Array.isArray(d) ? d : [];
  } catch (e){ _branchExisting = []; }
  return _branchExisting;
}

// (Re)build the main-office control of every open branch form — called whenever
// a form is added, removed, or saved. Every form shows a "main office" toggle
// card; ticking one unticks the others so the company only ever has ONE main
// office. The hint under the card explains the current situation:
//   • company already has a main office   → no hint (ticking here moves it)
//   • no main office yet, one open form    → this branch will be the main office
//   • no main office yet, several forms    → tick which of them is the main office
function refreshBranchHeadControls(){
  const list = $("#branch-forms-list");
  if (!list) return;
  const forms = $$(".branch-inline-form", list);
  // The company's MAIN location (the company-info form) is the default head
  // office. Each branch form shows an UNticked head-office checkbox; ticking one
  // promotes that branch to head office (demoting the main office / other
  // branches). Only one branch may be ticked at a time (enforced below + alert).
  forms.forEach((form) => {
    const wrap = form.querySelector('[data-role="branch-head-wrap"]');
    const hint = form.querySelector('[data-role="branch-head-hint"]');
    if (!wrap) return;
    wrap.hidden = false;                       // head-office card is always shown
    if (hint){
      hint.textContent = t("companyInfo.branch.headOffice.branchHint");
      hint.classList.add("branch-head-note");
    }
  });

  // Safety net: if two or more branch forms are somehow ticked, keep the first
  // and clear the rest so at most one branch is ever the head office.
  const checks = forms.map(f => f.querySelector('[data-role="branch-head-check"]'))
                      .filter(Boolean);
  const ticked = checks.filter(c => c.checked);
  if (ticked.length > 1) ticked.slice(1).forEach(c => { c.checked = false; });
}

// Reflect the head-office state on the company-info form's checkbox. The MAIN
// office is the company's earliest branch; the checkbox is ticked when that main
// office is the head office (or the company has no branch yet). Unticked means a
// specific later branch currently holds the head office. Called on load, when the
// branch section opens, and after any branch is saved/deleted.
async function refreshCompanyHeadOffice(){
  const u = AUTH.user();
  const cb = $("#company-head-check");
  if (!u || u.role !== "company" || !u.company_id || !cb) return;
  try {
    const bs = await _loadBranchExisting(u.company_id);
    if (!bs.length){ cb.checked = true; return; }   // no branch yet → main is head
    const head = bs.find(b => b.is_head_office);
    const earliestId = Math.min(...bs.map(b => Number(b.id)));
    cb.checked = !head || Number(head.id) === earliestId;
  } catch (e){ cb.checked = true; }
}
window.refreshCompanyHeadOffice = refreshCompanyHeadOffice;

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

  // Load the company's existing branches, then (re)build the head-office control
  // of every open form so opening a second form flips the first one from "auto
  // head office" to the "tick which one" state.
  _loadBranchExisting(u.company_id).then(refreshBranchHeadControls);

  form.querySelector(".branch-close-btn")?.addEventListener("click", () => {
    form.remove();
    refreshBranchHeadControls();
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
    // Every branch field is required: address, at least one phone number, and a
    // picked map location. Block the save and point out what's missing.
    const hasMap = fd.get("x") !== "" && fd.get("y") !== "" &&
                   fd.get("x") !== null && fd.get("y") !== null;
    if (!body.location || !phones || !hasMap){
      showBranchStatus(t("companyInfo.branch.allRequired"));
      toast(t("companyInfo.branch.allRequired"), "error");
      return;
    }

    // The head-office checkbox on this form is the single source of truth: when
    // ticked, this branch becomes the company's head office on save.
    const headCheck = form.querySelector('[data-role="branch-head-check"]');
    if (headCheck && headCheck.checked) body.is_head_office = true;

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
      // A branch now exists — refresh remaining open forms and re-sync the
      // company form's head-office checkbox (a branch may now hold the head office).
      _loadBranchExisting(usr.company_id).then(() => {
        refreshBranchHeadControls();
        refreshCompanyHeadOffice();
      });
      if (typeof refreshBranches === "function") refreshBranches();
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

// Manufacturer prefixes used to group the model picker into tidy, branded
// sections. Longest-match wins so "Range Rover Sport" groups under "Range
// Rover", not "Range".
const CAR_MAKES = [
  "Mercedes", "BMW", "Audi", "Toyota", "Honda", "Tesla", "Hyundai", "Kia",
  "Nissan", "Ford", "Chevrolet", "Volkswagen", "Lexus", "Range Rover",
  "Porsche", "Mazda", "Mitsubishi", "Subaru", "Jeep", "Dodge", "Renault",
  "Peugeot", "Suzuki", "Ferrari", "Lamborghini", "Yamaha", "Kawasaki",
  "Ducati", "Harley-Davidson",
];

/* The manufacturer a model belongs to (longest matching prefix). */
function _makeOf(model){
  let best = "";
  for (const mk of CAR_MAKES){
    if ((model === mk || model.startsWith(mk + " ")) && mk.length > best.length) best = mk;
  }
  return best || (model.split(" ")[0] || "Other");
}

/* Fill the car-model <select> grouped by manufacturer via <optgroup>, so the
   picker reads as a clean, branded list. Keeps the placeholder + re-syncs. */
function fillModelSelect(selectEl){
  if (!selectEl) return;
  const cur = selectEl.value;
  const placeholder = selectEl.querySelector('option[disabled][hidden]')?.outerHTML || "";
  const groups = [];
  const index = Object.create(null);
  CAR_MODELS.forEach(m => {
    const mk = _makeOf(m);
    if (!(mk in index)){ index[mk] = groups.length; groups.push({ make: mk, models: [] }); }
    groups[index[mk]].models.push(m);
  });
  selectEl.innerHTML = placeholder + groups.map(g =>
    `<optgroup label="${escape(g.make)}">`
    + g.models.map(v => `<option value="${escape(v)}">${escape(v)}</option>`).join("")
    + `</optgroup>`
  ).join("");
  if (cur) selectEl.value = cur;
  if (selectEl._ss) selectEl._ss.sync();
}

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

  // Edit-mode state: when set, Save updates this car (VIN locked) instead of
  // creating a new one. `_myCars` caches the tab's own table rows so the Edit
  // button can find the full record by id.
  let editingCarId = null;
  let _myCars = [];

  // Fill the static dropdowns up-front. Plates are a company pool now (managed
  // in the Plates tab), so the car form no longer has any plate field.
  fillStaticSelect($("#add-car-type"),  CAR_TYPES);
  fillModelSelect($("#add-car-model"));
  fillStaticSelect($("#add-car-color"), CAR_COLORS);

  // The "based at" branch dropdown = this company's own branches, plus a
  // leading "Main (head office)" option (value "") for cars not tied to a
  // branch. Fetched WITH auth so the backend scopes it to the user's company
  // (API.listBranches sends no header and would return every company's).
  async function loadFormBranches(){
    const sel = $("#add-car-branch");
    if (!sel) return;
    const u = AUTH.user();
    if (!u || u.role !== "company" || !u.company_id) return;
    let branches = [];
    try {
      branches = await fetch(API.url(`/api/branches?company_id=${u.company_id}`),
                             { headers: authHeaders() }).then(r => r.json());
    } catch (e){ branches = []; }
    const main = `<option value="">${escape(t("cars.branch.main"))}</option>`;
    sel.innerHTML = main + (Array.isArray(branches) ? branches : [])
      .map(b => `<option value="${b.id}">${escape(b.branchname)}</option>`).join("");
    if (sel._ss) sel._ss.sync();
  }
  loadFormBranches();
  window.refreshAddCarBranches = loadFormBranches;

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
      // Searchable dropdown: label leads with the model so typing the first
      // 3+ letters of the model filters (SearchSelect prefix mode). The VIN
      // is appended so it's visible when picking.
      const vinSelect = $("#add-car-vin-select");
      if (vinSelect){
        const ph = vinSelect.querySelector('option[disabled][hidden]')?.outerHTML || "";
        vinSelect.innerHTML = ph + list.map(v =>
          `<option value="${escape(v.vin)}">${escape(`${v.model} · ${v.type} · ${v.color} — ${v.vin}`)}</option>`
        ).join("");
        vinSelect.value = "";
        if (vinSelect._ss) vinSelect._ss.sync();
      }
      list.forEach(v => { knownVinsByVin[v.vin.toUpperCase()] = v; });
    } catch (e){
      // Soft-fail — the form still works without the registry.
    }
  }
  loadKnownVins();

  // VIN input has four mutually-exclusive modes:
  //   picker → searchable dropdown of known VINs (default)
  //   full   → raw 17-char input for a VIN not in the list
  //   split  → known prefix (locked) + serial (6 chars, editable)
  //   locked → read-only VIN badge (while editing an existing car)
  const vinPickerMode = $("#vin-picker-mode");
  const vinFullMode  = $("#vin-full-mode");
  const vinSplitMode = $("#vin-split-mode");
  const vinLockedMode = $("#vin-locked-mode");
  const vinSelect    = $("#add-car-vin-select");
  const vinPrefixBadge = $("#vin-prefix-badge");
  const vinLockedBadge = $("#vin-locked-badge");
  const vinSerialInput = $("#vin-serial-input");
  const vinEditFullBtn = $("#vin-edit-full-btn");
  const vinCustomBtn   = $("#vin-custom-btn");
  const vinBackListBtn = $("#vin-back-list-btn");
  let _vinPrefix = "";
  let _vinOrigSerial = "";   // last 6 of the picked VIN, shown as a shadow

  function showVinMode(mode){
    if (vinPickerMode) vinPickerMode.hidden = mode !== "picker";
    if (vinFullMode)   vinFullMode.hidden   = mode !== "full";
    if (vinSplitMode)  vinSplitMode.hidden  = mode !== "split";
    if (vinLockedMode) vinLockedMode.hidden = mode !== "locked";
  }

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
    showVinMode("split");
    setTimeout(() => vinSerialInput?.focus(), 50);
  }

  // The effective serial: what the user typed, or — if they left it blank —
  // the original shadow value of the selected VIN.
  function _currentSerial(){
    const typed = (vinSerialInput?.value || "").toUpperCase();
    return typed || _vinOrigSerial;
  }

  // "✎ Change VIN" from split mode: abandon the current pick and return to
  // the searchable dropdown so the user can choose a different VIN.
  function exitSplitMode(){
    _vinPrefix = "";
    _vinOrigSerial = "";
    const vinInput2 = form.querySelector('input[name="vin"]');
    if (vinInput2) vinInput2.value = "";
    if (vinSelect){ vinSelect.value = ""; if (vinSelect._ss) vinSelect._ss.sync(); }
    lastVinSeen = "";
    showVinMode("picker");
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
    if (typeSel)  { typeSel.value  = c.type  || ""; if (typeSel._ss)  typeSel._ss.sync(); }
    if (modelSel) { modelSel.value = c.model || ""; if (modelSel._ss) modelSel._ss.sync(); }
    if (colorSel) { colorSel.value = c.color || ""; if (colorSel._ss) colorSel._ss.sync(); }

    const gpsCb = $("#add-car-gps");
    if (gpsCb) gpsCb.checked = !!c.has_gps;

    const branchSel = $("#add-car-branch");
    if (branchSel){
      branchSel.value = c.branch_id == null ? "" : String(c.branch_id);
      if (branchSel._ss) branchSel._ss.sync();
    }

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
        $("#add-car-color"),
      ].forEach(sel => {
        if (!sel) return;
        sel.value = "";
        if (sel._ss) sel._ss.sync();
      });
      if (vinHint){ vinHint.hidden = true; vinHint.textContent = ""; }
      clearAllFieldErrors(form);
      lastVinSeen = "";
      _vinPrefix = "";
      if (vinInput) vinInput.value = "";
      if (vinSerialInput) vinSerialInput.value = "";
      if (vinSelect){ vinSelect.value = ""; if (vinSelect._ss) vinSelect._ss.sync(); }
      // Only drop back to the picker when NOT mid-edit — exitCarEditMode owns
      // the VIN mode while an existing car is being corrected.
      if (editingCarId == null) showVinMode("picker");
    }, 0);
  });

  // Picking a value from the datalist triggers `input`. The native blur
  // event also fires once the user tabs away after typing manually.
  vinInput.addEventListener("input",  decodeCurrentVin);
  vinInput.addEventListener("blur",   decodeCurrentVin);
  vinInput.addEventListener("change", decodeCurrentVin);

  // ---- VIN mode toggles ----
  // Picking a VIN from the searchable dropdown: mirror it into the hidden
  // vin input (so required-field validation sees it) and drop into split
  // mode so the user edits just the serial number.
  if (vinSelect){
    vinSelect.addEventListener("change", () => {
      const vin = (vinSelect.value || "").toUpperCase();
      if (!vin) return;
      if (vinInput) vinInput.value = vin;
      setFieldError(form, "vin", "");
      const known = knownVinsByVin[vin];
      if (known) autoFillFromKnown(known);
      else enterSplitMode(vin);
    });
  }
  if (vinCustomBtn){
    vinCustomBtn.addEventListener("click", () => {
      if (vinSelect){ vinSelect.value = ""; if (vinSelect._ss) vinSelect._ss.sync(); }
      if (vinInput) vinInput.value = "";
      showVinMode("full");
      setTimeout(() => vinInput?.focus(), 50);
    });
  }
  if (vinBackListBtn){
    vinBackListBtn.addEventListener("click", () => {
      if (vinInput) vinInput.value = "";
      lastVinSeen = "";
      if (vinHint){ vinHint.hidden = true; vinHint.textContent = ""; }
      setFieldError(form, "vin", "");
      showVinMode("picker");
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAllFieldErrors(form);
    const u = AUTH.user();
    if (!u || u.role !== "company" || !u.company_id){
      toast(t("toast.error"), "error");
      return;
    }

    const editing = editingCarId != null;

    // The VIN is only validated when creating — in edit mode it's locked and
    // never sent (the backend ignores it), so skip the VIN checks entirely.
    // The car carries no plate: plates are a company pool (the Plates tab).
    const requiredFields = editing
      ? ["type", "model", "color"]
      : ["vin", "type", "model", "color"];
    if (!validateRequiredFields(form, requiredFields)){
      toast(t("toast.fillAll"), "error");
      return;
    }

    const fd       = new FormData(form);
    const vin      = (getSplitVin() || (fd.get("vin") || "").toString().trim()).toUpperCase();

    if (!editing && vin.length !== 17){
      setFieldError(form, "vin", t("addCar.vinLength"));
      toast(t("addCar.vinLength"), "error");
      return;
    }
    const type     = (fd.get("type")         || "").toString().trim();
    const model    = (fd.get("model")        || "").toString().trim();
    const color    = (fd.get("color")        || "").toString().trim();
    const has_gps  = fd.get("has_gps") === "on";
    // "" (Main) → null; the backend re-validates it belongs to this company.
    const branch_id = (fd.get("branch_id") || "").toString().trim() || null;

    try {
      const body = editing
        ? { type, model, color, company_id: u.company_id, has_gps, branch_id }
        : { vin, type, model, color, company_id: u.company_id, has_gps, branch_id };
      const r = await fetch(
        editing ? API.url(`/api/cars/${editingCarId}`) : API.url("/api/cars"),
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(body),
        });
      const data = await r.json().catch(() => ({}));
      if (!r.ok){
        // Server-side validation: paint each error on its corresponding field.
        // The cross-company VIN clash comes back as errors.vin — surface it
        // prominently so the user knows the VIN belongs to another company.
        if (data.errors && typeof data.errors === "object"){
          Object.entries(data.errors).forEach(([k, v]) => setFieldError(form, k, v));
          if (data.errors.vin) showAddCarStatus(data.errors.vin);
          toast(data.errors.vin || data.error || t("toast.error"), "error");
        } else {
          if (data.error) showAddCarStatus(data.error);
          toast(data.error || t("toast.error"), "error");
        }
        return;
      }
      // Success: clear everything for the next car, keep no field state behind.
      // form.reset() also wipes the plate chips (its reset handler).
      exitCarEditMode();
      form.reset();
      [$("#add-car-type"), $("#add-car-model"), $("#add-car-color")].forEach(sel => {
        if (!sel) return;
        sel.value = "";
        if (sel._ss) sel._ss.sync();
      });
      // Branch resets to Main (its first option), not an empty placeholder.
      const branchSel = $("#add-car-branch");
      if (branchSel){ branchSel.value = ""; if (branchSel._ss) branchSel._ss.sync(); }
      const vinHintEl = $("#add-car-vin-hint");
      if (vinHintEl){ vinHintEl.hidden = true; vinHintEl.textContent = ""; }
      lastVinSeen = "";
      // Saved — drop the modal so the fleet table behind it is what you see.
      // The toast carries the confirmation; the in-modal banner would be hidden.
      hideModal("#add-car-modal");
      toast(editing ? t("toast.saved") : t("toast.added"), "success");
      // Refresh this tab's own table and the create-rental / create-reservation
      // Car dropdowns so the new/edited entry shows without a page refresh.
      await refreshMyCarsTable();
      refreshRentalPickers();
      if (typeof CarsHub !== "undefined") CarsHub.show("fleet");
    } catch (err){
      toast(err.message || t("toast.error"), "error");
    }
  });

  // ---- Edit-an-existing-car (typo correction, unlimited, VIN locked) ----
  const carSubmitBtn = $("#add-car-submit");
  const carCancelBtn = $("#add-car-cancel-edit");

  function enterCarEditMode(c){
    editingCarId = c.id;
    autoFillFromExistingCar(c);        // fills type/model/color/icon/plate/gps
    // Lock the VIN — it's the car's identity and can't change.
    if (vinLockedBadge) vinLockedBadge.textContent = c.vin || "";
    const vinInput2 = form.querySelector('input[name="vin"]');
    if (vinInput2) vinInput2.value = c.vin || "";
    showVinMode("locked");
    if (carSubmitBtn){
      carSubmitBtn.removeAttribute("data-i18n");
      carSubmitBtn.textContent = t("addCar.update");
    }
    if (carCancelBtn) carCancelBtn.hidden = false;
    form.classList.add("car-editing");
    // The form lives in a modal now — retitle it and bring it up rather than
    // scrolling to a panel that isn't on the page.
    const ttl = $("#add-car-modal-title");
    if (ttl){ ttl.removeAttribute("data-i18n"); ttl.textContent = t("addCar.editTitle"); }
    showModal("#add-car-modal");
    showAddCarStatus(t("addCar.editingNow").replace("{plate}", c.platenumber || c.vin || ""));
  }

  function exitCarEditMode(){
    if (editingCarId == null) return;
    editingCarId = null;
    if (carSubmitBtn){
      carSubmitBtn.setAttribute("data-i18n", "addCar.action");
      carSubmitBtn.textContent = t("addCar.action");
    }
    const ttl = $("#add-car-modal-title");
    if (ttl){ ttl.setAttribute("data-i18n", "addCar.title"); ttl.textContent = t("addCar.title"); }
    if (carCancelBtn) carCancelBtn.hidden = true;
    form.classList.remove("car-editing");
    const vinInput2 = form.querySelector('input[name="vin"]');
    if (vinInput2) vinInput2.value = "";
    if (vinSelect){ vinSelect.value = ""; if (vinSelect._ss) vinSelect._ss.sync(); }
    showVinMode("picker");
  }

  if (carCancelBtn){
    carCancelBtn.addEventListener("click", () => {
      exitCarEditMode();
      form.reset();
      showAddCarStatus._t && clearTimeout(showAddCarStatus._t);
      hideModal("#add-car-modal");
    });
  }

  // Opening a blank Add-Car modal: always start from a clean, non-edit form so
  // a half-finished edit never leaks into the next car you add.
  window.openAddCarModal = () => {
    exitCarEditMode();
    form.reset();
    clearAllFieldErrors(form);
    [$("#add-car-type"), $("#add-car-model"), $("#add-car-color"), $("#add-car-branch")].forEach(sel => {
      if (!sel) return;
      sel.value = "";
      if (sel._ss) sel._ss.sync();
    });
    showAddCarStatus._t && clearTimeout(showAddCarStatus._t);
    const st = $("#add-car-status"); if (st){ st.hidden = true; st.textContent = ""; }
    showVinMode("picker");
    loadFormBranches();
    showModal("#add-car-modal");
  };

  async function refreshMyCarsTable(){
    const tb = $("#my-cars-rows");
    if (!tb) return;
    const u = AUTH.user();
    if (!u || u.role !== "company"){ _myCars = []; tb.innerHTML = ""; return; }
    let cars = [];
    try {
      cars = await fetch(API.url(`/api/cars?company_id=${u.company_id}`), { headers: authHeaders() }).then(r => r.json());
    } catch (e){ cars = []; }
    _myCars = Array.isArray(cars) ? cars : [];
    if (!_myCars.length){
      tb.innerHTML = `<tr><td colspan="8" class="empty-cell">${escape(t("addCar.noCars"))}</td></tr>`;
      return;
    }
    const dash = `<span class="badge no">—</span>`;
    const cell = (v) => v ? escape(v) : dash;
    tb.innerHTML = _myCars.map(c => {
      const gps = c.has_gps
        ? `<span class="badge yes">${escape(t("yes"))}</span>`
        : `<span class="badge no">${escape(t("no"))}</span>`;
      const action = `<button type="button" class="row-btn my-car-edit" data-id="${c.id}">✎ ${escape(t("action.edit"))}</button>`;
      return `<tr>
        <td class="ltr" data-label="${escape(t("cars.f.vin"))}">${cell(c.vin)}</td>
        <td data-label="${escape(t("cars.f.type"))}">${cell(c.type)}</td>
        <td data-label="${escape(t("cars.f.model"))}">${cell(c.model)}</td>
        <td data-label="${escape(t("cars.f.color"))}">${cell(c.color)}</td>
        <td data-label="${escape(t("cars.f.branch"))}">${branchCell(c.branchname)}</td>
        <td class="ltr" data-label="${escape(t("cars.f.plate"))}">${cell(c.platenumber)}</td>
        <td data-label="${escape(t("cars.f.gps"))}">${gps}</td>
        <td class="my-car-action">${action}</td>
      </tr>`;
    }).join("");
  }
  // Expose so panel navigation can refresh the table on open.
  window.refreshMyCarsTable = refreshMyCarsTable;

  const myCarRows = $("#my-cars-rows");
  if (myCarRows){
    myCarRows.addEventListener("click", (e) => {
      const btn = e.target.closest(".my-car-edit");
      if (!btn) return;
      const c = _myCars.find(x => String(x.id) === btn.dataset.id);
      if (c) enterCarEditMode(c);
    });
  }
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

  // Edit-mode state: when set, Save updates this client instead of creating
  // a new one. `_myClients` caches the rows rendered in the tab's own table
  // so the Edit button can find the full record by id.
  let editingClientId = null;
  let _myClients = [];

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
    markParentRequirement();
  }
  // Show a red "*" on father/mother only while Lebanese is selected, so the
  // conditional requirement is visible before the user hits Save.
  function markParentRequirement(){
    const need = ($("#add-client-nationality")?.value || "").trim() === "Lebanese";
    form.querySelectorAll('[name="fathername"], [name="mothername"]').forEach(inp => {
      const label = inp.closest(".field")?.querySelector("label");
      if (!label) return;
      let star = label.querySelector(".req-star");
      if (need && !star){
        star = document.createElement("span");
        star.className = "req-star";
        star.textContent = " *";
        label.appendChild(star);
      } else if (!need && star){
        star.remove();
      }
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

    // Editing an existing client (typo fix) → PUT that record; otherwise
    // create a new one. Company edits are unlimited — the backend records every
    // change instead of capping them, and the admin audits them live.
    const editing = editingClientId != null;
    try {
      const r = await fetch(
        editing ? API.url(`/api/clients/${editingClientId}`) : API.url("/api/clients"),
        {
          method: editing ? "PUT" : "POST",
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
      exitEditMode();
      form.reset();
      const natSel  = $("#add-client-nationality");
      if (natSel){ natSel.value = ""; if (natSel._ss) natSel._ss.sync(); }
      const codeSel2 = $("#add-client-phone-code");
      if (codeSel2){ codeSel2.value = "961"; if (codeSel2._ss) codeSel2._ss.sync(); }
      showAddClientStatus(editing
        ? t("addClient.updated")
        : t("addClient.saved").replace("{pid}", body.personid || body.licenseid));
      toast(editing ? t("toast.saved") : t("toast.added"), "success");
      // Keep the admin's clients list, this tab's own table, and both client
      // pickers in sync.
      await refreshClients();
      await refreshMyClientsTable();
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
    // Lebanese clients must carry father + mother names (it's part of the
    // official identity in Lebanon). For every other nationality those two
    // fields stay optional — everything else is still required.
    if (nat === "Lebanese") required.push("fathername", "mothername");
    if (!validateRequiredFields(form, required)){
      // Give a clearer nudge for the Lebanese-only parent-name rule so the
      // user understands nothing was saved and exactly why.
      const fd2 = new FormData(form);
      const parentsMissing = nat === "Lebanese" && (
        !(fd2.get("fathername") || "").toString().trim() ||
        !(fd2.get("mothername") || "").toString().trim());
      if (parentsMissing){
        showAddClientStatus(t("addClient.parentsRequired"));
        toast(t("addClient.parentsRequired"), "error");
      } else {
        toast(t("toast.fillAll"), "error");
      }
      return;
    }

    // Photo is optional. If the user didn't pick one, ask whether they want
    // to add one now; "Yes" opens the picker and saves once a photo lands,
    // "No" saves immediately without a photo. Skipped when editing — a typo
    // fix shouldn't nag for a photo the record may already have.
    const photoData = ($("#add-client-photo-data")?.value || "").trim();
    if (!photoData && editingClientId == null){
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

  // ---- Edit-an-existing-client (typo correction, unlimited) ----
  const submitBtn = $("#add-client-submit");
  const cancelBtn = $("#add-client-cancel-edit");

  function enterEditMode(c){
    editingClientId = c.id;
    autoFillFromClient(c);
    // autoFillFromClient covers everything except the personid input.
    const pidEl = form.querySelector('[name="personid"]');
    if (pidEl) pidEl.value = c.personid || c.licenseid || "";
    if (submitBtn){
      submitBtn.removeAttribute("data-i18n");
      submitBtn.textContent = t("addClient.update");
    }
    if (cancelBtn) cancelBtn.hidden = false;
    form.classList.add("client-editing");
    showAddClientStatus(t("addClient.editingNow").replace("{name}", c.name || c.personid || c.licenseid || ""));
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function exitEditMode(){
    if (editingClientId == null) return;
    editingClientId = null;
    if (submitBtn){
      submitBtn.setAttribute("data-i18n", "addClient.action");
      submitBtn.textContent = t("addClient.action");
    }
    if (cancelBtn) cancelBtn.hidden = true;
    form.classList.remove("client-editing");
  }

  if (cancelBtn){
    cancelBtn.addEventListener("click", () => {
      exitEditMode();
      form.reset();               // reset handler sweeps selects + errors
      hideAddClientStatus();
    });
  }

  async function refreshMyClientsTable(){
    const tb = $("#my-clients-rows");
    if (!tb) return;
    const u = AUTH.user();
    if (!u || u.role !== "company"){ _myClients = []; tb.innerHTML = ""; return; }
    let clients = [];
    try {
      clients = await fetch(API.url("/api/clients"), { headers: authHeaders() }).then(r => r.json());
    } catch (e){ clients = []; }
    _myClients = Array.isArray(clients) ? clients : [];
    if (!_myClients.length){
      tb.innerHTML = `<tr><td colspan="6" class="empty-cell">${escape(t("addClient.noClients"))}</td></tr>`;
      return;
    }
    const dash = `<span class="badge no">—</span>`;
    const cell = (v) => v ? escape(v) : dash;
    tb.innerHTML = _myClients.map(c => {
      const action = `<button type="button" class="row-btn my-client-edit" data-id="${c.id}">✎ ${escape(t("action.edit"))}</button>`;
      return `<tr>
        <td data-label="${escape(t("clients.f.name"))}">${cell(c.name)}</td>
        <td class="ltr" data-label="${escape(t("clients.f.pid"))}">${cell(c.personid)}</td>
        <td data-label="${escape(t("addClient.nationality"))}">${cell(c.nationality)}</td>
        <td class="ltr" data-label="${escape(t("clients.f.phone"))}">${cell(c.phonenumber)}</td>
        <td class="ltr" data-label="${escape(t("clients.f.lic"))}">${cell(c.licenseid)}</td>
        <td class="my-client-action">${action}</td>
      </tr>`;
    }).join("");
  }
  // Expose so panel navigation can refresh the table on open.
  window.refreshMyClientsTable = refreshMyClientsTable;

  const myRows = $("#my-clients-rows");
  if (myRows){
    myRows.addEventListener("click", (e) => {
      const btn = e.target.closest(".my-client-edit");
      if (!btn) return;
      const c = _myClients.find(x => String(x.id) === btn.dataset.id);
      if (c) enterEditMode(c);
    });
  }
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

/* Fill a rental "which plate" <select> from the company's plate pool. A leading
   placeholder means "not chosen"; `selected` re-selects a value on edit. */
function fillPlateSelect(sel, plates, selected){
  if (!sel) return;
  const list = Array.isArray(plates) ? plates : [];
  const ph = `<option value="">${escape(t("rent.plate.ph"))}</option>`;
  sel.innerHTML = ph + list.map(p =>
    `<option value="${escape(p.plate)}">${escape(p.plate)}</option>`
  ).join("");
  sel.value = (selected && list.some(p => p.plate === selected)) ? selected : "";
  if (sel._ss) sel._ss.sync();
}

/* ============== CREATE RENTAL (company-user, on the Report tab) ====== */
async function refreshRentalPickers(){
  const u = AUTH.user();
  if (!u || u.role !== "company" || !u.company_id) return;

  // Cars belonging to this company. The /api/cars list endpoint already
  // returns the joined companyname for the label.
  let cars = [];
  try {
    cars = await fetch(API.url(`/api/cars?company_id=${u.company_id}`), { headers: authHeaders() }).then(r => r.json());
  } catch (e){ cars = []; }

  // The company's plate pool — the rental picks which plate the car is on.
  let plates = [];
  try { plates = await API.listPlates(); } catch (e){ plates = []; }

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
      `<option value="${escape(c.vin)}">${escape(`${c.model}${c.platenumber ? " — " + c.platenumber : ""} (${c.vin})`)}</option>`
    ).join("");
    carSel.innerHTML = placeholder + opts;
    carSel.value = "";
    if (carSel._ss) carSel._ss.sync();
  }
  fillPlateSelect($("#rental-plate-select"), plates);
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
      const ps = $("#rental-plate-select"); if (ps){ ps.value = ""; if (ps._ss) ps._ss.sync(); }
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
      status:     (fd.get("status")     || "active").toString(),
      // Blank → the backend uses the car's primary plate.
      plate:      (fd.get("plate")      || "").toString().trim(),
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

    // One endpoint now. A future booking used to be silently routed to
    // /api/reservations; it's a rental with status "pending" instead, and the
    // status is the user's explicit choice rather than a guess from the date.
    try {
      const r = await fetch(API.url("/api/rentals"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok){
        const msg = data.error || t("toast.error");
        if (data.errors?.status) setFieldError(form, "status", data.errors.status);
        else if (/car/i.test(msg))  setFieldError(form, "car_vin", msg);
        else if (/date/i.test(msg) || /booking/i.test(msg)) setFieldError(form, "end_date", msg);
        toast(msg, "error");
        return;
      }
      form.reset();
      hideModal("#individual-rental-modal");
      toast(t(`rental.create.saved.${body.status}`), "success");
      await refreshReport();
      if (typeof CarsHub !== "undefined") CarsHub.show("individual");
    } catch (err){
      toast(err.message || t("toast.error"), "error");
    }
  });
}

/* The create-rental form lives in a modal that closes on success, so there's
   nowhere to show a lingering "saved" banner — the toast says it instead. This
   only clears the banner (server errors still paint it via the field errors). */
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

/* Bulk add cars by pasting a JSON array → POST /api/cars/batch. Company-only,
   all-or-nothing; the per-row `errors` object is flattened for display. */
function setupAddCarJson(){
  const ta       = $("#add-car-json");
  const sampleBtn= $("#btn-add-car-json-sample");
  const submitBtn= $("#btn-add-car-json-submit");
  const fileInp  = $("#add-car-json-file");
  const results  = $("#add-car-json-results");
  if (!ta) return;

  // Loading a .json file just drops its text into the textarea so the user
  // can review (and the existing Submit path handles the rest).
  fileInp?.addEventListener("change", async () => {
    const f = fileInp.files[0];
    if (!f) return;
    try {
      ta.value = await f.text();
      if (results){ results.hidden = true; }
    } catch (err){
      toast(err.message || "Could not read file", "error");
    }
    fileInp.value = "";  // allow re-picking the same file
  });

  sampleBtn?.addEventListener("click", () => {
    ta.value = JSON.stringify([
      { vin: "1HGCM82633A004352", type: "Sedan", model: "Honda Accord",
        color: "White", platenumber: "M 12345", has_gps: true },
      { vin: "1HGBH41JXMN109186", type: "Sedan", model: "Honda Civic",
        color: "Black", plate_icon: "B", plate_number: "67890" },
    ], null, 2);
    if (results){ results.hidden = true; }
  });

  submitBtn?.addEventListener("click", async () => {
    const text = (ta.value || "").trim();
    if (!text){ toast("Paste a JSON array of cars first.", "error"); return; }

    let body;
    try {
      body = JSON.parse(text);
    } catch (e){
      toast("Invalid JSON: " + e.message, "error");
      return;
    }

    try {
      const r = await fetch(API.url("/api/cars/batch"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));

      const failed   = data.failed || [];
      const inserted = data.inserted || 0;

      $("#add-car-json-ok").textContent   = inserted;
      $("#add-car-json-fail").textContent = failed.length;
      // Each failure is {index, errors:{field:msg,…}} — flatten to one line.
      $("#add-car-json-errors").innerHTML = failed.length
        ? failed.map(e => {
            const where = e.index === undefined ? "?" : e.index;
            const detail = Object.entries(e.errors || {})
              .map(([f, m]) => `${f === "_" ? "" : f + ": "}${m}`)
              .join("; ");
            return `<li><strong>Row ${escape(String(where))}</strong>: ${escape(detail)}</li>`;
          }).join("")
        : "";
      results.classList.toggle("rejected", !r.ok);
      results.hidden = false;

      if (!r.ok){
        toast(data.error || "Batch rejected.", "error");
      } else if (inserted > 0){
        toast(t("toast.added"), "success");
        if (typeof refreshCars === "function") refreshCars();
      }
    } catch (err){
      toast(err.message || t("toast.error"), "error");
    }
  });
}

/* API-key management for company users — generate / show status / revoke.
   The raw key is returned once by POST /api/api-key and shown in a copyable
   field; thereafter only the prefix is known. */
function setupApiKey(){
  const genBtn   = $("#btn-api-key-generate");
  const revBtn   = $("#btn-api-key-revoke");
  const statusEl = $("#api-key-status");
  const reveal   = $("#api-key-reveal");
  const valueInp = $("#api-key-value");
  if (!genBtn) return;

  const setStatus = (msg, kind) => {
    if (!statusEl) return;
    statusEl.hidden = false;
    statusEl.className = "company-info-status" + (kind ? " " + kind : "");
    statusEl.textContent = msg;
  };

  async function refreshStatus(){
    // The API-key panel is a company-user feature. An admin has no company_id,
    // so hitting the endpoint would 400 ("company_id required") — skip it to
    // keep the console clean.
    const u = AUTH.user();
    if (!u || u.role !== "company") return;
    try {
      const r = await fetch(API.url("/api/api-key"), { headers: authHeaders() });
      if (!r.ok) return;
      const d = await r.json().catch(() => ({}));
      if (d.has_key){
        setStatus(`Key active: ${d.prefix}… (created ${String(d.created_at || "").slice(0,10)})`, "");
      } else {
        setStatus("No API key yet — generate one to push data from your own systems.", "");
      }
    } catch { /* non-fatal */ }
  }

  genBtn.addEventListener("click", async () => {
    try {
      const r = await fetch(API.url("/api/api-key"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok){ toast(d.error || "Could not generate key", "error"); return; }
      if (reveal && valueInp){
        valueInp.value = d.api_key || "";
        reveal.hidden = false;
        valueInp.focus();
        valueInp.select();
      }
      toast("API key generated — copy it now, it won't be shown again.", "success");
      refreshStatus();
    } catch (err){
      toast(err.message || t("toast.error"), "error");
    }
  });

  revBtn?.addEventListener("click", async () => {
    try {
      const r = await fetch(API.url("/api/api-key"), {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (r.status === 204){
        if (reveal){ reveal.hidden = true; }
        toast("API key revoked.", "success");
        refreshStatus();
      } else {
        const d = await r.json().catch(() => ({}));
        toast(d.error || "Could not revoke key", "error");
      }
    } catch (err){
      toast(err.message || t("toast.error"), "error");
    }
  });

  refreshStatus();
}

function setupBranchModal(){
  // The branch form is inline inside the Company Info tab. Each click of
  // "+ Add Branch" appends a fresh form instance to #branch-forms-list, so
  // multiple branches can be filled in and saved independently.
  $("#btn-toggle-branch-form")?.addEventListener("click", appendInlineBranchForm);

  // Only ONE branch may ever be the head office. When several new branch forms
  // are open and the user tries to tick a SECOND "head office" box, we block it
  // and alert them to pick just one — they must untick the other first. Unticking
  // is always allowed: with no branch ticked, the main office is the head office.
  $("#branch-forms-list")?.addEventListener("change", (e) => {
    const cb = e.target.closest?.('[data-role="branch-head-check"]');
    if (!cb) return;
    if (cb.checked){
      const others = $$('[data-role="branch-head-check"]', $("#branch-forms-list"))
                       .filter(o => o !== cb);
      if (others.some(o => o.checked)){
        // A second head office isn't allowed — undo this tick and warn.
        cb.checked = false;
        toast(t("companyInfo.branch.headOffice.onlyOne"), "error");
      }
    }
  });
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

// The car filter cascades off the company filter: pick a company and this
// searchable dropdown (data-ss-prefix) fills with only THAT company's cars —
// which stays scalable however large the overall fleet grows. With no company
// chosen it's disabled, because a global list of every car can't be a dropdown.
async function rebuildCarsVehicleDropdown(){
  const sel = $("#filter-cars-vehicle");
  if (!sel) return;
  const placeholder = sel.querySelector('option[disabled][hidden]')?.outerHTML
    || `<option value="" disabled selected hidden>${escape(t("filter.vinHint"))}</option>`;
  const cid = companyIdByName($("#filter-cars-company")?.value || "");
  if (!cid){
    sel.innerHTML = placeholder;
    sel.value = "";
    sel.disabled = true;
    if (sel._ss) sel._ss.sync();
    return;
  }
  let cars = [];
  try { cars = await API.listCars(cid); } catch (e){ cars = []; }
  const label = (c) => c.platenumber ? `${c.model} — ${c.platenumber}` : c.model;
  sel.innerHTML = placeholder
    + `<option value="">${escape(t("filter.all"))}</option>`
    + cars.map(c => `<option value="${escape(c.vin)}">${escape(label(c))}</option>`).join("");
  sel.value = "";
  sel.disabled = false;
  if (sel._ss) sel._ss.sync();
}

function setupReportSearch(){
  // ---------- Companies toolbar (dropdown filters + Search button) ----------
  // No free-text: the admin picks Company / Owner / Location from dropdowns and
  // commits with Search. Nothing filters until Search is clicked.
  const companyFilterSelects = ["#filter-companies-name", "#filter-companies-owner", "#filter-companies-loc"];
  const applyCompanyFilters = () => {
    companyFilters.name     = $("#filter-companies-name")?.value  || "";
    companyFilters.owner    = $("#filter-companies-owner")?.value || "";
    companyFilters.location = $("#filter-companies-loc")?.value   || "";
    Pager.reset("companies");
    renderCompanies();
  };
  $("#filter-companies-apply")?.addEventListener("click", applyCompanyFilters);
  $("#filter-companies-clear")?.addEventListener("click", () => {
    companyFilterSelects.forEach(s => { const el = $(s); if (el) el.value = ""; });
    applyCompanyFilters();
  });

  // ---------- Cars toolbar (dropdown filters + Search button) ----------
  // Filters drive a fresh server query so the tree scales to very large fleets.
  // All dropdowns; committed only on Search. Searching auto-expands matches.
  const carFilterSelects = ["#filter-cars-company", "#filter-cars-type", "#filter-cars-model", "#filter-cars-gps"];
  const applyCarFilters = () => {
    carFilters.company = $("#filter-cars-company")?.value || "";
    carFilters.type    = $("#filter-cars-type")?.value    || "";
    carFilters.model   = $("#filter-cars-model")?.value    || "";
    carFilters.gps     = $("#filter-cars-gps")?.value      || "";
    loadFleet();
  };
  $("#filter-cars-apply")?.addEventListener("click", applyCarFilters);
  $("#filter-cars-clear")?.addEventListener("click", () => {
    carFilterSelects.forEach(s => { const el = $(s); if (el) el.value = ""; });
    applyCarFilters();
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
    // Record the sign-out in the audit trail before we drop the identity.
    // Best-effort with keepalive so it still fires as the view tears down.
    try {
      const u = this.user();
      if (u && u.company_id){
        fetch(API.url("/api/logout"),
              { method: "POST", headers: authHeaders(), keepalive: true }).catch(() => {});
      }
    } catch (e){ /* never block sign-out */ }
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

// Tween a stat number from its current value up to `to`. Only animates when
// the value actually changed (this runs on a 5s live poll), so the numbers
// don't re-count on every tick. Respects prefers-reduced-motion.
function animateCount(el, to){
  if (!el) return;
  const prev = Number(el.dataset.val);
  const from = Number.isFinite(prev) ? prev : 0;
  el.dataset.val = String(to);
  if (from === to){ el.textContent = String(to); return; }
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce){ el.textContent = String(to); return; }
  if (el._countRAF) cancelAnimationFrame(el._countRAF);
  const dur = 650, t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);           // easeOutCubic
    el.textContent = String(Math.round(from + (to - from) * eased));
    if (p < 1) el._countRAF = requestAnimationFrame(step);
    else el.textContent = String(to);
  };
  el._countRAF = requestAnimationFrame(step);
}

function updateStatsDashboard(){
  const el = (id, val) => animateCount($(`#${id}`), val);
  el("stat-companies", state.companies.length);
  el("stat-cars",      _carsCount || state.cars.length);
  el("stat-clients",   state.clients.length);
  el("stat-rentals",   state.report.length);

  const now = new Date();
  const dateEl = $("#dash-date");
  if (dateEl){
    dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric"
    });
  }

  // Time-aware greeting in the hero eyebrow.
  const greetEl = $("#dash-greeting");
  if (greetEl){
    const h = now.getHours();
    const key = h < 12 ? "dash.greeting.morning"
              : h < 18 ? "dash.greeting.afternoon"
              : "dash.greeting.evening";
    greetEl.setAttribute("data-i18n", key);
    greetEl.textContent = t(key);
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

/* One row in a company's expand-on-click activity timeline. When the event
   carries detail data (e.g. the client / car / dates behind an added car or a
   reservation) the row becomes its own toggle — the detail is hidden until the
   admin presses the entry. */
function _timelineItemHtml(a){
  const verb = t(`activity.${a.action}`);
  const ent  = t(`activity.entity.${a.entity}`);
  const when = a.created_at ? _timeAgo(a.created_at) : "";
  const who  = a.username ? ` · ${escape(a.username)}` : "";
  if (a.detail){
    const drill = refDrillButton(a.ref);
    return `<div class="dash-timeline-item has-detail" role="button" tabindex="0" title="${escape(t("dash.timeline.toggle"))}">
      <span class="dash-timeline-when">${escape(when)}</span>
      <div class="dash-timeline-body">
        <span class="dash-timeline-text">${escape(verb)} ${escape(ent)}${who} <span class="dash-timeline-caret">▾</span></span>
        <div class="dash-timeline-detail" hidden>${escape(a.detail)}${drill ? `<div class="audit-drill-row">${drill}</div>` : ""}</div>
      </div>
    </div>`;
  }
  return `<div class="dash-timeline-item">
    <span class="dash-timeline-when">${escape(when)}</span>
    <span class="dash-timeline-text">${escape(verb)} ${escape(ent)}${who}</span>
  </div>`;
}

/* Wire each detail-bearing timeline entry so pressing it toggles its data. */
function _wireTimelineToggles(tl){
  tl.querySelectorAll(".dash-timeline-item.has-detail").forEach(ti => {
    const toggle = () => {
      const d = ti.querySelector(".dash-timeline-detail");
      if (!d) return;
      const wasHidden = d.hidden;
      d.hidden = !wasHidden;
      ti.classList.toggle("expanded", wasHidden);
    };
    ti.addEventListener("click", toggle);
    ti.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " "){ e.preventDefault(); toggle(); }
    });
  });
  // Drill buttons inside the expanded details (stopPropagation keeps a click
  // from also collapsing the row).
  wireRefDrills(tl);
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
      if (!tl.hidden){ tl.hidden = true; item.classList.remove("expanded"); return; }
      if (!tl.dataset.loaded){
        tl.innerHTML = `<p class="dash-empty">${escape(t("dash.loading"))}</p>`;
        try {
          const r = await fetch(API.url(`/api/company-activity/${item.dataset.companyId}`),
                                { headers: authHeaders() });
          const data = r.ok ? await r.json() : [];
          tl.innerHTML = data.length
            ? data.map(_timelineItemHtml).join("")
            : `<p class="dash-empty">${escape(t("dash.timeline.empty"))}</p>`;
          _wireTimelineToggles(tl);
        } catch (e){
          tl.innerHTML = `<p class="dash-empty">${escape(t("dash.timeline.empty"))}</p>`;
        }
        tl.dataset.loaded = "1";
      }
      tl.hidden = false;
      item.classList.add("expanded");
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
          await AuditLog.load(true);
          await AuditLog.loadStats(true);
          // Keep the stat cards (companies / cars / clients / rentals) moving
          // too — refresh the underlying datasets, then recompute the totals.
          await Promise.all([
            refreshCompanies(), refreshCarsCount(), refreshClients(), refreshReport(),
          ]);
          updateStatsDashboard();
          break;
        // Only the dashboard polls live. The data-table panels
        // (companies / cars / clients / car-gps / report / reservations) are
        // refreshed once when you navigate into them (see AdminSidebar.show),
        // so they no longer re-fetch/re-render every few seconds while open.
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

/* ---- Dashboard: enterprise audit log ----
   A single live stream of every action every company performs — logins,
   logouts, and create/update/delete of any entity — newest first, with
   company / action / type / free-text filters and keyset "load more".
   Server-side filtered + paginated so it stays fast at millions of rows. */
const AuditLog = (() => {
  const PAGE = 40;
  let items = [];
  let nextCursor = null;
  let loading = false;
  let wired = false;
  let lastRaw = "";
  let searchTimer = null;
  const filters = { company_id: "", action: "", entity: "", q: "" };

  function readFilters(){
    filters.company_id = ($("#audit-filter-company")?.value || "").trim();
    filters.action     = ($("#audit-filter-action")?.value  || "").trim();
    filters.entity     = ($("#audit-filter-entity")?.value  || "").trim();
    filters.q          = ($("#audit-filter-search")?.value  || "").trim();
  }

  function queryString(cursor){
    const p = new URLSearchParams();
    if (filters.company_id) p.set("company_id", filters.company_id);
    if (filters.action)     p.set("action", filters.action);
    if (filters.entity)     p.set("entity", filters.entity);
    if (filters.q)          p.set("q", filters.q);
    if (cursor)             p.set("before_id", cursor);
    p.set("limit", PAGE);
    return p.toString();
  }

  function rowHtml(a){
    const verb = t(`activity.${a.action}`) || a.action;
    const ent  = t(`activity.entity.${a.entity}`) || a.entity;
    const when = a.created_at ? _timeAgo(a.created_at) : "";
    const abs  = a.created_at ? new Date(a.created_at).toLocaleString() : "";
    const detail = a.detail
      ? `<span class="audit-detail">${escape(a.detail)}</span>`
      : `<span class="audit-detail audit-detail-muted">${escape(ent)}</span>`;
    return `<div class="audit-row" data-audit-id="${a.id}" role="button" tabindex="0" title="${escape(t("audit.detail.open"))}">
      <span class="audit-time" title="${escape(abs)}">${escape(when)}</span>
      <span class="audit-badge audit-badge-${escape(a.action)}">${escape(verb)}</span>
      <span class="audit-ent">${escape(ent)}</span>
      <div class="audit-main">
        <span class="audit-company">${escape(a.companyname || t("audit.unknownCompany"))}</span>
        ${detail}
      </div>
      <span class="audit-user">${a.username ? "👤 " + escape(a.username) : "—"}</span>
    </div>`;
  }

  /* Full detail of a single event, shown when the admin clicks a row. */
  function openDetail(a){
    const body = $("#audit-detail-body");
    if (!body) return;
    const verb = t(`activity.${a.action}`) || a.action;
    const ent  = t(`activity.entity.${a.entity}`) || a.entity;
    const abs  = a.created_at ? new Date(a.created_at).toLocaleString() : "—";
    const rel  = a.created_at ? _timeAgo(a.created_at) : "";
    const rows = [
      [t("audit.detail.action"),  `<span class="audit-badge audit-badge-${escape(a.action)}">${escape(verb)}</span>`],
      [t("audit.detail.entity"),  escape(ent)],
      [t("audit.detail.company"), escape(a.companyname || t("audit.unknownCompany"))],
      [t("audit.detail.user"),    a.username ? "👤 " + escape(a.username) : "—"],
      [t("audit.detail.time"),    `${escape(abs)} <span class="audit-dl-rel">(${escape(rel)})</span>`],
    ];
    let html = `<dl class="audit-dl">` + rows.map(([k, v]) =>
      `<div class="audit-dl-row"><dt>${escape(k)}</dt><dd>${v}</dd></div>`).join("") + `</dl>`;
    html += `<h4 class="audit-dl-h">${escape(t("audit.detail.changes"))}</h4>`;
    html += a.detail
      ? `<pre class="audit-detail-full">${escape(a.detail)}</pre>`
      : `<p class="audit-detail-muted" style="padding:.4rem .1rem;margin:0;">${escape(t("audit.detail.none"))}</p>`;
    // When the event points at a record (car / client / branch), offer a
    // one-click drill into that record's full detail.
    const drill = refDrillButton(a.ref);
    if (drill) html += `<div class="audit-drill-row">${drill}</div>`;
    body.innerHTML = html;
    wireRefDrills(body);
    showModal("#audit-detail-modal");
  }

  function wireRows(box){
    box.querySelectorAll(".audit-row").forEach(row => {
      const open = () => {
        const id = Number(row.dataset.auditId);
        const a = items.find(x => Number(x.id) === id);
        if (a) openDetail(a);
      };
      row.addEventListener("click", open);
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " "){ e.preventDefault(); open(); }
      });
    });
  }

  function render(){
    const box = $("#audit-stream");
    if (!box) return;
    if (!items.length){
      const anyFilter = filters.company_id || filters.action || filters.entity || filters.q;
      box.innerHTML = `<p class="dash-empty">${escape(anyFilter ? t("audit.noMatch") : t("audit.empty"))}</p>`;
      return;
    }
    box.innerHTML = items.map(rowHtml).join("")
      + (nextCursor
          ? `<div class="dash-load-more"><button type="button" class="dash-load-more-btn audit-more-btn">${escape(t("dash.loadMore"))}</button></div>`
          : "");
    const moreBtn = box.querySelector(".audit-more-btn");
    if (moreBtn) moreBtn.addEventListener("click", loadMore);
    wireRows(box);
  }

  async function load(silent = false){
    const u = AUTH.user();
    if (!u || u.role !== "admin") return;
    if (loading) return;
    loading = true;
    try {
      readFilters();
      const r = await fetch(API.url("/api/admin/audit-log?" + queryString()), { headers: authHeaders() });
      if (!r.ok) return;
      const raw = await r.text();
      // On a silent auto-refresh, skip the re-render when nothing changed so
      // any "load more" position the admin scrolled to stays put.
      if (silent && raw === lastRaw) return;
      lastRaw = raw;
      const data = JSON.parse(raw) || {};
      items = data.items || [];
      nextCursor = data.next_cursor || null;
      render();
    } catch (e){
      if (!silent){ const box = $("#audit-stream"); if (box) box.innerHTML = `<p class="dash-empty">${escape(t("audit.empty"))}</p>`; }
    } finally { loading = false; }
  }

  async function loadMore(){
    if (!nextCursor || loading) return;
    loading = true;
    try {
      const r = await fetch(API.url("/api/admin/audit-log?" + queryString(nextCursor)), { headers: authHeaders() });
      if (!r.ok) return;
      const data = await r.json();
      items = items.concat(data.items || []);
      nextCursor = data.next_cursor || null;
      lastRaw = "";               // list grew — invalidate the silent-refresh cache
      render();
    } catch (e){ /* keep current view */ }
    finally { loading = false; }
  }

  async function loadStats(silent = false){
    const u = AUTH.user();
    if (!u || u.role !== "admin") return;
    try {
      const r = await fetch(API.url("/api/admin/audit-stats"), { headers: authHeaders() });
      if (!r.ok) return;
      const s = await r.json();
      const set = (id, v) => { const el = $(`#${id}`); if (el) animateCount(el, v || 0); };
      set("audit-kpi-events",    s.events);
      set("audit-kpi-logins",    s.logins);
      set("audit-kpi-created",   s.created);
      set("audit-kpi-edits",     s.edits);
      set("audit-kpi-deletes",   s.deletes);
      set("audit-kpi-companies", s.companies);
    } catch (e){ /* transient */ }
  }

  /* Populate the company filter with value = company id (server filters by id). */
  function populateCompanies(){
    const sel = $("#audit-filter-company");
    if (!sel) return;
    const cur = sel.value;
    const list = (state.companies || [])
      .filter(c => c && c.id && c.companyname)
      .slice()
      .sort((a, b) => String(a.companyname).localeCompare(String(b.companyname), undefined, { sensitivity: "base" }));
    sel.innerHTML = `<option value="">${escape(t("audit.filter.allCompanies"))}</option>`
      + list.map(c => `<option value="${c.id}">${escape(c.companyname)}</option>`).join("");
    if (cur && list.some(c => String(c.id) === cur)) sel.value = cur;
    if (sel._ss) sel._ss.sync();
  }

  function setup(){
    if (wired) return;
    wired = true;
    const reload = () => { lastRaw = ""; load(); };
    ["audit-filter-company", "audit-filter-action", "audit-filter-entity"].forEach(id => {
      const el = $(`#${id}`);
      if (el) el.addEventListener("change", reload);
    });
    const search = $("#audit-filter-search");
    if (search) search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(reload, 300);
    });
    $("#audit-detail-close")?.addEventListener("click", () => hideModal("#audit-detail-modal"));
    $("#audit-detail-cancel")?.addEventListener("click", () => hideModal("#audit-detail-modal"));
  }

  return { load, loadMore, loadStats, populateCompanies, setup };
})();

function showApp(){
  $("#login-overlay").style.display = "none";
  document.body.style.overflow = "";
  renderHeaderProfile();
  renderReportCompanyHead();
  applyRoleUI();
}

function _wait(ms){ return new Promise(r => setTimeout(r, ms)); }

let _gaugeRAF = null;
let _gaugeLastStep = -1;
const _LOADER_STEPS = ["loader.s1", "loader.s2", "loader.s3", "loader.s4"];

// Paint the speedometer at progress p (0..1): fill the arc, swing the
// needle (-135° → +135° = a 270° sweep), and update the digital readout.
function _setGauge(p){
  const pc = Math.max(0, Math.min(1, p));
  const prog   = document.querySelector(".al-g-prog");
  const needle = document.querySelector(".al-g-needle");
  const num    = document.getElementById("al-gauge-num");
  if (prog)   prog.setAttribute("stroke-dasharray", `${(pc * 75).toFixed(2)} 100`);
  if (needle) needle.setAttribute("transform", `rotate(${(-135 + pc * 270).toFixed(1)} 100 100)`);
  if (num)    num.textContent = String(Math.round(pc * 100));
}

function _setStatus(idx){
  const statusEl = document.getElementById("app-loader-status");
  if (!statusEl || idx === _gaugeLastStep) return;
  _gaugeLastStep = idx;
  statusEl.style.opacity = "0";
  setTimeout(() => {
    statusEl.textContent = t(_LOADER_STEPS[Math.min(idx, _LOADER_STEPS.length - 1)]);
    statusEl.style.opacity = "1";
  }, 150);
}

function showAppLoader(){
  const el = document.getElementById("app-loader");
  if (!el) return;
  el.classList.remove("done");
  el.hidden = false;
  _gaugeLastStep = -1;
  _setGauge(0);
  _setStatus(0);
  requestAnimationFrame(() => el.classList.add("show"));

  // Rev the gauge from 0 → 90% over ~2.6s (easeOut); the last 10% lands
  // on hide() when the data is actually ready. Status text tracks the rev.
  if (_gaugeRAF) cancelAnimationFrame(_gaugeRAF);
  const dur = 2600, t0 = performance.now();
  const tick = (now) => {
    const x = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - x, 2);
    _setGauge(eased * 0.9);
    _setStatus(Math.min(_LOADER_STEPS.length - 1, Math.floor(x * _LOADER_STEPS.length)));
    if (x < 1) _gaugeRAF = requestAnimationFrame(tick);
  };
  _gaugeRAF = requestAnimationFrame(tick);
}

function hideAppLoader(){
  const el = document.getElementById("app-loader");
  if (!el) return;
  if (_gaugeRAF){ cancelAnimationFrame(_gaugeRAF); _gaugeRAF = null; }
  _setStatus(_LOADER_STEPS.length - 1);
  // Redline: sweep the needle to 100 with a tiny overshoot, then zoom-blur away.
  const t0 = performance.now(), dur = 420;
  const finish = (now) => {
    const x = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - x, 2);
    const overshoot = Math.sin(x * Math.PI) * 0.03;     // little bounce past 100
    _setGauge(Math.min(1, 0.9 + 0.1 * eased + overshoot));
    if (x < 1){ requestAnimationFrame(finish); return; }
    _setGauge(1);
    el.classList.add("done");
    el.classList.remove("show");
    setTimeout(() => {
      el.hidden = true;
      el.classList.remove("done");
      _setGauge(0);
    }, 560);
  };
  requestAnimationFrame(finish);
}

// Branded login → dashboard transition: show the splash, load all data,
// then reveal the app. A minimum on-screen time keeps the animation from
// just flashing when the data loads instantly.
async function enterApp(){
  showAppLoader();
  showApp();
  try {
    // Hold the splash long enough to enjoy a full drive-by (car crosses in 3s).
    await Promise.all([loadAllData(), _wait(3200)]);
  } finally {
    hideAppLoader();
  }
  // Data + splash done: surface today's returns / reservations once.
  if (typeof Notifications !== "undefined") Notifications.maybeAutoShow();
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
  $("#login-overlay").style.display = "flex";
  $("#login-error").hidden = true;
  $("#form-login").reset();
  document.body.style.overflow = "hidden";
  $("#user-profile").hidden = true;
  document.body.classList.remove("role-admin", "role-company");
}

/* ----- role-based UI gate ----- */
/* ============== ADMIN SIDEBAR PANEL TOGGLE ============== */
const AdminSidebar = (() => {
  // "admin-home" is the card-based landing; the rest are the panels a card (or
  // the — now hidden — sidebar) opens. Dashboard is special-cased below because
  // it's shown via style.display, not the .admin-panel-active class.
  // "report" is NOT here: #report is the company role's Clients History now.
  // The admin's rental report is a view inside Cars (see CAR_VIEWS), so listing
  // it would toggle .admin-panel-active on the company's section.
  const PANELS = ["admin-home", "dashboard", "companies", "cars", "clients", "support"];
  // The two "cars rented by …" tables, the GPS map and the rental report are
  // views inside the Cars panel now, not panels of their own. Their old names
  // survive in links and bookmarks, so they map onto Cars + the view they
  // promised. Anything that opens a view belongs HERE, not in PANELS.
  const CAR_VIEWS = {
    "admin-special": "company", "admin-individual": "individual",
    "car-gps": "gps", "report": "report",
  };
  let _current = "admin-home";

  function show(panel){
    if (panel === "register-modal"){
      showModal("#register-modal");
      return;
    }
    // Entering Cars by any other route lands on the fleet.
    const carView = CAR_VIEWS[panel] || (panel === "cars" ? "fleet" : null);
    if (carView) panel = "cars";
    _current = panel;
    PANELS.forEach(p => {
      if (p === "dashboard"){
        const sd = $("#stats-dashboard");
        const ia = $("#inactive-alerts");
        if (sd) sd.style.display = panel === "dashboard" ? "block" : "none";
        if (ia) ia.style.display = panel === "dashboard" ? "block" : "none";
      } else {
        const el = $(`#${p}`);
        if (!el) return;
        el.classList.toggle("admin-panel-active", p === panel);
      }
    });
    $$("#admin-sidebar .sidebar-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.panel === panel);
    });
    // Drop the (unused) sidebar offset and let the card grid breathe full-width.
    document.body.classList.toggle("admin-home-active", panel === "admin-home");
    // Refresh a data-table panel once, on open, instead of polling it every
    // few seconds (which made the bento tables re-render constantly). The
    // loaders no-op the re-render when the payload is unchanged.
    switch (panel){
      case "companies":          refreshCompanies(); break;
      case "cars":               refreshCars(); AdminCarsHub.refresh(); break;
      // The two history views load themselves when their tab is opened
      // (ClientsHub.show) — this only refreshes the register and the badges.
      case "clients":            refreshClients(); ClientsHub.refresh(); break;
      // No "report" case: it resolved to "cars" above, and AdminCarsHub.show()
      // loads the report feed when that view is the one being opened.
    }
    // Switch the view only once the panel is on screen — the GPS view in
    // particular can't size its map until it's laid out. AdminCarsHub.show()
    // handles that.
    if (carView) AdminCarsHub.show(carView);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setup(){
    $$("#admin-sidebar .sidebar-btn").forEach(btn => {
      btn.addEventListener("click", () => show(btn.dataset.panel));
    });
    // Card-based navigation: each home card opens its panel; each panel's
    // "← Back to home" button returns to the card grid.
    $$("[data-ago]").forEach(card => {
      card.addEventListener("click", () => show(card.dataset.ago));
    });
    $$("[data-ahome]").forEach(btn => {
      btn.addEventListener("click", () => show("admin-home"));
    });
    show("admin-home");
  }

  function current(){ return _current; }

  return { setup, show, current };
})();

/* Light/dark theme toggle — shared by both signed-in roles. Both default to
   the premium dark theme; the header button flips to a white/light theme and
   remembers the choice. Adding `theme-light` disables the shared dark rules
   (they're gated `:not(.theme-light)`), so the base light tokens take over. */
let _themeWired = false;
function setupThemeToggle(){
  const THEME_KEY = "carrental.uiTheme";
  const themeBtn = $("#btn-theme-toggle");
  function applyTheme(mode){
    const light = mode === "light";
    document.body.classList.toggle("theme-light", light);
    if (themeBtn){
      // Label/icon show the mode you'll switch TO.
      const icon  = themeBtn.querySelector(".theme-toggle-icon");
      const label = themeBtn.querySelector(".theme-toggle-label");
      if (icon)  icon.textContent  = light ? "🌙" : "☀️";
      if (label) label.textContent = light ? t("theme.dark") : t("theme.light");
    }
  }
  applyTheme(localStorage.getItem(THEME_KEY) || "dark");
  if (themeBtn && !_themeWired){
    _themeWired = true;
    themeBtn.addEventListener("click", () => {
      const next = document.body.classList.contains("theme-light") ? "dark" : "light";
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
    });
    // Keep the toggle label correct after a language switch.
    document.addEventListener("lang:changed", () => {
      applyTheme(document.body.classList.contains("theme-light") ? "light" : "dark");
    });
  }
}

function applyRoleUI(){
  const user = AUTH.user();
  document.body.classList.remove("role-admin", "role-company");
  if (!user) return;

  document.body.classList.add(`role-${user.role}`);

  if (user.role === "admin"){
    AdminSidebar.setup();
    AdminSpecial.setup();
    AdminIndividual.setup();
    AdminCarsHub.setup();
    ClientsHub.setup();   // also sets up the two history views it owns
    AuditLog.setup();
    EntityDetail.setup();
    ReportRow.setup();   // the admin report's row modal (company role has none)
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
    // "company-home" is the card-based landing; the rest are the individual
    // panels a card (or the sidebar) opens.
    // "company-special" is gone — the B2B table and form now live inside the
    // Cars hub (#company-cars) alongside the fleet and individual rentals.
    // "report" is gone too: the Clients History is a VIEW inside #company-clients
    // now (see CO_CLIENT_VIEWS below), so listing it here would toggle
    // .company-panel-active on an element that no longer exists.
    const COMPANY_PANELS = ["company-home", "company-returns", "company-info", "company-cars", "company-clients", "company-api", "support"];
    // The Clients History's old panel name survives in links and the Return-Due
    // widget, so it maps onto the panel plus the view it promised. Anything that
    // opens a view belongs HERE, not in COMPANY_PANELS.
    const CO_CLIENT_VIEWS = { "report": "history" };
    let _compCurrent = "company-home";

    function showCompanyPanel(panel){
      // Entering the clients panel by any other route lands on the register.
      const coClientView = CO_CLIENT_VIEWS[panel] || (panel === "company-clients" ? "add" : null);
      if (coClientView) panel = "company-clients";
      _compCurrent = panel;
      COMPANY_PANELS.forEach(p => {
        const el = $(`#${p}`);
        if (el) el.classList.toggle("company-panel-active", p === panel);
      });
      $$("#company-sidebar .sidebar-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.cpanel === panel);
      });
      // The card home has its own body class so we can drop the sidebar offset
      // and let the grid breathe full-width.
      document.body.classList.toggle("company-home-active", panel === "company-home");
      // Opening the Returns tab: pull fresh rentals so due/overdue dates are
      // current without a page refresh.
      if (panel === "company-returns") Returns.refresh();
      // Returning to the home dashboard: refresh the "Return Due" widget so it
      // reflects any rentals created / returned on other tabs.
      if (panel === "company-home" && typeof ReturnDue !== "undefined") ReturnDue.refresh();
      // Opening the branch section: sync the "this is my head office" checkbox on
      // the company form with whether a branch currently holds the head office.
      if (panel === "company-info" && window.refreshCompanyHeadOffice) window.refreshCompanyHeadOffice();
      // Opening the clients hub: refresh the "clients you added" table so
      // freshly-added / edited clients (and remaining edit counts) show. The
      // hub owns that call now, and loads the history feed if that's the view
      // being opened. The view is passed in rather than switched afterwards, so
      // the panel paints once instead of painting the old view first.
      if (panel === "company-clients") CoClientsHub.refresh(coClientView);
      // Opening the Cars hub: refresh the fleet table and the branch dropdown
      // (branches may have been added since page load / login), then let the
      // hub load the individual + B2B tables and repaint its counts.
      if (panel === "company-cars"){
        (async () => {
          if (window.refreshMyCarsTable) await window.refreshMyCarsTable();
          if (window.refreshAddCarBranches) window.refreshAddCarBranches();
          await CarsHub.refresh();
        })();
      }
      // No "report" case: it resolved to "company-clients" above, and
      // CoClientsHub.refresh() pulls fresh rentals when the view it opens is
      // the history one.
      // Jumping between panels can leave you scrolled halfway down a long form.
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    // Expose so other modules (e.g. deep links) could navigate if needed.
    window.showCompanyPanel = showCompanyPanel;

    $$("#company-sidebar .sidebar-btn").forEach(btn => {
      btn.addEventListener("click", () => showCompanyPanel(btn.dataset.cpanel));
    });

    // Card-based navigation: each home card opens its panel; each panel's
    // "← Back to home" button returns to the card grid.
    $$("[data-cgo]").forEach(card => {
      card.addEventListener("click", () => showCompanyPanel(card.dataset.cgo));
    });
    $$("[data-chome]").forEach(btn => {
      btn.addEventListener("click", () => showCompanyPanel("company-home"));
    });

    const compCollapseBtn = $("#company-sidebar-collapse");
    if (compCollapseBtn){
      compCollapseBtn.addEventListener("click", () => {
        const sidebar = $("#company-sidebar");
        if (sidebar) sidebar.classList.toggle("collapsed");
        document.body.classList.toggle("sidebar-collapsed");
      });
    }

    showCompanyPanel("company-home");
  }

  // Both signed-in roles get the light/dark toggle.
  setupThemeToggle();
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
      await enterApp();
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
        await enterApp();
      } catch (err){
        errEl.textContent = err.message || t("toast.error");
        errEl.hidden = false;
      }
    });
  }

  $("#btn-logout").addEventListener("click", () => {
    AUTH.signOut();
    if (typeof Notifications !== "undefined") Notifications.reset();
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
      { name: "branch_id",   labelKey: "cars.f.branch", type: "select",
        allowEmpty: true, emptyLabelKey: "cars.branch.main",
        optionsFrom: (rec) => (state.branches || []).filter(b => b.company_id === rec?.company_id),
        valueKey: "id", labelFn: (b) => b.branchname },
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
      // allowEmpty → a leading option whose value is "" (e.g. a car's branch
      // may be "Main" = no branch). Selected when the record has no value.
      if (f.allowEmpty){
        const o = document.createElement("option");
        o.value = "";
        o.textContent = t(f.emptyLabelKey || "filter.all");
        if (rec[f.name] == null || rec[f.name] === "") o.selected = true;
        sel.appendChild(o);
      }
      (f.optionsFrom(rec) || []).forEach(opt => {
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
      // allowEmpty select ("Main" branch) → "" becomes null, otherwise numeric id.
      if (f.type === "select" && f.allowEmpty){
        body[f.name] = body[f.name] === "" || body[f.name] == null ? null : Number(body[f.name]);
      }
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

  // Company coordinate is (x = lng, y = lat). The pin next to the location
  // opens the in-app map at those coords (or geocodes the place name).
  const _hasXY = (x, y) => x != null && y != null && x !== "" && y !== "";
  const locPin = (name, x, y) => {
    if (!name && !_hasXY(x, y)) return "";
    const coordAttrs = _hasXY(x, y) ? ` data-x="${x}" data-y="${y}"` : "";
    return ` <button type="button" class="rd-loc-pin" data-name="${escape(name || "")}"${coordAttrs} title="${escape(t("companies.viewOnMap"))}" aria-label="${escape(t("companies.viewOnMap"))}">`
      + `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>`
      + `</button>`;
  };
  function bindLocPins(root){
    $$(".rd-loc-pin", root).forEach(btn => {
      btn.addEventListener("click", () => {
        MapPicker.openLocation({
          x: btn.dataset.x != null ? Number(btn.dataset.x) : null,
          y: btn.dataset.y != null ? Number(btn.dataset.y) : null,
          label: btn.dataset.name,
        });
      });
    });
  }

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
        <dt>${k("report.location")}</dt>    <dd>${v(r.company_location)}${locPin(r.company_location, r.company_x, r.company_y)}</dd>
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
    bindLocPins($("#detail-body"));
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
    downloadAuthed(API.url(`/api/report.pdf?rental_id=${id}&lang=${currentLang()}`), `rental_${id}.pdf`);
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
  const showClientDetail = (cr) => openClientDetail(cr);
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

// Authenticated download: a plain anchor can't send the X-Auth-User header
// the server now requires for company-scoped exports, so fetch the file as a
// blob with auth headers and trigger the save from the in-memory object URL.
async function downloadAuthed(url, fallbackName){
  try {
    const r = await fetch(url, { headers: authHeaders() });
    if (!r.ok){
      const err = await r.json().catch(() => ({}));
      toast(err.error || t("toast.error"), "error");
      return;
    }
    // Prefer the server's Content-Disposition filename when present.
    let name = fallbackName || "download";
    const cd = r.headers.get("Content-Disposition") || "";
    const m = /filename="?([^"]+)"?/.exec(cd);
    if (m) name = m[1];
    const blob = await r.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(objUrl); }, 1000);
  } catch (err){
    toast(err.message || t("toast.error"), "error");
  }
}

function currentLang(){
  return (typeof LangStore !== "undefined" && LangStore.get) ? LangStore.get() : "en";
}

function setupReportPdf(){
  $("#btn-export-pdf").addEventListener("click", () => {
    const rows = state.report || [];
    if (!rows.length){ toast(t("table.empty"), "error"); return; }
    downloadAuthed(API.url(`/api/report.pdf?lang=${currentLang()}`), "rental_report.pdf");
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
    const m = $("#map-modal");
    // Full-page in VIEW mode, dialog-sized in PICK mode. This has to be set
    // BEFORE the paint wait: Leaflet measures itself against the laid-out
    // container, so resizing the card afterwards would leave the map sized to
    // the wrong box. Same ordering rule as CarGps.onShow().
    m.classList.toggle("is-view", mode === "view");
    m.hidden = false;
    document.body.classList.add("modal-open");
    await nextPaint();
    ensureMap();
    if (map) map.invalidateSize(true);
  }

  function hide(){
    $("#map-modal").hidden = true;
    document.body.classList.remove("modal-open");
  }

  /* applyI18n() rewrites textContent for every [data-i18n] on a language switch,
     so anything set imperatively here must either own a key or drop the
     attribute — otherwise the next switch silently reverts it. A place name is
     not translatable, hence the literal half. */
  function setI18nKey(el, key){
    if (!el) return;
    el.setAttribute("data-i18n", key);
    el.textContent = t(key);
  }
  function setLiteral(el, text){
    if (!el) return;
    el.removeAttribute("data-i18n");
    el.textContent = text;
  }

  async function openPick(opts = {}){
    mode   = "pick";
    picked = null;
    setI18nKey($("#map-modal .modal-head h3"), "map.title");
    setI18nKey($("#map-cancel"), "map.cancel");
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
    // Nothing is being picked here, so the header names the place instead of
    // prompting for one, and "Cancel" becomes "Close" — there's no pick to
    // abandon. The pin hint is hidden in CSS for the same reason.
    const h3 = $("#map-modal .modal-head h3");
    if (label) setLiteral(h3, label); else setI18nKey(h3, "companies.viewOnMap");
    setI18nKey($("#map-cancel"), "map.close");
    await show();
    if (!map) return;
    placeMarker(y, x, label);
    $("#map-coords").textContent = `${Number(y).toFixed(6)}, ${Number(x).toFixed(6)}`;
    map.setView([y, x], 13);
    $("#map-confirm").style.display = "none";
    setTimeout(() => map.invalidateSize(true), 200);
  }

  // Geocode a place name → {lat, lng} via OpenStreetMap Nominatim. Results are
  // cached per name so repeated clicks don't re-hit the network. Biased to
  // Lebanon (the app's region) so bare city names resolve to the right country.
  const geoCache = new Map();
  async function geocode(name){
    if (!name) return null;
    const key = name.trim().toLowerCase();
    if (geoCache.has(key)) return geoCache.get(key);
    let result = null;
    try {
      const q = encodeURIComponent(`${name}, Lebanon`);
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}`, {
        headers: { "Accept": "application/json" },
      });
      const arr = await res.json();
      if (Array.isArray(arr) && arr.length){
        result = { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon) };
      }
    } catch (e){
      console.error("geocode failed", e);
    }
    geoCache.set(key, result);
    return result;
  }

  // Open the map for a location that may or may not have stored coordinates.
  // With coordinates → show them directly. Without → geocode the name first.
  async function openLocation({ x, y, label }){
    const hasCoords = x != null && y != null && !Number.isNaN(Number(x)) && !Number.isNaN(Number(y));
    if (hasCoords) return openView({ x: Number(x), y: Number(y), label });
    if (!label) { toast(t("companies.locNotFound"), "error"); return; }
    toast(t("companies.locating"), "info");
    const c = await geocode(label);
    if (!c) { toast(t("companies.locNotFound"), "error"); return; }
    return openView({ x: c.lng, y: c.lat, label });
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

  return { setup, openPick, openView, openLocation };
})();

/* ============== CAR GPS / MAP (admin) ==============
   Admin picks a car and sees it on an inline Leaflet map plus a full
   detail panel. Cars don't carry their own live coordinates, so the
   shown position is the car's registered location — the coordinates of
   the company that owns it (companies.x / .y). Cars whose company has no
   coordinates are still selectable; the panel explains there's no point
   to plot. Its own Leaflet instance, separate from the MapPicker modal. */
const CarGps = (() => {
  const CENTER = [33.8547, 35.8623];   // Lebanon
  let map = null, marker = null, selectedVin = null, wired = false;

  // The GPS view works on GPS-equipped cars across ALL companies (fetched with
  // ?gps=1). The model / plate dropdowns narrow that set down to the car(s) the
  // admin wants to locate. Sorted by a stable, readable key (company, model).
  function _cars(){
    const model = $("#cargps-filter-model")?.value || "";
    const plate = $("#cargps-filter-plate")?.value || "";
    let list = (state.cars || []).filter(c => c.has_gps);
    if (model) list = list.filter(c => (c.model || "") === model);
    if (plate) list = list.filter(c => (c.platenumber || "") === plate);
    return list.sort((a, b) => (a.companyname || "").localeCompare(b.companyname || "")
                            || (a.model || "").localeCompare(b.model || ""));
  }

  // Fill the Model / Plate filter dropdowns from the current GPS car set
  // (deduped + sorted + "— All —" via the shared helper).
  function populateFilters(){
    if (typeof populateFilterSelect !== "function") return;
    const base = (state.cars || []).filter(c => c.has_gps);
    populateFilterSelect($("#cargps-filter-model"), base.map(c => c.model));
    populateFilterSelect($("#cargps-filter-plate"), base.map(c => c.platenumber));
  }

  function _companyOf(car){
    if (!car) return null;
    return (state.companies || []).find(co => co.id === car.company_id) || null;
  }

  function _label(c){
    const plate = c.platenumber ? ` · ${c.platenumber}` : "";
    return `${c.companyname} — ${c.model}${plate}`;
  }

  function populate(){
    const sel = $("#cargps-car");
    if (!sel) return;
    const prev = selectedVin;
    const cars = _cars();
    const ph = `<option value="" disabled ${prev ? "" : "selected"} hidden>${escape(t("carGps.placeholder"))}</option>`;
    sel.innerHTML = ph + cars.map(c =>
      `<option value="${escape(c.vin)}" ${c.vin === prev ? "selected" : ""}>${escape(_label(c))}${c.has_gps ? " ✦" : ""}</option>`
    ).join("");
    // SearchSelect (data-ss-prefix) re-syncs on innerHTML mutation, but force a
    // label refresh in case the selected value changed.
    if (sel._ss) sel._ss.sync();
  }

  function ensureMap(){
    if (map || typeof L === "undefined") return;
    map = L.map("cargps-map", { zoomControl: true }).setView(CENTER, 8);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, minZoom: 6,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
  }

  // The rental that currently has this car out (no return logged yet and it
  // has started). Drives the "who's driving it" panel for a tracked car.
  function _activeRentalFor(vin){
    const today = _raToday();
    return (state.report || []).find(r =>
      r.car_vin === vin && !r.returned_at && String(r.start_date).slice(0, 10) <= today
    ) || null;
  }

  // "4 min ago" / "2 h ago" / "3 d ago" from a fix timestamp.
  function _agoText(ts){
    if (!ts) return "";
    const d = new Date(String(ts).replace(" ", "T"));
    if (isNaN(d)) return "";
    const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    if (mins < 60) return `${mins} ${t("carGps.minAgo")}`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} ${t("carGps.hrAgo")}`;
    return `${Math.round(hrs / 24)} ${t("carGps.dayAgo")}`;
  }

  // A distinct, pulsing marker for a live-tracked car vs the plain pin used
  // for a car shown at its registered (company) location.
  function _liveIcon(){
    return L.divIcon({
      className: "car-live-icon",
      html: '<span class="clm-pulse"></span><span class="clm-dot"></span>',
      iconSize: [22, 22], iconAnchor: [11, 11],
    });
  }

  function _detailHtml(ctx){
    const { car, co, live, rental } = ctx;
    const row = (k, v, ltr) => v
      ? `<div class="cgd-row"><dt>${escape(t(k))}</dt><dd${ltr ? ' class="ltr"' : ""}>${escape(v)}</dd></div>`
      : "";
    const gpsPill = car.has_gps
      ? `<span class="status-pill status-active">${escape(t("carGps.gpsOn"))}</span>`
      : `<span class="status-pill status-returned">${escape(t("carGps.gpsOff"))}</span>`;

    // Location banner: live tracking / registered / awaiting signal.
    let banner;
    if (live){
      banner = `<div class="cgd-banner cgd-banner-live">
          <span class="cgd-live-badge"><span class="cgd-live-dot"></span>${escape(t("carGps.live"))}</span>
          <span class="cgd-updated">${escape(t("carGps.updated"))}: ${escape(_agoText(car.gps_updated_at))}</span>
        </div>`;
    } else if (car.has_gps){
      banner = `<div class="cgd-banner cgd-banner-wait">${escape(t("carGps.awaiting"))}</div>`;
    } else {
      banner = `<div class="cgd-banner cgd-banner-reg">${escape(t("carGps.registered"))}</div>`;
    }

    // Rental status.
    const rentalRows = rental
      ? `<div class="cgd-row"><dt>${escape(t("carGps.rentedTo"))}</dt><dd>${escape(rental.client_name)}</dd></div>
         <div class="cgd-row"><dt>${escape(t("report.period"))}</dt><dd class="ltr">${escape(String(rental.start_date).slice(0,10))} → ${escape(String(rental.end_date).slice(0,10))}</dd></div>`
      : `<div class="cgd-row"><dt>${escape(t("carGps.rental"))}</dt><dd class="cgd-idle">${escape(t("carGps.notRented"))}</dd></div>`;

    const plotted = live
      ? `${Number(car.gps_lat).toFixed(5)}, ${Number(car.gps_lng).toFixed(5)}`
      : (co && co.y != null ? `${Number(co.y).toFixed(5)}, ${Number(co.x).toFixed(5)}` : "");

    return `
      <div class="cgd-head">
        <h3>${escape(car.model)}</h3>
        ${gpsPill}
      </div>
      ${banner}
      <dl class="cgd-grid">
        ${rentalRows}
        ${row("report.vehicle", `${car.type || ""}${car.color ? " · " + car.color : ""}`)}
        ${row("report.plate", car.platenumber, true)}
        ${row("report.vin", car.vin, true)}
        ${row("report.company", car.companyname)}
        ${row("report.location", co ? co.location : "", false)}
        ${row("report.cphone", co ? co.phonenumber : "", true)}
        ${row(live ? "carGps.liveCoords" : "carGps.coords", plotted, true)}
      </dl>
      ${(!live && !(co && co.y != null)) ? `<p class="cgd-nocoords">${escape(t("carGps.noCoords"))}</p>` : ""}`;
  }

  function select(vin){
    selectedVin = vin;
    const car = (state.cars || []).find(c => c.vin === vin);
    const detail = $("#cargps-detail");
    if (!car){ if (detail){ detail.hidden = true; } return; }

    const co = _companyOf(car);
    const live = !!(car.has_gps && car.gps_lat != null && car.gps_lng != null
                    && !isNaN(car.gps_lat) && !isNaN(car.gps_lng));
    const hasReg = !!(co && co.x != null && co.y != null && !isNaN(co.x) && !isNaN(co.y));
    const rental = _activeRentalFor(vin);

    if (detail){
      detail.hidden = false;
      detail.innerHTML = _detailHtml({ car, co, live, rental });
    }
    ensureMap();
    const emptyEl = $("#cargps-map-empty");
    if (emptyEl) emptyEl.hidden = true;

    if (map){
      if (marker){ map.removeLayer(marker); marker = null; }
      // Live fix wins; otherwise fall back to the registered company location.
      const pos = live ? [Number(car.gps_lat), Number(car.gps_lng)]
                       : (hasReg ? [Number(co.y), Number(co.x)] : null);
      if (pos){
        const tag = live
          ? `<span class="map-live-tag">● ${escape(t("carGps.live"))}</span>`
          : `<span class="map-reg-tag">${escape(t("carGps.registered"))}</span>`;
        const who = rental ? `<br>${escape(t("carGps.rentedTo"))}: ${escape(rental.client_name)}` : "";
        const popup = `<strong>${escape(car.model)}</strong> · ${escape(car.platenumber || "")}<br>${tag}${who}`;
        marker = (live ? L.marker(pos, { icon: _liveIcon() }) : L.marker(pos)).addTo(map)
          .bindPopup(popup).openPopup();
        map.setView(pos, live ? 14 : 13);
      } else {
        map.setView(CENTER, 8);
      }
      setTimeout(() => map.invalidateSize(true), 60);
    }
  }

  // Called whenever the tab becomes visible: (re)populate from the freshest
  // car/company data and size the map.
  async function onShow(){
    // The GPS map only wants GPS-equipped cars, from every company. The cars
    // table loads pages, so state.cars may be a slice — refetch just the GPS
    // fleet (server-side ?gps=1 keeps the payload small) before populating.
    try { state.cars = await API.listGpsCars(); } catch (e){ /* keep whatever we have */ }
    populateFilters();
    populate();
    ensureMap();
    if (map) setTimeout(() => map.invalidateSize(true), 80);
  }

  function setup(){
    if (wired) return;
    wired = true;
    const sel = $("#cargps-car");
    sel?.addEventListener("change", () => { if (sel.value) select(sel.value); });
    // Model / plate filters narrow the picker; keep the current pick if it
    // survives the new filter, otherwise clear the map + detail panel.
    const reFilter = () => {
      const keep = selectedVin && _cars().some(c => c.vin === selectedVin) ? selectedVin : null;
      selectedVin = keep;
      populate();
      if (!keep){
        const d = $("#cargps-detail"); if (d) d.hidden = true;
        const e = $("#cargps-map-empty"); if (e) e.hidden = false;
        if (marker && map){ map.removeLayer(marker); marker = null; }
      }
    };
    $("#cargps-filter-model")?.addEventListener("change", reFilter);
    $("#cargps-filter-plate")?.addEventListener("change", reFilter);
    document.addEventListener("lang:changed", () => {
      populate();
      if (selectedVin) select(selectedVin);
    });
  }

  return { setup, onShow, populate };
})();

/* ============== RESERVATIONS — retired (migration 040) ==============
   A reservation was only ever a rental that hadn't started yet, so the whole
   module (calendar, list, admin table, detail modal, create form) is gone. A
   future booking is now a rental with status "pending", created and moved from
   the Cars & Rentals hub — see CarsHub.renderIndividuals / setRentalStatus.
   The public /api/reservations/* endpoints still exist for API clients. */

/* ============== CONTACT SUPPORT ============== */
function setupSupportForm(){
  const form = $("#form-support");
  if (!form) return;

  const MAX_BYTES = 50 * 1024 * 1024; // 50 MB per image
  const fileInput = $("#support-screenshot");
  const dropzone  = $("#support-dropzone");
  const previews  = $("#support-previews");

  // We can't mutate a file <input>'s FileList directly, so keep our own list.
  let selected = [];

  function renderPreviews(){
    if (!previews) return;
    previews.innerHTML = "";
    selected.forEach((f, idx) => {
      const cell = document.createElement("div");
      cell.className = "support-preview";

      const img = document.createElement("img");
      img.src = URL.createObjectURL(f);
      img.onload = () => URL.revokeObjectURL(img.src);
      img.alt = f.name;

      const name = document.createElement("span");
      name.className = "support-preview-name";
      name.textContent = f.name;

      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "support-preview-remove";
      rm.setAttribute("aria-label", "Remove");
      rm.textContent = "×";
      rm.addEventListener("click", () => {
        selected.splice(idx, 1);
        renderPreviews();
      });

      cell.append(img, name, rm);
      previews.appendChild(cell);
    });
  }

  function addFiles(fileList){
    Array.from(fileList || []).forEach((f) => {
      if (!f.type.startsWith("image/")){
        toast(t("support.errType"), "error");
        return;
      }
      if (f.size > MAX_BYTES){
        toast(t("support.errSize"), "error");
        return;
      }
      // Skip exact duplicates (same name + size).
      if (selected.some((s) => s.name === f.name && s.size === f.size)) return;
      selected.push(f);
    });
    renderPreviews();
  }

  if (fileInput){
    fileInput.addEventListener("change", () => {
      addFiles(fileInput.files);
      fileInput.value = ""; // allow re-selecting the same file
    });
  }

  if (dropzone){
    dropzone.addEventListener("click", () => fileInput?.click());
    dropzone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " "){ e.preventDefault(); fileInput?.click(); }
    });
    ["dragenter", "dragover"].forEach((ev) =>
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.add("is-dragover");
      })
    );
    ["dragleave", "dragend", "drop"].forEach((ev) =>
      dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.remove("is-dragover");
      })
    );
    dropzone.addEventListener("drop", (e) => {
      if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
    });
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = (form.querySelector('[name="message"]')?.value || "").trim();
    if (!message){
      toast(t("support.error"), "error");
      return;
    }
    const fd = new FormData();
    fd.append("message", message);
    fd.append("email", form.querySelector('[name="email"]')?.value || "");
    selected.forEach((f) => fd.append("screenshot", f));

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
      selected = [];
      renderPreviews();
      toast(t("support.sent"), "success");
    } catch (err){
      toast(err.message || t("toast.error"), "error");
    }
  });
}

/* ============== INIT ============== */
/* ============== NOTIFICATIONS (company login alerts) ==============
   A single bell in the header. On login it pulls /api/company/alerts — cars
   due back today or overdue (both individual + B2B rentals) and reservations
   starting today — badges the count, and pops a summary panel so the owner
   sees what needs attention the moment they sign in. The bell reopens it. */
const Notifications = (() => {
  let _data = null;         // last fetched alerts payload
  let _autoShown = false;   // guard so login only auto-opens the panel once

  function _count(){
    if (!_data) return 0;
    const rd = _data.returns_due || {}, rt = _data.reservations_today || {};
    return (rd.total || 0) + (rt.count || 0);
  }

  function _renderBadge(){
    const bell = $("#btn-notifications"), badge = $("#notif-badge");
    if (!bell || !badge) return;
    const u = AUTH.user();
    const isCompany = !!(u && u.role === "company");
    bell.hidden = !isCompany;
    if (!isCompany){ badge.hidden = true; return; }
    const n = _count();
    if (n > 0){
      badge.hidden = false;
      badge.textContent = n > 99 ? "99+" : String(n);
      bell.classList.add("has-alerts");
    } else {
      badge.hidden = true;
      bell.classList.remove("has-alerts");
    }
  }

  function _carLabel(it){
    const m = it.car_model || "", p = it.car_plate || "";
    return p ? `${m} — ${p}` : (m || it.car_vin || "");
  }

  function _returnItemHtml(it){
    const end = it.end_date ? String(it.end_date).slice(0, 10) : "";
    // Trust the server's overdue flag (its clock decided "today"), so the
    // badge can't disagree with the counts just because the browser's date
    // or timezone differs.
    const overdue = !!it.overdue;
    const badge = overdue
      ? `<span class="return-badge overdue">${escape(t("returns.overdue"))}</span>`
      : `<span class="return-badge today">${escape(t("returns.dueToday"))}</span>`;
    const ico = it.kind === "company" ? "🏢" : "👤";
    const who = it.who || "";
    // The car can be sent back to the office right from the alert: this opens
    // the branch picker, then POSTs the return (individual vs B2B endpoint).
    return `<li class="alert-item">
      <span class="alert-item-ico">${ico}</span>
      <span class="alert-item-main">
        <span class="alert-item-title">${escape(who)}</span>
        <span class="alert-item-sub">${escape(_carLabel(it))}${end ? " · " + escape(end) : ""}</span>
      </span>
      ${badge}
      <button type="button" class="alert-return-btn"
              data-ret-kind="${escape(it.kind || "individual")}"
              data-ret-id="${escape(String(it.id))}"
              data-ret-label="${escape(_carLabel(it))}">${escape(t("returns.backToOffice"))}</button>
    </li>`;
  }

  // Send a car back to the office from the alert list: pick the branch, POST
  // the return to the right endpoint, then refresh everything that shows it.
  async function _returnFromAlert(kind, id, label){
    const pick = await pickReturnBranch(label || "");
    if (pick === null) return;   // cancelled
    const path = kind === "company"
      ? `/api/special-rentals/${id}/return`
      : `/api/rentals/${id}/return`;
    try {
      const r = await fetch(API.url(path), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ return_branch_id: pick.branchId }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok){ toast(data.error || t("toast.error"), "error"); return; }
      toast(t("returns.returned"), "success");
      await refresh();                                   // this module (bell + modal)
      if (typeof Returns !== "undefined") Returns.refresh();
      if (typeof ReturnDue !== "undefined") ReturnDue.refresh();
      if (typeof SpecialRentals !== "undefined" && SpecialRentals.refresh) SpecialRentals.refresh();
    } catch (err){ toast(err.message || t("toast.error"), "error"); }
  }

  function _resItemHtml(it){
    const phone = it.client_phone
      ? `<a href="tel:${escape(it.client_phone)}" class="ltr">${escape(it.client_phone)}</a>` : "";
    const span = [it.start_date, it.end_date].filter(Boolean).map(d => String(d).slice(0,10)).join(" → ");
    const badge = it.late
      ? `<span class="return-badge overdue">${escape(t("alerts.res.late"))}</span>`
      : `<span class="return-badge today">${escape(t("alerts.res.badge"))}</span>`;
    return `<li class="alert-item">
      <span class="alert-item-ico">📅</span>
      <span class="alert-item-main">
        <span class="alert-item-title">${escape(it.client_name || "")}</span>
        <span class="alert-item-sub">${escape(_carLabel(it))}${span ? " · " + escape(span) : ""}${phone ? " · " + phone : ""}</span>
      </span>
      ${badge}
    </li>`;
  }

  function _renderModal(){
    const rd = (_data && _data.returns_due) || { items: [], overdue: 0, today: 0, total: 0 };
    const rt = (_data && _data.reservations_today) || { items: [], count: 0 };
    const retBlock = $("#alert-block-returns"), resBlock = $("#alert-block-reservations");
    const retList = $("#alerts-returns-list"), resList = $("#alerts-res-list");
    const retSub = $("#alerts-returns-sub"), resSub = $("#alerts-res-sub");
    const emptyEl = $("#alerts-empty");

    if (retList){
      retList.innerHTML = (rd.items || []).map(_returnItemHtml).join("");
      retList.querySelectorAll(".alert-return-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          _returnFromAlert(btn.dataset.retKind, btn.dataset.retId, btn.dataset.retLabel);
        });
      });
    }
    if (retSub){
      const parts = [];
      if (rd.overdue) parts.push(t("alerts.returns.overdue").replace("{n}", rd.overdue));
      if (rd.today)   parts.push(t("alerts.returns.today").replace("{n}", rd.today));
      retSub.textContent = parts.join(" · ") || t("alerts.returns.none");
    }
    if (retBlock) retBlock.hidden = !(rd.total > 0);

    if (resList) resList.innerHTML = (rt.items || []).map(_resItemHtml).join("");
    if (resSub)  resSub.textContent = rt.count
      ? t("alerts.res.count").replace("{n}", rt.count) : t("alerts.res.none");
    if (resBlock) resBlock.hidden = !(rt.count > 0);

    if (emptyEl) emptyEl.hidden = _count() > 0;
    if (typeof applyTranslations === "function") applyTranslations();
  }

  async function refresh(){
    const u = AUTH.user();
    if (!u || u.role !== "company"){ _data = null; _renderBadge(); return; }
    try {
      const r = await fetch(API.url("/api/company/alerts"), { headers: authHeaders() });
      _data = r.ok ? await r.json() : null;
    } catch (e){ _data = null; }
    _renderBadge();
    _renderModal();
  }

  function open(){
    if (!_data) return;
    _renderModal();
    showModal("#company-alerts-modal");
  }

  // Called right after login: open the panel once if anything needs attention.
  function maybeAutoShow(){
    if (_autoShown) return;
    _autoShown = true;
    if (_count() > 0) open();
  }

  function reset(){ _data = null; _autoShown = false; _renderBadge(); }

  function setup(){
    $("#btn-notifications")?.addEventListener("click", open);
    $("#alerts-close")?.addEventListener("click", () => hideModal("#company-alerts-modal"));
    $("#alerts-dismiss")?.addEventListener("click", () => hideModal("#company-alerts-modal"));
    // Jump buttons close the panel and navigate to the relevant tab.
    $$("#company-alerts-modal .alert-jump").forEach(btn => {
      btn.addEventListener("click", () => {
        hideModal("#company-alerts-modal");
        if (typeof showCompanyPanel === "function") showCompanyPanel(btn.dataset.alertGo);
        // Some targets are a view inside a panel (the Cars hub's three tables),
        // so land on the right one rather than the panel's default.
        const view = btn.dataset.alertView;
        if (view && typeof CarsHub !== "undefined") CarsHub.show(view);
      });
    });
  }

  return { refresh, open, maybeAutoShow, reset, setup };
})();

async function loadAllData(){
  try{
    const u = AUTH.user();
    if (u && u.role === "company"){
      await Promise.all([
        refreshReport(),
        loadCompanyInfo(),
        refreshRentalPickers(),
        Notifications.refresh(),
      ]);
      // Report is now loaded — paint the home "Return Due" widget.
      if (typeof ReturnDue !== "undefined") ReturnDue.render();
    } else {
      await Promise.all([
        refreshCompanies(), refreshCars(), refreshClients(),
        refreshBranches(), refreshReport(),
      ]);
      updateStatsDashboard();
      loadInactiveAlerts();
      loadDashboardActivity();
      AuditLog.populateCompanies();
      AuditLog.load();
      AuditLog.loadStats();
      updateUploadHint();
    }
  } catch (err){
    console.error(err);
    toast("Backend not reachable — start the Flask server.", "error");
  }
}

/* Mobile nav drawer: the header hamburger slides the role sidebar in/out on
   phones. A backdrop dims the page; tapping it, picking a destination, or
   pressing Escape closes the drawer. Inert on desktop/iPad (the hamburger is
   hidden by CSS, so `nav-open` is never set there). */
function setupMobileNav(){
  const toggle   = $("#mobile-nav-toggle");
  const backdrop = $("#mobile-nav-backdrop");
  if (!toggle) return;

  const isOpen = () => document.body.classList.contains("nav-open");
  const open = () => {
    if (backdrop) backdrop.hidden = false;
    document.body.classList.add("nav-open");
    toggle.setAttribute("aria-expanded", "true");
  };
  const close = () => {
    document.body.classList.remove("nav-open");
    toggle.setAttribute("aria-expanded", "false");
    // Let the fade-out animation finish before removing the backdrop.
    if (backdrop) setTimeout(() => { if (!isOpen()) backdrop.hidden = true; }, 320);
  };

  toggle.addEventListener("click", () => (isOpen() ? close() : open()));
  if (backdrop) backdrop.addEventListener("click", close);

  // Choosing a destination in the drawer closes it.
  document.addEventListener("click", (e) => {
    if (isOpen() && e.target.closest(".sidebar-btn")) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) close();
  });
}

/* Responsive tables: on phones every table is shown as a stack of cards
   (one per row). For that the CSS needs each <td> to know its column name,
   so we copy the matching <th> text onto each cell as data-label. This runs
   generically for every table — no per-render wiring — by watching each
   <tbody> for changes and re-labeling, plus a pass on language switches. */
function setupResponsiveTables(){
  const labelTable = (table) => {
    const heads = $$("thead th", table).map(th => th.textContent.trim());
    if (!heads.length) return;
    $$("tbody tr", table).forEach(tr => {
      if (tr.classList.contains("empty-row")) return;
      Array.from(tr.children).forEach((td, i) => {
        if (td.tagName === "TD" && heads[i]) td.setAttribute("data-label", heads[i]);
      });
    });
  };
  const tables = $$("table");
  tables.forEach(table => {
    labelTable(table);
    const tb = table.tBodies[0];
    if (!tb) return;
    new MutationObserver(() => labelTable(table)).observe(tb, { childList: true });
  });
  // Header text changes with language — re-label after the re-render settles.
  document.addEventListener("lang:changed", () => {
    setTimeout(() => tables.forEach(labelTable), 0);
  });
}

/* ============== BOOKING STATUS PICKER ==============
   The status column of the two "rented by" tables is the control, not just a
   read-out: the pill IS a <select>, so pending / active / cancelled is one pick
   away with no extra column of buttons widening the table. It keeps the pill
   shape of the badges it sits with, so the column still scans at a glance.

   `extra` is the date-derived badge (Overdue / Due today) — only an ACTIVE
   booking has one, and it sits under the pill so the column stays narrow. A
   settled (returned) booking gets a plain badge instead: the server refuses to
   move it, so offering the choice would only invite a rejection. */
const BOOKING_STATUSES = ["pending", "active", "cancelled"];

function statusPicker(status, dataAttrs, extra = ""){
  const st = BOOKING_STATUSES.includes(status) ? status : "active";
  const opts = BOOKING_STATUSES.map(s =>
    `<option value="${s}"${s === st ? " selected" : ""}>${escape(t("status." + s + ".short"))}</option>`
  ).join("");
  // data-ss-skip keeps SearchSelect off these — a native select drops its menu
  // over the table instead of expanding a search box inside the cell. The
  // wrapper is a plain span, not a label: the select is its only child and so
  // covers the whole pill (caret included), leaving a label nothing to forward.
  return `<div class="status-cell">
    <span class="status-pick ${st}">
      <select class="status-pick-sel" data-ss-skip ${dataAttrs}
              aria-label="${escape(t("status.label"))}">${opts}</select>
    </span>${extra}
  </div>`;
}

/* ---- The admin's read-only twin of statusPicker ------------------------
   A booking belongs to the company that took it: the company user moves it
   between pending / active / cancelled from its own Cars & Rentals tables, and
   the admin READS the result across every company. So the admin's three tables
   render this instead of the picker — same three tints, same place in the row,
   no caret and no <select>.

   That rule is enforced on the server too, not just by leaving the control out:
   /api/special-rentals/<id>/status is company-only (`_require_company_user`).
   Hiding a control the API would still honour isn't a permission, it's a
   suggestion.

   `extra` is the date-derived Overdue badge, which is orthogonal to the booking
   state — it sits under the tag exactly as it does under the picker, so the two
   roles' tables stay the same shape. Do NOT pass "Returned" in here: a settled
   booking has no state to show beside it, so callers branch and render that
   badge alone. Only an ACTIVE booking can be overdue in the first place. */
function statusTag(status, extra = ""){
  const st = BOOKING_STATUSES.includes(status) ? status : "active";
  return `<div class="status-cell">
    <span class="status-tag ${st}">${escape(t("status." + st + ".short"))}</span>${extra}
  </div>`;
}

/* ============== SPECIAL-COMPANY RENTALS (B2B) ==============
   The enterprise records another company it rents its own cars OUT to: that
   company's contact details (many phones + many branches, each with a "+"),
   plus a searchable dropdown per car it currently holds. The recorded list
   shows the full car detail. */
/* ============== CARS HUB (company: the "Cars & Rentals" panel) ==============
   One panel, three tables: the fleet, the cars out with individual clients,
   and the cars out with other companies (B2B). Data entry happens in modals
   raised from here — "Add car" opens the car form; "Car rented" first asks
   who's renting (individual or company) and then opens that form, switching
   the table underneath to match. The B2B table/filters and the create-rental
   form used to live in their own panels; only their host moved, so the
   SpecialRentals / create-rental wiring still finds them by id. */
/* ============== COMPANY PLATES POOL (Fleet & Rentals ▸ Plates tab) ====
   The company's own plate numbers, managed independently of its cars. A
   rental / B2B record picks WHICH of these plates the car is on. */
const CompanyPlates = (() => {
  let _plates = [];   // the company's plate pool: {id, plate, icon, number}

  function getPlates(){ return _plates; }
  function count(){ return _plates.length; }

  const setStatus = (msg, kind) => {
    const el = $("#add-plate-status");
    if (!el) return;
    if (!msg){ el.hidden = true; el.textContent = ""; return; }
    el.hidden = false;
    el.className = "company-info-status" + (kind ? " " + kind : "");
    el.textContent = msg;
  };

  function render(){
    const cnt = $("#hub-count-plates");
    if (cnt) cnt.textContent = _plates.length;
    const tb = $("#company-plates-rows");
    if (!tb) return;
    if (!_plates.length){
      tb.innerHTML = `<tr class="empty-row"><td colspan="3">${escape(t("plates.empty"))}</td></tr>`;
      return;
    }
    const lbl = (k) => escape(t(k));
    tb.innerHTML = _plates.map(p => `<tr>
        <td data-label="${lbl("plates.th.code")}"><span class="ltr">${escape(p.icon || "")}</span></td>
        <td data-label="${lbl("plates.th.number")}"><span class="ltr">${escape(p.number || "")}</span></td>
        <td data-col="view"><div class="row-actions">
          <button type="button" class="row-btn plate-del" data-id="${p.id}"
                  title="${escape(t("action.remove"))}" aria-label="${escape(t("action.remove"))}">✕</button>
        </div></td>
      </tr>`).join("");
  }

  async function refresh(){
    const u = (typeof AUTH !== "undefined") ? AUTH.user() : null;
    if (!u || u.role !== "company"){ _plates = []; render(); return; }
    try { _plates = await API.listPlates(); } catch (e){ _plates = []; }
    if (!Array.isArray(_plates)) _plates = [];
    render();
  }

  async function addFromForm(e){
    e.preventDefault();
    const form = e.target;
    clearAllFieldErrors(form);
    setStatus("");
    const icon = ($("#plate-code")?.value || "").trim().toUpperCase();
    const num  = ($("#plate-number")?.value || "").trim();
    let bad = false;
    if (!icon){ setFieldError(form, "plate_icon", t("field.required")); bad = true; }
    if (!num){ setFieldError(form, "plate_number", t("field.required")); bad = true; }
    else if (!/^[0-9]{1,7}$/.test(num)){ setFieldError(form, "plate_number", t("plateModal.numFormat")); bad = true; }
    if (bad) return;
    try {
      await API.addPlate({ icon, number: num });
      form.reset();
      const cs = $("#plate-code"); if (cs){ cs.value = ""; if (cs._ss) cs._ss.sync(); }
      toast(t("plates.added"), "success");
      await refresh();
      refreshRentalPickers?.();   // the rental plate dropdowns read the pool
    } catch (err){
      const msg = err.message || t("toast.error");
      setFieldError(form, "plate_number", msg);
      setStatus(msg, "error");
    }
  }

  async function del(id){
    if (!id) return;
    try {
      const r = await API.delPlate(id);
      if (r && !r.ok && r.status !== 204){
        const d = await r.json().catch(() => ({}));
        toast(d.error || t("toast.error"), "error"); return;
      }
      toast(t("plates.removed"), "success");
      await refresh();
      refreshRentalPickers?.();
    } catch (err){ toast(err.message || t("toast.error"), "error"); }
  }

  function setup(){
    if (!$("#company-cars")) return;
    fillStaticSelect($("#plate-code"), PLATE_ICONS);
    $("#form-add-plate")?.addEventListener("submit", addFromForm);
    $("#company-plates-rows")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".plate-del");
      if (btn) del(btn.dataset.id);
    });
  }

  return { setup, refresh, render, count, getPlates };
})();

const CarsHub = (() => {
  const VIEWS = ["fleet", "individual", "company", "plates"];
  let _view = "fleet";

  /* ---- The individuals table: this company's client rentals ---- */

  // Rows = the shared report feed, scoped to the signed-in company, then
  // narrowed by this view's own toolbar (kept separate from the Report tab's
  // filters so the two don't fight over one another's state).
  function individualRows(){
    const u = (typeof AUTH !== "undefined") ? AUTH.user() : null;
    if (!u || u.role !== "company") return [];
    let rows = (state.report || []).filter(r => Number(r.company_id) === Number(u.company_id));
    // Client and car are dropdown picks, not free text, so they match exactly —
    // the options are built from these same rows (see refreshFilterDropdowns),
    // so a pick can never fall through to nothing.
    const client = $("#filter-ind-client")?.value || "";
    const car    = $("#filter-ind-car")?.value    || "";
    const from   = ($("#filter-ind-from")?.value  || "").trim();
    const to     = ($("#filter-ind-to")?.value    || "").trim();
    if (client) rows = rows.filter(r => r.client_name === client);
    if (car)    rows = rows.filter(r => carLabel(r) === car);
    // Same overlap rule as the reports: From keeps rentals still running on or
    // after it; To keeps those that had started by it.
    if (from) rows = rows.filter(r => r.end_date   && String(r.end_date).slice(0, 10)   >= from);
    if (to)   rows = rows.filter(r => r.start_date && String(r.start_date).slice(0, 10) <= to);
    // Newest first — the rental you just recorded lands at the top.
    return rows.sort((a, b) => String(b.start_date || "").localeCompare(String(a.start_date || "")));
  }

  function renderIndividuals(){
    const tb = $("#rented-individual-rows");
    if (!tb) return;
    const all  = individualRows();
    const cnt  = $("#hub-count-individual");
    if (cnt) cnt.textContent = all.length;
    if (!all.length){
      tb.innerHTML = `<tr class="empty-row"><td colspan="6">${escape(t("carsHub.ind.empty"))}</td></tr>`;
      return;
    }
    const today = _raToday();
    const ltr  = (v) => `<span class="ltr">${escape(v)}</span>`;
    const dash = `<span class="cell-dash">—</span>`;
    const day  = (d) => d ? ltr(String(d).slice(0, 10)) : dash;
    // Card mode (721–1024px) hides the <thead>, so data-label is a cell's only
    // label — and merged cells make that matter more, not less.
    const lbl  = (k) => escape(t(k));

    tb.innerHTML = all.map((r, i) => {
      // The status cell is a picker. A returned booking is settled — the server
      // won't move it — so that one stays a plain badge. Only an ACTIVE booking
      // also carries its date-derived state (Overdue), since a pending or
      // cancelled booking has no car out to be overdue.
      const bs = r.status || "active";
      let status;
      if (r.returned_at){
        status = `<span class="return-badge returned">${escape(t("special.status.returned"))}</span>`;
      } else {
        const overdue = bs === "active" && _raStatus(r, today) === "overdue"
          ? `<span class="return-badge overdue">${escape(t("returns.overdue"))}</span>` : "";
        status = statusPicker(bs, `data-rental="${r.rental_id}"`, overdue);
      }
      const gps = r.car_has_gps
        ? `<span class="badge yes">${escape(t("yes"))}</span>`
        : `<span class="badge no">${escape(t("no"))}</span>`;
      // WHO has it: the client leads, their phone is the supporting line.
      // Two former columns, one cell, one thing described.
      const phoneHtml = r.client_phone
        ? `<a href="tel:${escape(r.client_phone)}" class="ltr">${escape(r.client_phone)}</a>` : "";
      const clientCell = `<div class="sr-stack">
          <span class="sr-main">${r.client_name ? escape(r.client_name) : dash}</span>
          ${phoneHtml ? `<span class="sr-sub">${phoneHtml}</span>` : ""}
        </div>`;

      // WHAT they took: model leads; plate + colour say which one.
      const vSub = [
        r.car_plate ? `<span class="sr-plate ltr">${escape(r.car_plate)}</span>` : "",
        r.car_color ? formatColorCell(r.car_color) : "",
      ].filter(Boolean).join(`<span class="sr-dot">·</span>`);
      const vehicleCell = r.car_model || r.car_plate
        ? `<div class="sr-stack">
             <span class="sr-main">${r.car_model ? escape(r.car_model) : dash}</span>
             ${vSub ? `<span class="sr-sub">${vSub}</span>` : ""}
           </div>`
        : dash;

      // WHEN: one span reads as a period; two columns read as two facts.
      const period = `${day(r.start_date)}<span class="rp-arrow">→</span>${day(r.end_date)}`;

      return `<tr data-ind-row="${i}" class="report-row${bs === "cancelled" ? " booking-cancelled-row" : ""}">
        <td data-col="client"  data-label="${lbl("report.client")}">${clientCell}</td>
        <td data-col="vehicle" data-label="${lbl("report.vehicle")}">${vehicleCell}</td>
        <td data-col="period"  data-label="${lbl("report.period")}">${period}</td>
        <td data-col="gps"     data-label="${lbl("report.gps")}">${gps}</td>
        <td data-col="status"  data-label="${lbl("report.status")}">${status}</td>
        <td data-col="view"><div class="row-actions">
          <button type="button" class="row-btn ind-view" data-ind-detail="${i}"
                  title="${escape(t("action.view"))}" aria-label="${escape(t("action.view"))}">${ROW_MORE_ICO}</button>
        </div></td>
      </tr>`;
    }).join("");

    // Row (or 👁) opens the shared Detail modal — same photos / video / extra
    // drivers the Report tab shows. Clicks that land on a button or the status
    // picker belong to that control: this listener sits ON the row, so it runs
    // BEFORE any delegated handler on the tbody and a stopPropagation() up
    // there can't hold it back.
    $$("tr[data-ind-row]", tb).forEach(tr => {
      tr.addEventListener("click", (e) => {
        if (e.target.closest("button, .status-pick")) return;
        Detail.open(all[Number(tr.dataset.indRow)]);
      });
    });
  }

  /* ---- Counts on the tabs ---- */
  function setCount(sel, n){ const el = $(sel); if (el) el.textContent = n; }

  // Fleet and B2B counts are read from whoever owns that data; the individual
  // count is set by renderIndividuals as it paints. Re-read on every view
  // change so a save on one tab can't leave another tab's badge stale.
  function syncCounts(){
    const fleetRows = $$("#my-cars-rows tr").filter(tr => !tr.querySelector(".empty-cell"));
    setCount("#hub-count-fleet", fleetRows.length);
    setCount("#hub-count-company", SpecialRentals.count());
    setCount("#hub-count-plates", CompanyPlates.count());
  }

  /* ---- View switching ---- */
  function show(view){
    if (!VIEWS.includes(view)) view = "fleet";
    _view = view;
    $$("#company-cars .hub-view").forEach(v => {
      v.hidden = v.dataset.carviewPanel !== view;
    });
    $$("#company-cars .hub-tab").forEach(b => {
      const on = b.dataset.carview === view;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    syncCounts();
    if (view === "individual") renderIndividuals();
    // The B2B list is only fetched on demand — recount once it lands.
    if (view === "company") Promise.resolve(SpecialRentals.refresh()).then(syncCounts);
    // The plates pool is loaded on demand too.
    if (view === "plates") Promise.resolve(CompanyPlates.refresh()).then(syncCounts);
  }

  // Called when the panel opens: pull whatever each table needs, then repaint
  // the current view.
  async function refresh(){
    const u = (typeof AUTH !== "undefined") ? AUTH.user() : null;
    if (!u || u.role !== "company") return;
    await Promise.all([
      (async () => { try { await refreshReport(); } catch (e){} })(),
      (async () => { try { await SpecialRentals.refresh(); } catch (e){} })(),
      (async () => { try { await CompanyPlates.refresh(); } catch (e){} })(),
    ]);
    renderIndividuals();
    show(_view);
  }

  function setup(){
    if (!$("#company-cars")) return;

    // Primary actions.
    $("#btn-open-add-car")?.addEventListener("click", () => window.openAddCarModal?.());
    $("#btn-open-rented") ?.addEventListener("click", () => showModal("#car-rented-modal"));

    // Add-car modal chrome (the form's own wiring lives in setupAddCarForm).
    $("#add-car-modal-close")?.addEventListener("click", () => hideModal("#add-car-modal"));

    // "Car rented" → who's renting? Each pick closes the chooser, switches the
    // table behind it, and opens that kind's data-entry modal.
    $("#car-rented-close")?.addEventListener("click", () => hideModal("#car-rented-modal"));
    $$("#car-rented-modal [data-rented-kind]").forEach(btn => {
      btn.addEventListener("click", () => {
        const kind = btn.dataset.rentedKind;
        hideModal("#car-rented-modal");
        show(kind);
        if (kind === "individual") openIndividualModal();
        else SpecialRentals.openAdd();
      });
    });

    // Per-view "add another" buttons.
    $("#btn-new-individual-rental")?.addEventListener("click", openIndividualModal);
    $("#btn-new-special-rental")?.addEventListener("click", () => SpecialRentals.openAdd());
    $("#individual-rental-close")?.addEventListener("click", () => hideModal("#individual-rental-modal"));

    // Tabs.
    $$("#company-cars .hub-tab").forEach(b => {
      b.addEventListener("click", () => show(b.dataset.carview));
    });

    // The Plates tab's own form + table wiring.
    CompanyPlates.setup();

    // Individuals toolbar — re-renders the loaded rows, no re-fetch. The two
    // pickers only ever fire `change` (SearchSelect dispatches it on choose);
    // the date inputs also fire `input` as they're typed into.
    ["#filter-ind-client", "#filter-ind-car"].forEach(sel => {
      $(sel)?.addEventListener("change", renderIndividuals);
    });
    ["#filter-ind-from", "#filter-ind-to"].forEach(sel => {
      $(sel)?.addEventListener("input",  renderIndividuals);
      $(sel)?.addEventListener("change", renderIndividuals);
    });
    $("#filter-ind-reset")?.addEventListener("click", () => {
      // A picker resets through clearFilterSelect — blanking .value alone would
      // leave the SearchSelect trigger showing the old pick.
      clearFilterSelect($("#filter-ind-client"));
      clearFilterSelect($("#filter-ind-car"));
      ["#filter-ind-from", "#filter-ind-to"].forEach(sel => {
        const el = $(sel); if (el) el.value = "";
      });
      renderIndividuals();
    });

    // 👁 opens the detail modal. It must stop the event — the row itself also
    // opens the detail modal.
    $("#rented-individual-rows")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".ind-view");
      if (!btn) return;
      e.stopPropagation();
      const rows = individualRows();
      const rec = rows[Number(btn.dataset.indDetail)];
      if (rec) Detail.open(rec);
    });

    // Picking a status in the table moves the booking.
    $("#rented-individual-rows")?.addEventListener("change", (e) => {
      const sel = e.target.closest(".status-pick-sel");
      if (!sel) return;
      setRentalStatus(sel.dataset.rental, sel.value);
    });

    // Esc closes whichever of this panel's modals is on top.
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      ["#add-car-modal", "#car-rented-modal", "#individual-rental-modal", "#special-rental-modal"]
        .forEach(sel => { const m = $(sel); if (m && !m.hidden) hideModal(sel); });
    });
  }

  // Move a booking between pending / active / cancelled. The server re-checks
  // overlap when a booking reclaims a car, so a 409 here is a real clash — and
  // a rejected move must repaint, or the picker would keep showing the status
  // the server just refused.
  async function setRentalStatus(rentalId, to){
    if (!rentalId || !to) return;
    try {
      const r = await fetch(API.url(`/api/rentals/${rentalId}/status`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ status: to }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok){ toast(data.error || t("toast.error"), "error"); renderIndividuals(); return; }
      toast(t("status.moved").replace("{status}", t("status." + to + ".short")), "success");
      await refreshReport();
      renderIndividuals();
      if (typeof Notifications !== "undefined") Notifications.refresh();
    } catch (err){
      toast(err.message || t("toast.error"), "error");
      renderIndividuals();
    }
  }

  // Blank the create-rental form, refresh its pickers (cars/clients added on
  // other tabs), then raise it.
  function openIndividualModal(){
    const form = $("#form-create-rental");
    if (form){
      form.reset();
      clearAllFieldErrors(form);
    }
    // form.reset() restores the select's first option (Active) but leaves the
    // SearchSelect trigger showing whatever was picked last — sync repaints it.
    const st = $("#rental-status");
    if (st){ st.value = "active"; st._ss?.sync?.(); }
    hideCreateRentalStatus();
    refreshRentalPickers();
    showModal("#individual-rental-modal");
  }

  return { setup, refresh, show, renderIndividuals };
})();

const SpecialRentals = (() => {
  let _cars = [];      // the enterprise's own cars (VIN → full detail)
  let _records = [];   // saved special-company records
  let _editId = null;  // id of the record being edited (null = add mode)

  const setStatus = (msg, kind) => {
    const el = $("#special-status");
    if (!el) return;
    if (!msg){ el.hidden = true; el.textContent = ""; return; }
    el.hidden = false;
    el.className = "company-info-status" + (kind ? " " + kind : "");
    el.textContent = msg;
  };

  function carLabel(c){
    // "Model — Plate (Type · Color) · VIN"
    const bits = [];
    if (c.model) bits.push(c.model);
    const meta = [c.type, c.color].filter(Boolean).join(" · ");
    let head = bits.join("");
    if (c.platenumber) head += ` — ${c.platenumber}`;
    if (meta) head += ` (${meta})`;
    if (c.vin) head += ` · ${c.vin}`;
    return head;
  }

  /* ---- Branches: a repeatable text-input list with "+ Add branch" ---- */
  function branchRowHtml(value = ""){
    return `<div class="special-branch-row">
      <input type="text" class="special-branch-input" value="${escape(value)}" placeholder="${escape(t("special.f.branch.ph"))}">
      <button type="button" class="phone-remove special-branch-remove" aria-label="Remove">&times;</button>
    </div>`;
  }
  function setBranches(csv){
    const c = $("#special-branches");
    if (!c) return;
    const list = String(csv || "").split(",").map(s => s.trim()).filter(Boolean);
    if (!list.length) list.push("");
    c.innerHTML = list.map(branchRowHtml).join("");
  }
  function getBranches(){
    const c = $("#special-branches");
    if (!c) return "";
    return $$(".special-branch-input", c).map(i => i.value.trim()).filter(Boolean).join(", ");
  }

  /* ---- Car: ONE searchable dropdown of the enterprise's own cars ---- */
  function populateCarSelect(selectedVin = ""){
    const sel = $("#special-car-select");
    if (!sel) return;
    const ph = `<option value="" disabled${selectedVin ? "" : " selected"} hidden>${escape(t("special.car.ph"))}</option>`;
    const opts = _cars.map(c =>
      `<option value="${escape(c.vin)}"${c.vin === selectedVin ? " selected" : ""}>${escape(carLabel(c))}</option>`
    ).join("");
    sel.innerHTML = ph + opts;
    // First render wraps the <select> in a SearchSelect; later option swaps are
    // picked up by its MutationObserver, but sync() makes it instant. Scope the
    // enhance to this field so other panels' selects aren't wrapped early.
    if (!sel.dataset.ssEnhanced && typeof enhanceSelects === "function"){
      enhanceSelects(sel.parentElement || document);
    }
    sel._ss?.sync?.();
    updateNoCarsHint();
  }
  function getCarVin(){
    const sel = $("#special-car-select");
    return sel && sel.value ? sel.value : "";
  }

  /* ---- Plate: which of the COMPANY'S pool plates this record is on ---- */
  function populatePlateSelect(selectedPlate = ""){
    fillPlateSelect($("#special-plate-select"), CompanyPlates.getPlates(), selectedPlate);
  }
  function getPlate(){
    const sel = $("#special-plate-select");
    return sel && sel.value ? sel.value : "";
  }
  function updateNoCarsHint(){
    const hint = $("#special-no-cars");
    const sel = $("#special-car-select");
    const empty = _cars.length === 0;
    if (hint) hint.hidden = !empty;
    if (sel) sel.disabled = empty;
  }

  // Resolve a record's car VIN (new single column, legacy CSV as fallback).
  function recordVin(r){
    if (r.car_vin) return r.car_vin;
    const first = String(r.car_vins || "").split(",")[0];
    return (first || "").trim();
  }

  // "Model — Plate" label used by the "Filter by car" dropdown.
  function carFilterLabel(c){
    if (!c || !c.model) return "";
    return c.platenumber ? `${c.model} — ${c.platenumber}` : c.model;
  }

  // Fill the filter dropdowns from the currently-loaded records. Called on
  // refresh only (not on every re-render) so the picked filter value survives.
  function populateFilters(){
    if (typeof populateFilterSelect !== "function") return;
    const carByVin = {};
    _cars.forEach(c => { carByVin[c.vin] = c; });
    populateFilterSelect($("#filter-sr-company"), _records.map(r => r.company_name));
    populateFilterSelect($("#filter-sr-car"),
      _records.map(r => carFilterLabel(carByVin[recordVin(r)])));
  }

  // Apply the toolbar filters. Dates use the same overlap rule as the reports:
  // From keeps rows still running on/after it, To keeps rows that started on/before it.
  function getFiltered(){
    const carByVin = {};
    _cars.forEach(c => { carByVin[c.vin] = c; });
    let rows = _records.slice();
    const company = $("#filter-sr-company")?.value || "";
    const car     = $("#filter-sr-car")?.value     || "";
    const from    = ($("#filter-sr-from")?.value || "").trim();
    const to      = ($("#filter-sr-to")?.value   || "").trim();
    const d = (v) => v ? String(v).slice(0, 10) : "";
    if (company) rows = rows.filter(r => r.company_name === company);
    if (car)     rows = rows.filter(r => carFilterLabel(carByVin[recordVin(r)]) === car);
    if (from)    rows = rows.filter(r => r.end_date   && d(r.end_date)   >= from);
    if (to)      rows = rows.filter(r => r.start_date && d(r.start_date) <= to);
    return rows;
  }

  const _z2 = n => String(n).padStart(2, "0");
  function _todayStr(){ const d = new Date(); return `${d.getFullYear()}-${_z2(d.getMonth()+1)}-${_z2(d.getDate())}`; }

  // Status cell for a B2B record — a picker, same as the individuals table. A
  // record handed back is settled, so that one stays a plain badge. Only an
  // ACTIVE record still out carries its date-derived state (Overdue / Due
  // today) under the picker; a pending or cancelled record has no car out, so
  // an "Overdue" badge on it would be a lie.
  function _statusCell(r){
    const st = r.status || "active";
    if (r.returned_at){
      const at = String(r.returned_at).slice(0, 10);
      return `<span class="return-badge returned" title="${escape(at)}">${escape(t("special.status.returned"))}</span>`;
    }
    return statusPicker(st, `data-sr="${r.id}"`, st === "active" ? _dueBadge(r) : "");
  }

  // The date-derived half of an active record's status: Overdue / Due today, or
  // nothing at all — plain "Out" is what the picker already says.
  function _dueBadge(r){
    const end = r.end_date ? String(r.end_date).slice(0, 10) : "";
    if (!end) return "";
    const today = _todayStr();
    if (end < today)  return `<span class="return-badge overdue">${escape(t("returns.overdue"))}</span>`;
    if (end === today) return `<span class="return-badge today">${escape(t("returns.dueToday"))}</span>`;
    return "";
  }

  function renderRecords(){
    const tb = $("#special-rows");
    if (!tb) return;
    if (!_records.length){
      tb.innerHTML = `<tr class="empty-row"><td colspan="6">${escape(t("special.empty"))}</td></tr>`;
      return;
    }
    const rows = getFiltered();
    if (!rows.length){
      tb.innerHTML = `<tr class="empty-row"><td colspan="6">${escape(t("special.noMatch"))}</td></tr>`;
      return;
    }
    const carByVin = {};
    _cars.forEach(c => { carByVin[c.vin] = c; });
    const splitCsv = (s) => String(s || "").split(",").map(x => x.trim()).filter(Boolean);
    const dash = '<span class="muted-cell">—</span>';
    const ltr = (v) => `<span class="ltr">${escape(v)}</span>`;
    const day = (d) => d ? ltr(String(d).slice(0, 10)) : dash;
    // Card mode (721–1024px) hides the <thead>, so data-label is a cell's only
    // label — and merged cells make that matter more, not less.
    const lbl = (k) => escape(t(k));

    tb.innerHTML = rows.map((r) => {
      const phones = r.phones ? splitCsv(r.phones) : [r.phone, r.extra_phone].filter(Boolean);
      const phoneHtml = phones
        .map(p => `<a href="tel:${escape(p)}" class="ltr">${escape(p)}</a>`)
        .join(`<span class="sr-dot">·</span>`);
      const c = carByVin[recordVin(r)] || {};
      const gps = c.has_gps
        ? `<span class="badge yes">${escape(t("yes"))}</span>`
        : `<span class="badge no">${escape(t("no"))}</span>`;

      // WHO took it: the renting company leads; its owner and phones are the
      // supporting lines. Three former columns, one cell, one thing described.
      // (No "Rented from" column here, unlike the admin's copy — these are this
      // company's own records, so the owner is never in question.)
      const sub = [
        r.owner_name ? escape(r.owner_name) : "",
        phoneHtml,
      ].filter(Boolean).join(`<span class="sr-dot">·</span>`);
      const renterCell = `<div class="sr-stack">
          <span class="sr-main">${escape(r.company_name)}</span>
          ${sub ? `<span class="sr-sub">${sub}</span>` : ""}
        </div>`;

      // WHAT they took: model leads, plate + colour identify which one. The
      // record's own plate (the one this booking is on) wins over the car's
      // primary; falls back to it for older rows.
      const shownPlate = r.plate || c.platenumber;
      const vSub = [
        shownPlate ? `<span class="sr-plate ltr">${escape(shownPlate)}</span>` : "",
        c.color ? formatColorCell(c.color) : "",
      ].filter(Boolean).join(`<span class="sr-dot">·</span>`);
      const vehicleCell = c.model || c.platenumber
        ? `<div class="sr-stack">
             <span class="sr-main">${c.model ? escape(c.model) : dash}</span>
             ${vSub ? `<span class="sr-sub">${vSub}</span>` : ""}
           </div>`
        : dash;

      // WHEN: one span reads as a period; two columns read as two facts.
      const period = `${day(r.start_date)}<span class="rp-arrow">→</span>${day(r.end_date)}`;
      // A car still out can be extended or handed back to a branch; once
      // returned those actions disappear and only Edit remains. Only an ACTIVE
      // booking has a car out at all — there's nothing to extend or hand back
      // on a pending or cancelled record, so those get Edit alone.
      const returned = !!r.returned_at;
      const out = !returned && (r.status || "active") === "active";
      const editBtn = `<button type="button" class="row-btn special-edit" data-id="${r.id}">✎ ${escape(t("action.edit"))}</button>`;
      const extendBtn = out
        ? `<button type="button" class="row-btn special-extend" data-id="${r.id}">${escape(t("extend.action"))}</button>` : "";
      const returnBtn = out
        ? `<button type="button" class="row-btn special-return" data-id="${r.id}">${escape(t("returns.backToOffice"))}</button>` : "";
      const action = `<div class="row-actions">${editBtn}${extendBtn}${returnBtn}</div>`;

      return `<tr${returned ? ' class="special-returned-row"' : ""}>
        <td data-col="renter"  data-label="${lbl("special.th.rentedBy")}">${renterCell}</td>
        <td data-col="vehicle" data-label="${lbl("special.th.vehicle")}">${vehicleCell}</td>
        <td data-col="period"  data-label="${lbl("report.period")}">${period}</td>
        <td data-col="gps"     data-label="${lbl("special.th.gps")}">${gps}</td>
        <td data-col="status"  data-label="${lbl("special.th.status")}">${_statusCell(r)}</td>
        <td data-col="action" class="my-car-action">${action}</td>
      </tr>`;
    }).join("");
    if (typeof applyTranslations === "function") applyTranslations();
  }

  // The other company hands one of our cars back: pick which branch it came
  // back to, stamp the record returned, and drop it off the active list.
  async function _returnRecord(rec){
    if (!rec) return;
    const c = _cars.find(x => x.vin === recordVin(rec)) || {};
    const label = carLabel(c) || rec.company_name || "";
    const pick = await pickReturnBranch(label);
    if (pick === null) return;
    try {
      const r = await fetch(API.url(`/api/special-rentals/${rec.id}/return`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ return_branch_id: pick.branchId }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok){ toast(data.error || t("toast.error"), "error"); return; }
      toast(t("returns.returned"), "success");
      await refresh();
      if (typeof Notifications !== "undefined") Notifications.refresh();
    } catch (err){ toast(err.message || t("toast.error"), "error"); }
  }

  // Extend a B2B record's rental period.
  async function _extendRecord(rec){
    if (!rec) return;
    const c = _cars.find(x => x.vin === recordVin(rec)) || {};
    const label = carLabel(c) || rec.company_name || "";
    const curEnd = rec.end_date ? String(rec.end_date).slice(0, 10) : "";
    const newEnd = await pickExtendDate(label, curEnd);
    if (newEnd === null) return;
    try {
      const r = await fetch(API.url(`/api/special-rentals/${rec.id}/extend`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ end_date: newEnd }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok){ toast(data.error || t("toast.error"), "error"); return; }
      toast(t("extend.done"), "success");
      await refresh();
      if (typeof Notifications !== "undefined") Notifications.refresh();
    } catch (err){ toast(err.message || t("toast.error"), "error"); }
  }

  // Move a B2B record between pending / active / cancelled from the table. Its
  // own endpoint, not the full PUT — flipping a dropdown isn't an edit of the
  // record and mustn't bump the edit count. Repaint either way: a move changes
  // which row actions apply (only an active record can be extended or handed
  // back), and a rejected one must snap the picker back to the real status.
  async function _setRecordStatus(id, to){
    if (!id || !to) return;
    try {
      const r = await fetch(API.url(`/api/special-rentals/${id}/status`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ status: to }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok){ toast(data.error || t("toast.error"), "error"); renderRecords(); return; }
      toast(t("status.moved").replace("{status}", t("status." + to + ".short")), "success");
      await refresh();
      if (typeof Notifications !== "undefined") Notifications.refresh();
    } catch (err){
      toast(err.message || t("toast.error"), "error");
      renderRecords();
    }
  }

  // The booking-status <select> (distinct from setStatus above, which drives
  // the form's status BANNER). It's SearchSelect-wrapped, so setting .value
  // alone leaves the visible trigger showing the old label — sync() repaints it.
  function setStatusField(value){
    const sel = $("#special-status");
    if (!sel) return;
    sel.value = value || "active";
    sel._ss?.sync?.();
  }

  function resetForm(){
    const form = $("#form-special-rental");
    if (form) form.reset();
    PhoneList.setPhones("#special-phones", "");
    setBranches("");
    setStatusField("active");
    populateCarSelect("");
    populatePlateSelect("");
    $("#special-x").value = "";
    $("#special-y").value = "";
    const ms = $("#special-map-loc-status");
    if (ms){ ms.classList.add("empty"); ms.classList.remove("filled"); ms.textContent = t("companies.maploc.empty"); }
  }

  // ---- Edit an existing record (typo correction, unlimited) ----
  function enterEditMode(rec){
    const form = $("#form-special-rental");
    if (!form) return;
    _editId = rec.id;
    const setVal = (name, val) => { const el = form.querySelector(`[name="${name}"]`); if (el) el.value = val || ""; };
    setVal("company_name", rec.company_name);
    setVal("owner_name",   rec.owner_name);
    setVal("location",     rec.location);
    setVal("notes",        rec.notes);
    setVal("start_date",   (rec.start_date || "").slice(0, 10));
    setVal("end_date",     (rec.end_date   || "").slice(0, 10));
    PhoneList.setPhones("#special-phones", rec.phones || "");
    setBranches(rec.branches || "");
    setStatusField(rec.status);
    populateCarSelect(recordVin(rec));
    populatePlateSelect(rec.plate || "");
    $("#special-x").value = rec.x != null ? rec.x : "";
    $("#special-y").value = rec.y != null ? rec.y : "";
    const ms = $("#special-map-loc-status");
    if (rec.x != null && rec.x !== "" && rec.y != null && rec.y !== ""){
      setMapStatusOn("#special-map-loc-status", rec.y, rec.x);   // y = lat, x = lng
    } else if (ms){
      ms.classList.add("empty"); ms.classList.remove("filled"); ms.textContent = t("companies.maploc.empty");
    }
    const btn = $("#special-submit");
    if (btn){ btn.removeAttribute("data-i18n"); btn.textContent = t("special.update"); }
    const cancel = $("#special-cancel-edit"); if (cancel) cancel.hidden = false;
    const ttl = $("#special-modal-title");
    if (ttl){ ttl.removeAttribute("data-i18n"); ttl.textContent = t("special.editTitle"); }
    setStatus(t("special.editingNow").replace("{company}", rec.company_name || ""));
    // The form is a modal now — raise it instead of scrolling to a panel.
    showModal("#special-rental-modal");
  }

  function exitEditMode(){
    _editId = null;
    const btn = $("#special-submit");
    if (btn){ btn.setAttribute("data-i18n", "special.action"); btn.textContent = t("special.action"); }
    const cancel = $("#special-cancel-edit"); if (cancel) cancel.hidden = true;
    const ttl = $("#special-modal-title");
    if (ttl){ ttl.setAttribute("data-i18n", "special.title"); ttl.textContent = t("special.title"); }
    setStatus("");
  }

  // "New record" → a guaranteed-blank add form, then raise the modal.
  function openAdd(){
    exitEditMode();
    resetForm();
    showModal("#special-rental-modal");
  }

  async function refresh(){
    const u = (typeof AUTH !== "undefined") ? AUTH.user() : null;
    if (!u || u.role !== "company" || !u.company_id) return;
    try { _cars = await API.listCars(u.company_id); } catch (e){ _cars = []; }
    try { _records = await API.listSpecialRentals(); } catch (e){ _records = []; }
    // Refresh the car dropdown with the current car list, keeping the pick.
    populateCarSelect(getCarVin());
    populatePlateSelect(getPlate());
    populateFilters();
    renderRecords();
  }

  async function submit(e){
    e.preventDefault();
    setStatus("");
    const form = e.target;
    const fd = new FormData(form);
    const company_name = (fd.get("company_name") || "").toString().trim();
    const errEl = $('[data-error-for="sr_company_name"]');
    if (!company_name){
      if (errEl){ errEl.textContent = t("special.err.company"); errEl.hidden = false; }
      return;
    }
    if (errEl){ errEl.textContent = ""; errEl.hidden = true; }

    const body = {
      company_name,
      owner_name: (fd.get("owner_name") || "").toString().trim(),
      location:   (fd.get("location") || "").toString().trim(),
      phones:     PhoneList.getPhones("#special-phones"),
      branches:   getBranches(),
      x:          (fd.get("x") || "").toString().trim(),
      y:          (fd.get("y") || "").toString().trim(),
      notes:      (fd.get("notes") || "").toString().trim(),
      car_vin:    getCarVin(),
      plate:      getPlate(),
      start_date: (fd.get("start_date") || "").toString().trim(),
      end_date:   (fd.get("end_date") || "").toString().trim(),
      status:     (fd.get("status") || "active").toString(),
    };
    try {
      if (_editId != null){
        await API.updSpecialRental(_editId, body);
        toast(t("special.updated"), "success");
      } else {
        await API.addSpecialRental(body);
        toast(t("special.saved"), "success");
      }
      exitEditMode();
      resetForm();
      hideModal("#special-rental-modal");
      await refresh();
    } catch (err){
      setStatus(err.message || "Save failed", "error");
    }
  }

  function setup(){
    const form = $("#form-special-rental");
    if (!form) return;
    form.addEventListener("submit", submit);

    // Phones — reuse the shared multi-phone widget (country dial-code dropdown
    // with search + "+ Add phone").
    PhoneList.setPhones("#special-phones", "");
    PhoneList.bind("#special-phones", "#special-add-phone");

    // Branches — repeatable text rows.
    setBranches("");
    $("#special-add-branch")?.addEventListener("click", () => {
      $("#special-branches")?.insertAdjacentHTML("beforeend", branchRowHtml(""));
      $("#special-branches").lastElementChild.querySelector(".special-branch-input")?.focus();
    });
    $("#special-branches")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".special-branch-remove");
      if (!btn) return;
      const c = $("#special-branches");
      const row = btn.closest(".special-branch-row");
      if (c.querySelectorAll(".special-branch-row").length <= 1){
        const inp = row.querySelector(".special-branch-input");
        if (inp) inp.value = "";
      } else { row.remove(); }
    });

    // Car — one searchable dropdown (populated from the enterprise's cars).
    populateCarSelect("");
    // Plate dropdown = the company's plate pool (independent of the car).
    populatePlateSelect("");

    $("#btn-pick-special-map")?.addEventListener("click", () => {
      MapPicker.openPick({ xSel: "#special-x", ySel: "#special-y", statusSel: "#special-map-loc-status" });
    });

    // Edit a recorded rental (✎) → repopulate the form in edit mode. Company
    // users may correct a record at most twice; the backend enforces the limit.
    $("#special-rows")?.addEventListener("click", (e) => {
      const editBtn = e.target.closest(".special-edit");
      if (editBtn){
        const rec = _records.find(x => String(x.id) === editBtn.dataset.id);
        if (rec) enterEditMode(rec);
        return;
      }
      const returnBtn = e.target.closest(".special-return");
      if (returnBtn){
        const rec = _records.find(x => String(x.id) === returnBtn.dataset.id);
        if (rec) _returnRecord(rec);
        return;
      }
      const extendBtn = e.target.closest(".special-extend");
      if (extendBtn){
        const rec = _records.find(x => String(x.id) === extendBtn.dataset.id);
        if (rec) _extendRecord(rec);
      }
    });

    // Picking a status in the table moves the record.
    $("#special-rows")?.addEventListener("change", (e) => {
      const sel = e.target.closest(".status-pick-sel");
      if (sel) _setRecordStatus(sel.dataset.sr, sel.value);
    });

    // Cancel an in-progress edit → close the modal on a blank "add" form.
    $("#special-cancel-edit")?.addEventListener("click", () => {
      exitEditMode(); resetForm(); hideModal("#special-rental-modal");
    });
    // Modal chrome: × closes without saving.
    $("#special-rental-close")?.addEventListener("click", () => {
      exitEditMode(); resetForm(); hideModal("#special-rental-modal");
    });

    // Filters: any change re-renders the already-loaded records (no re-fetch).
    ["#filter-sr-company", "#filter-sr-car", "#filter-sr-from", "#filter-sr-to"].forEach(sel => {
      $(sel)?.addEventListener("change", renderRecords);
    });
    $("#filter-sr-reset")?.addEventListener("click", () => {
      ["#filter-sr-company", "#filter-sr-car"].forEach(sel => {
        const el = $(sel); if (el){ el.value = ""; el._ss?.sync?.(); }
      });
      const f = $("#filter-sr-from"); if (f) f.value = "";
      const tt = $("#filter-sr-to");  if (tt) tt.value = "";
      renderRecords();
    });
  }

  return { setup, refresh, openAdd, count: () => _records.length };
})();

/* ============== ADMIN: CARS RENTED BY COMPANIES (B2B report) ==============
   Admin-wide, read-only list of every special_company_rentals record across
   ALL companies. The backend joins each record's car, so model/color/plate/GPS
   ride on the row; the 👁 button reuses the shared SpecialDetail modal (admin
   passes _can_edit_company, so it can view the record's photos/videos too). */
const AdminSpecial = (() => {
  let _all = [];       // every record fetched from the admin endpoint
  let _view = [];      // the current filtered list (what the eye button indexes)
  let _wired = false;

  // SpecialDetail.carOf() resolves the car by VIN from a list; the admin row
  // already carries the car fields, so hand it a synthetic one-car list.
  function carsFor(r){
    return [{
      vin: r.car_vin, model: r.model, color: r.color,
      platenumber: r.platenumber, has_gps: r.has_gps, type: r.type,
    }];
  }

  // Per-car-unique label for the "Filter by car" dropdown: "Model — Plate".
  function carLabelOf(r){
    if (!r || !r.model) return "";
    return r.platenumber ? `${r.model} — ${r.platenumber}` : r.model;
  }

  function populateFilters(){
    if (typeof populateFilterSelect !== "function") return;
    populateFilterSelect($("#filter-special-company"), _all.map(r => r.company_name));
    populateFilterSelect($("#filter-special-car"),     _all.map(carLabelOf));
  }

  // Apply the toolbar filters. Dates use the same "active in range" overlap
  // rule as the rental report: From keeps rows still running on/after it,
  // To keeps rows that started on/before it.
  function filtered(){
    let rows = _all.slice();
    const company = $("#filter-special-company")?.value || "";
    const car     = $("#filter-special-car")?.value     || "";
    const from    = ($("#special-from")?.value || "").trim();
    const to      = ($("#special-to")?.value   || "").trim();
    const d = (v) => v ? String(v).slice(0, 10) : "";
    if (company) rows = rows.filter(r => r.company_name === company);
    if (car)     rows = rows.filter(r => carLabelOf(r) === car);
    if (from)    rows = rows.filter(r => r.end_date   && d(r.end_date)   >= from);
    if (to)      rows = rows.filter(r => r.start_date && d(r.start_date) <= to);
    return rows;
  }

  function render(){
    const tb = $("#admin-special-rows");
    if (!tb) return;
    _view = filtered();
    if (!_view.length){
      tb.innerHTML = `<tr class="empty-row"><td colspan="7">${escape(t("adminSpecial.empty"))}</td></tr>`;
      const pt = $("#pager-top-admin-special"); if (pt) pt.hidden = true;
      const pb = $("#pager-admin-special");     if (pb) pb.hidden = true;
      return;
    }
    const info = Pager.slice("admin-special", _view);
    const dash = '<span class="muted-cell">—</span>';
    const ltr = (v) => `<span class="ltr">${escape(v)}</span>`;
    const day = (d) => d ? ltr(String(d).slice(0, 10)) : dash;
    const splitCsv = (s) => String(s || "").split(",").map(x => x.trim()).filter(Boolean);
    // Card mode (721–1024px) hides the <thead>, so data-label is a cell's only
    // label. Merged cells make this matter more, not less — "Rented by" has to
    // say so when the header isn't there to.
    const lbl = (k) => escape(t(k));

    tb.innerHTML = info.rows.map((r, i) => {
      const idx = (info.page - 1) * info.size + i;   // absolute index into _view
      const phones = r.phones ? splitCsv(r.phones) : [r.phone, r.extra_phone].filter(Boolean);
      const gps = r.has_gps
        ? `<span class="badge yes">${escape(t("yes"))}</span>`
        : `<span class="badge no">${escape(t("no"))}</span>`;
      // "Rented from" = the registered company that owns the car and rented it
      // out (the record's company_id). Clicking it opens that company's detail
      // modal (info + location + branches). Look it up from already-loaded state.
      const ownerCo = (state.companies || []).find(c => c.id === Number(r.company_id));
      const fromCell = ownerCo
        ? drillCell("company", ownerCo.id, ownerCo.companyname, true)
        : dash;

      // WHO took it: the renting company leads; its owner and phones are the
      // supporting lines. Three former columns, one cell, one thing described.
      const phoneHtml = phones
        .map(p => `<a href="tel:${escape(p)}" class="ltr">${escape(p)}</a>`)
        .join(`<span class="sr-dot">·</span>`);
      const sub = [
        r.owner_name ? escape(r.owner_name) : "",
        phoneHtml,
      ].filter(Boolean).join(`<span class="sr-dot">·</span>`);
      const renterCell = `<div class="sr-stack">
          <span class="sr-main">${escape(r.company_name)}</span>
          ${sub ? `<span class="sr-sub">${sub}</span>` : ""}
        </div>`;

      // WHAT they took: model leads, plate + colour identify which one.
      const vSub = [
        r.platenumber ? `<span class="sr-plate ltr">${escape(r.platenumber)}</span>` : "",
        r.color ? formatColorCell(r.color) : "",
      ].filter(Boolean).join(`<span class="sr-dot">·</span>`);
      const vehicleCell = r.model || r.platenumber
        ? `<div class="sr-stack">
             <span class="sr-main">${r.model ? escape(r.model) : dash}</span>
             ${vSub ? `<span class="sr-sub">${vSub}</span>` : ""}
           </div>`
        : dash;

      // WHEN: one span reads as a period; two columns read as two facts.
      const period = `${day(r.start_date)}<span class="rp-arrow">→</span>${day(r.end_date)}`;

      // Read-only: the owning company moves its own B2B records from its Cars &
      // Rentals table. A returned record shows "Returned" ALONE — it's settled,
      // so the state it was in is history. Only an ACTIVE record can be late.
      const bs = r.status || "active";
      const status = r.returned_at
        ? `<span class="return-badge returned">${escape(t("special.status.returned"))}</span>`
        : statusTag(bs, bs === "active" && r.end_date && String(r.end_date).slice(0, 10) < _raToday()
            ? `<span class="return-badge overdue">${escape(t("returns.overdue"))}</span>` : "");

      return `<tr class="al-click-row" data-idx="${idx}" title="${escape(t("special.detail.title"))}">
        <td data-col="from-company" data-label="${lbl("adminSpecial.th.fromCompany")}">${fromCell}</td>
        <td data-col="renter" data-label="${lbl("adminSpecial.th.rentedBy")}">${renterCell}</td>
        <td data-col="vehicle" data-label="${lbl("adminSpecial.th.vehicle")}">${vehicleCell}</td>
        <td data-col="period" data-label="${lbl("report.period")}">${period}</td>
        <td data-col="gps" data-label="${lbl("special.th.gps")}">${gps}</td>
        <td data-col="status" data-label="${lbl("report.status")}">${status}</td>
        <td data-col="view">
          <button type="button" class="row-btn admin-special-view" data-idx="${idx}"
                  title="${escape(t("special.detail.title"))}"
                  aria-label="${escape(t("special.detail.title"))}">${ROW_MORE_ICO}</button>
        </td>
      </tr>`;
    }).join("");
    Pager.render("admin-special", "#pager-top-admin-special", "#pager-admin-special", info, render);
    if (typeof applyTranslations === "function") applyTranslations();
  }

  async function refresh(){
    const u = (typeof AUTH !== "undefined") ? AUTH.user() : null;
    if (!u || u.role !== "admin") return;
    try { _all = await API.listAdminSpecialRentals(); }
    catch (e){ _all = []; }
    populateFilters();
    Pager.reset("admin-special");
    render();
  }

  function setup(){
    if (_wired) return;
    _wired = true;
    // Click anywhere on a row (company / owner / car) to open the detail modal.
    // The "Rented from" company link still opens that company's info modal, and
    // phone links still dial — those are handled/ignored first.
    $("#admin-special-rows")?.addEventListener("click", (e) => {
      const drill = e.target.closest(".cell-drill");
      if (drill){
        e.stopPropagation();
        EntityDetail.open(drill.dataset.drill, drill.dataset.drillkey);
        return;
      }
      if (e.target.closest("a")) return;
      const tr = e.target.closest(".al-click-row");
      if (!tr) return;
      const rec = _view[Number(tr.dataset.idx)];
      if (rec) SpecialDetail.open(rec, carsFor(rec));
    });
    // Filters: any change resets to page 1 and re-renders.
    ["#filter-special-company", "#filter-special-car", "#special-from", "#special-to"].forEach(sel => {
      $(sel)?.addEventListener("change", () => { Pager.reset("admin-special"); render(); });
    });
    $("#special-reset")?.addEventListener("click", () => {
      ["#filter-special-company", "#filter-special-car"].forEach(sel => {
        const el = $(sel);
        if (el){ el.value = ""; el._ss?.sync?.(); }
      });
      const f = $("#special-from"); if (f) f.value = "";
      const tt = $("#special-to");  if (tt) tt.value = "";
      Pager.reset("admin-special");
      render();
    });
  }

  return { setup, refresh, count: () => _all.length };
})();

/* ============== ADMIN: CARS RENTED BY INDIVIDUALS ==============
   Currently-out individual-client rentals (returned_at IS NULL). Deliberately
   mirrors AdminSpecial so the two tables in the Cars hub read as a matching
   pair: the same merged .sr-stack cells, the same labelled row button, the
   same movable status picker.

   The toolbar used to be one free-text box matching client / phone / company /
   model / plate / colour. It's now prefix-searchable dropdowns (client, car)
   plus a From/To window — the same shape as the company hub's individuals
   table and the report. Worth knowing what that trades away: the box could
   also match a PHONE or a COLOUR, and the dropdowns can't. What you gain is
   that a pick can never return an empty table (the options are built from the
   very rows being rendered) and there's nothing to mistype. */
const AdminIndividual = (() => {
  let _all = [];
  let _view = [];
  let _wired = false;

  // "Model — Plate": unique per car, so two identical models stay distinct.
  function carLabelOf(r){
    if (!r || !r.car_model) return "";
    return r.car_plate ? `${r.car_model} — ${r.car_plate}` : r.car_model;
  }

  function populateFilters(){
    if (typeof populateFilterSelect !== "function") return;
    populateFilterSelect($("#filter-ai-client"), _all.map(r => r.client_name));
    populateFilterSelect($("#filter-ai-car"),    _all.map(carLabelOf));
  }

  // Client and car are dropdown picks, so they match EXACTLY. Dates use the
  // same "active in range" overlap rule as the report and the B2B table: From
  // keeps rentals still running on/after it, To keeps those that had started
  // by it.
  function filtered(){
    let rows = _all.slice();
    const client = $("#filter-ai-client")?.value || "";
    const car    = $("#filter-ai-car")?.value    || "";
    const from   = ($("#filter-ai-from")?.value  || "").trim();
    const to     = ($("#filter-ai-to")?.value    || "").trim();
    const d = (v) => v ? String(v).slice(0, 10) : "";
    if (client) rows = rows.filter(r => r.client_name === client);
    if (car)    rows = rows.filter(r => carLabelOf(r) === car);
    if (from)   rows = rows.filter(r => r.end_date   && d(r.end_date)   >= from);
    if (to)     rows = rows.filter(r => r.start_date && d(r.start_date) <= to);
    return rows;
  }

  function render(){
    const tb = $("#admin-individual-rows");
    if (!tb) return;
    _view = filtered();
    if (!_view.length){
      tb.innerHTML = `<tr class="empty-row"><td colspan="6">${escape(t("adminIndividual.empty"))}</td></tr>`;
      const pt = $("#pager-top-admin-individual"); if (pt) pt.hidden = true;
      const pb = $("#pager-admin-individual");     if (pb) pb.hidden = true;
      return;
    }
    const info = Pager.slice("admin-individual", _view);
    const dash = '<span class="muted-cell">—</span>';
    const ltr = (v) => `<span class="ltr">${escape(v)}</span>`;
    const day = (d) => d ? ltr(String(d).slice(0, 10)) : dash;
    const today = _raToday();
    // Card mode (721–1024px) hides the <thead>, so data-label is a cell's only
    // label — and merged cells make that matter more, not less.
    const lbl = (k) => escape(t(k));

    tb.innerHTML = info.rows.map((r, i) => {
      const idx = (info.page - 1) * info.size + i;   // absolute index into _view
      const gps = r.car_has_gps
        ? `<span class="badge yes">${escape(t("yes"))}</span>`
        : `<span class="badge no">${escape(t("no"))}</span>`;

      // WHO has it: the client leads, their phone is the supporting line.
      const phoneHtml = r.client_phone
        ? `<a href="tel:${escape(r.client_phone)}" class="ltr">${escape(r.client_phone)}</a>` : "";
      const clientCell = `<div class="sr-stack">
          <span class="sr-main">${r.client_name ? escape(r.client_name) : dash}</span>
          ${phoneHtml ? `<span class="sr-sub">${phoneHtml}</span>` : ""}
        </div>`;

      // WHAT they took: model leads; plate + colour say which one.
      const vSub = [
        r.car_plate ? `<span class="sr-plate ltr">${escape(r.car_plate)}</span>` : "",
        r.car_color ? formatColorCell(r.car_color) : "",
      ].filter(Boolean).join(`<span class="sr-dot">·</span>`);
      const vehicleCell = r.car_model || r.car_plate
        ? `<div class="sr-stack">
             <span class="sr-main">${r.car_model ? escape(r.car_model) : dash}</span>
             ${vSub ? `<span class="sr-sub">${vSub}</span>` : ""}
           </div>`
        : dash;

      // WHEN: one span reads as a period; two columns read as two facts.
      const period = `${day(r.start_date)}<span class="rp-arrow">→</span>${day(r.end_date)}`;

      // Read-only, same as the other two admin tables: the company that took the
      // booking moves it; the admin reads it. These rows are all un-returned
      // (the endpoint filters on it), so only Overdue can apply here.
      const bs = r.status || "active";
      const overdue = bs === "active" && _raStatus(r, today) === "overdue"
        ? `<span class="return-badge overdue">${escape(t("returns.overdue"))}</span>` : "";
      const status = statusTag(bs, overdue);

      return `<tr class="al-click-row" data-idx="${idx}" title="${escape(t("action.view"))}">
        <td data-col="client" data-label="${lbl("adminIndividual.th.client")}">${clientCell}</td>
        <td data-col="company" data-label="${lbl("special.th.company")}">${r.company_name ? escape(r.company_name) : dash}</td>
        <td data-col="vehicle" data-label="${lbl("adminSpecial.th.vehicle")}">${vehicleCell}</td>
        <td data-col="period" data-label="${lbl("report.period")}">${period}</td>
        <td data-col="gps" data-label="${lbl("special.th.gps")}">${gps}</td>
        <td data-col="status" data-label="${lbl("report.status")}">${status}</td>
      </tr>`;
    }).join("");
    Pager.render("admin-individual", "#pager-top-admin-individual", "#pager-admin-individual", info, render);
    if (typeof applyTranslations === "function") applyTranslations();
  }

  async function refresh(){
    const u = (typeof AUTH !== "undefined") ? AUTH.user() : null;
    if (!u || u.role !== "admin") return;
    try { _all = await API.listAdminActiveRentals(); }
    catch (e){ _all = []; }
    populateFilters();
    Pager.reset("admin-individual");
    render();
  }

  function setup(){
    if (_wired) return;
    _wired = true;
    // The two pickers only ever fire `change` — SearchSelect dispatches that and
    // never `input`, so wiring these to `input` would mean picks silently never
    // apply. The date inputs fire both as they're typed into.
    ["#filter-ai-client", "#filter-ai-car"].forEach(sel => {
      $(sel)?.addEventListener("change", () => { Pager.reset("admin-individual"); render(); });
    });
    ["#filter-ai-from", "#filter-ai-to"].forEach(sel => {
      $(sel)?.addEventListener("input",  () => { Pager.reset("admin-individual"); render(); });
      $(sel)?.addEventListener("change", () => { Pager.reset("admin-individual"); render(); });
    });
    $("#individual-reset")?.addEventListener("click", () => {
      // Blanking .value alone would leave the SearchSelect trigger showing the
      // old pick — clearFilterSelect syncs the wrapper too.
      clearFilterSelect($("#filter-ai-client"));
      clearFilterSelect($("#filter-ai-car"));
      ["#filter-ai-from", "#filter-ai-to"].forEach(sel => {
        const el = $(sel); if (el) el.value = "";
      });
      Pager.reset("admin-individual"); render();
    });
    // Click a row (client / company / car) to open the full rental detail
    // modal (info + media + PDF download). Ignore clicks on the phone link.
    $("#admin-individual-rows")?.addEventListener("click", (e) => {
      if (e.target.closest("a, button")) return;
      const tr = e.target.closest(".al-click-row");
      if (!tr) return;
      const rec = _view[Number(tr.dataset.idx)];
      if (rec) Detail.open(rec);
    });
  }

  return { setup, refresh, count: () => _all.length };
})();

/* ============== COMPANY CLIENTS HUB (the views inside #company-clients) ======
   The register and the clients' rental history are two questions about the same
   people, so they share one panel — "Add Client & See History" — instead of two
   home cards. Same shape as CarsHub / ClientsHub: this only swaps the view and
   keeps the tab badges honest. The history table stays owned by
   renderReportCompany(), which is keyed by element id, so the markup moved here
   without touching it.

   Scoping is NOT this module's job and never was: getReportRows() filters the
   feed to `u.company_id` for every company user, so a company only ever sees
   its own clients. Moving the table into this panel didn't widen that by a row. */
const CoClientsHub = (() => {
  const VIEWS = ["add", "history"];
  let _view = "add";
  let _wired = false;
  // Held here, pushed in by renderReportCompany, so a syncCounts() from the
  // register tab can't blank it.
  let _historyCount = 0;

  function setCount(sel, n){ const el = $(sel); if (el) el.textContent = n; }

  // The register badge counts the rows you can actually see in "Clients you
  // added", not every client in the system.
  function syncCounts(){
    const rows = $$("#my-clients-rows tr").filter(tr => !tr.querySelector(".empty-cell"));
    setCount("#hub-count-coclients-add", rows.length);
    setCount("#hub-count-coclients-history", _historyCount);
  }

  function syncHistoryCount(n){
    _historyCount = n;
    setCount("#hub-count-coclients-history", n);
  }

  function show(view){
    if (!VIEWS.includes(view)) view = "add";
    _view = view;
    $$("#company-clients .hub-view").forEach(v => {
      v.hidden = v.dataset.coclientviewPanel !== view;
    });
    $$("#company-clients .hub-tab").forEach(b => {
      const on = b.dataset.coclientview === view;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    // The history feed is a per-open load — big, and nobody needs the number
    // before clicking the tab. refreshReport() repaints the table, which pushes
    // the badge back through syncHistoryCount.
    if (view === "history"){
      renderReportCompanyHead();
      refreshReport();
    }
    syncCounts();
  }

  // Panel opened: refresh the register table, then paint the view being opened
  // (the caller passes it, so we don't paint the previous one first).
  function refresh(view){
    if (view && VIEWS.includes(view)) _view = view;
    if (window.refreshMyClientsTable) Promise.resolve(window.refreshMyClientsTable()).then(syncCounts);
    show(_view);
  }

  function setup(){
    if (_wired || !$("#company-clients")) return;
    _wired = true;
    $$("#company-clients .hub-tab").forEach(b => {
      b.addEventListener("click", () => show(b.dataset.coclientview));
    });
  }

  return { setup, show, refresh, syncCounts, syncHistoryCount, view: () => _view };
})();

/* ============== ADMIN CARS HUB (the views inside #cars) ==============
   The fleet tree and the two "who is this car out with?" tables are three
   answers about the same cars, so they share one panel instead of three
   sidebar entries. Mirrors the company Cars hub. The tables stay owned by
   AdminSpecial / AdminIndividual — this only swaps the view and keeps the tab
   counts honest. */
const AdminCarsHub = (() => {
  const VIEWS = ["fleet", "individual", "company", "gps", "report"];
  let _view = "fleet";
  let _wired = false;

  function setCount(sel, n){ const el = $(sel); if (el) el.textContent = n; }

  // The report badge is pushed IN by renderReport (which knows the filtered
  // count) rather than pulled here, so it tracks the toolbar instead of the
  // unfiltered feed. Held so a syncCounts() from another tab can't blank it.
  let _reportCount = 0;
  function syncReportCount(n){
    if (typeof n === "number") _reportCount = n;
    setCount("#hub-count-admin-report", _reportCount);
  }

  // The fleet badge is read from the same summary the tree renders, so a
  // filtered fleet and its badge can't disagree.
  function syncCounts(){
    const total = Object.values(fleet.summary || {}).reduce((s, e) => s + (e.total || 0), 0);
    setCount("#hub-count-admin-fleet", total);
    setCount("#hub-count-admin-individual", AdminIndividual.count());
    setCount("#hub-count-admin-company", AdminSpecial.count());
    syncReportCount();
  }

  function show(view){
    if (!VIEWS.includes(view)) view = "fleet";
    _view = view;
    $$("#cars .hub-view").forEach(v => { v.hidden = v.dataset.adminviewPanel !== view; });
    $$("#cars .hub-tab").forEach(b => {
      const on = b.dataset.adminview === view;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    syncCounts();
    // Leaflet can only measure itself against a laid-out container, so the map
    // has to be told the moment its view stops being hidden — not before. This
    // is also where it loads its cars, which is why the tab carries no badge.
    if (view === "gps" && typeof CarGps !== "undefined") CarGps.onShow();
    // The report is the one view whose rows aren't already in memory: the other
    // tabs are fetched by refresh() below, but the report feed is big enough
    // that it stays a per-open load. refreshReport() repaints on arrival.
    if (view === "report") refreshReport();
  }

  // Both tables are fetched on demand. Load them together so every badge is
  // right whichever view the admin lands on — the counts are the reason to
  // click a tab, so they can't wait for the click.
  async function refresh(){
    const u = (typeof AUTH !== "undefined") ? AUTH.user() : null;
    if (!u || u.role !== "admin") return;
    await Promise.all([
      (async () => { try { await AdminIndividual.refresh(); } catch (e){} })(),
      (async () => { try { await AdminSpecial.refresh();    } catch (e){} })(),
    ]);
    syncCounts();
  }

  function setup(){
    if (_wired || !$("#cars")) return;
    _wired = true;
    $$("#cars .hub-tab").forEach(b => {
      b.addEventListener("click", () => show(b.dataset.adminview));
    });
    // The report's own Export PDF (the #report section's button belongs to the
    // company's Clients History and stays wired to it).
    $("#btn-export-pdf-admin")?.addEventListener("click", () => {
      const rows = state.report || [];
      if (!rows.length){ toast(t("table.empty"), "error"); return; }
      downloadAuthed(API.url(`/api/report.pdf?lang=${currentLang()}`), "rental_report.pdf");
    });
    // No status listener here: the admin's status cells are read-only tags. A
    // booking is moved by the company that took it, from its own tables.
  }

  return { setup, show, refresh, syncCounts, syncReportCount, view: () => _view };
})();

/* ============== SHARED: one master-detail history table ==============
   Both admin history tables are the same table with different nouns: a master
   row (a person / a renting company) that expands into that master's own
   records, newest first. Rather than write the renderer twice, the two modules
   below hand this one a small config.

   It is deliberately NOT merged with renderReportCompany(): that one is the
   COMPANY's, scoped to its own clients, keyed on its own pager and reachable
   from `#report`. Sharing the markup shape is free (`.master-detail`); sharing
   the function would mean one body serving two roles' scoping rules — the same
   trap the admin/company row-detail split avoids.

   `expandedMasters` mirrors `expandedReportClients`: which panels are open has
   to survive a re-render (a filter change, a page turn, a language switch), so
   it's keyed by master, not by screen position. */
const expandedMasters = new Set();

function renderMasterHistory(cfg){
  const tbl = $(cfg.table);
  if (!tbl) return;
  const groups = cfg.groups;
  const count  = $(cfg.countEl);
  if (count) count.textContent = String(groups.length);
  if (typeof ClientsHub !== "undefined") ClientsHub.syncCounts();
  if (!groups.length){
    const pt = $(cfg.pagerTop); if (pt) pt.hidden = true;
    const pb = $(cfg.pagerBot); if (pb) pb.hidden = true;
    return emptyRow(tbl, cfg.cols);
  }

  const info = Pager.slice(cfg.pagerKey, groups);
  const lbl  = (k) => escape(t(k));

  tbl.tBodies[0].innerHTML = info.rows.map((g, i) => {
    const open  = expandedMasters.has(g.key);
    const panel = `${cfg.panelPrefix}-${info.page}-${i}`;
    const n     = g.rentals.length;
    return `<tr class="client-master-row${open ? " is-expanded" : ""}" data-master="${escape(g.key)}">
        ${cfg.masterCells(g)}
        <td data-col="view">
          <button type="button" class="row-btn client-toggle" aria-expanded="${open}"
                  aria-controls="${panel}"
                  title="${escape(t(open ? "report.hide" : "report.history"))}"
                  aria-label="${escape(t(open ? "report.hide" : "report.history"))}">
            <span class="rv-eye" aria-hidden="true">${ROW_MORE_ICO}</span>
            <span class="rv-chev" aria-hidden="true">⌄</span>
          </button>
        </td>
      </tr>
      <tr class="client-history-row" id="${panel}"${open ? "" : " hidden"}>
        <td colspan="${cfg.cols}">
          <div class="client-history">
            <h4 class="ch-h">${lbl("report.history")} · ${n} ${lbl(n === 1 ? "report.result" : "report.results")}</h4>
            <div id="${panel}-top" class="pager-wrap ch-pager" hidden></div>
            <ol id="${panel}-list" class="ch-list"></ol>
            <div id="${panel}-nav" class="pager-wrap ch-pager" hidden></div>
          </div>
        </td>
      </tr>`;
  }).join("");

  // Fill (or re-fill) one master's panel. Its pager is keyed by MASTER, so two
  // open panels page independently and a page survives a re-render.
  const renderPanel = (g, panel) => {
    const list = $(`#${panel}-list`);
    if (!list) return;
    const key = `${cfg.pagerKey}-history:${g.key}`;
    const hi  = Pager.slice(key, g.rentals);
    // The index handed to item() is ABSOLUTE within this master's list, not
    // within the page — the buttons are rebuilt on every page turn, and a
    // page-relative index would open entry 1 of page 2 as entry 1 of page 1.
    list.innerHTML = hi.rows.map((x, j) => cfg.item(x, (hi.page - 1) * hi.size + j)).join("");
    $$(".ch-open", list).forEach(b => {
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        cfg.openItem(g.rentals[Number(b.dataset.i)]);
      });
    });
    Pager.render(key, `#${panel}-top`, `#${panel}-nav`, hi, () => renderPanel(g, panel));
  };
  info.rows.forEach((g, i) => renderPanel(g, `${cfg.panelPrefix}-${info.page}-${i}`));

  // Open / close in place — no re-render, so every other open panel stays put.
  const toggle = (tr) => {
    const row = tr.nextElementSibling;
    if (!row || !row.classList.contains("client-history-row")) return;
    const open = row.hasAttribute("hidden");
    row.hidden = !open;
    tr.classList.toggle("is-expanded", open);
    if (open) expandedMasters.add(tr.dataset.master); else expandedMasters.delete(tr.dataset.master);
    const btn = $(".client-toggle", tr);
    if (btn){
      btn.setAttribute("aria-expanded", String(open));
      const lab = t(open ? "report.hide" : "report.history");
      btn.title = lab;
      btn.setAttribute("aria-label", lab);
    }
  };
  $$("tr.client-master-row", tbl).forEach(tr => {
    tr.addEventListener("click", (e) => {
      // A drill cell / link inside the master row wins over the expander.
      const drill = e.target.closest(".cell-drill");
      if (drill){ e.stopPropagation(); EntityDetail.open(drill.dataset.drill, drill.dataset.drillkey); return; }
      if (e.target.closest("a")) return;
      toggle(tr);
    });
  });
  // No applyTranslations() here: every label above already goes through t(),
  // and this markup carries no [data-i18n]. Calling it would retranslate the
  // whole document on every filter change and page turn for nothing.
  Pager.render(cfg.pagerKey, cfg.pagerTop, cfg.pagerBot, info, cfg.rerender);
}

/* ============== ADMIN: one client's history across EVERY company ==============
   The Cars hub's Report view answers "what rentals happened?" — one row per
   rental. This answers "who is this person, and what have they rented from
   anyone?" — one row per CLIENT, expanding into their rentals across every
   company. Same feed (state.report), different unit, so neither duplicates. */
const AdminClientHistory = (() => {
  let _wired = false;
  let _groups = [];

  function rows(){
    let rs = (state.report || []).slice();
    const client = $("#filter-ch-client")?.value || "";
    const car    = $("#filter-ch-car")?.value    || "";
    const from   = ($("#ch-from")?.value || "").trim();
    const to     = ($("#ch-to")?.value   || "").trim();
    if (client) rs = rs.filter(r => r.client_name === client);
    if (car)    rs = rs.filter(r => carLabel(r) === car);
    // "Rentals running in this window" — an overlap, not a start-date match, so
    // a long rental that spans the window still counts.
    if (from) rs = rs.filter(r => r.end_date   && String(r.end_date).slice(0, 10)   >= from);
    if (to)   rs = rs.filter(r => r.start_date && String(r.start_date).slice(0, 10) <= to);
    return rs;
  }

  function populateFilters(){
    // Built from the same feed the table renders, so a pick can't come back empty.
    populateFilterSelect($("#filter-ch-client"), (state.report || []).map(r => r.client_name));
    populateFilterSelect($("#filter-ch-car"),    (state.report || []).map(r => carLabel(r)));
  }

  function render(){
    const today = _raToday();
    const ltr   = (v) => `<span class="ltr">${escape(v)}</span>`;
    const dash  = `<span class="cell-dash">—</span>`;
    const day   = (d) => d ? ltr(String(d).slice(0, 10)) : dash;
    const lbl   = (k) => escape(t(k));
    const gpsPill = (on) => on
      ? `<span class="badge yes">${escape(t("yes"))}</span>`
      : `<span class="badge no">${escape(t("no"))}</span>`;

    _groups = groupReportByClient(rows());
    // How many DIFFERENT companies this client has rented from — the fact that
    // makes this table worth having, so it gets its own column.
    _groups.forEach(g => {
      g.companies = new Set(g.rentals.map(x => x.r.company_id)).size;
    });

    renderMasterHistory({
      table: "#tbl-client-history", cols: 7,
      pagerKey: "client-history",
      pagerTop: "#pager-top-client-history", pagerBot: "#pager-client-history",
      countEl: "#ch-count", panelPrefix: "chist", groups: _groups,
      rerender: render,
      masterCells: (g) => {
        const avatar = `<span class="ch-avatar" style="background:${_avatarColor(g.name)}" aria-hidden="true">${escape(_initials(g.name))}</span>`;
        const period = `${day(g.latest.start_date)}<span class="rp-arrow">→</span>${day(g.latest.end_date)}`;
        return `
          <td data-col="client" data-label="${lbl("report.client")}">
            <span class="ch-client">${avatar}<strong>${escape(g.name) || "—"}</strong></span>
          </td>
          <td data-col="phone" data-label="${lbl("report.phone")}">${formatPhonesCell(g.phone)}</td>
          <td data-col="rentals" data-label="${lbl("report.rentals")}">${g.rentals.length}</td>
          <td data-col="cars" data-label="${lbl("report.carsCount")}">${g.cars}</td>
          <td data-col="companies" data-label="${lbl("clientHistory.th.companies")}">${g.companies}</td>
          <td data-col="latest" data-label="${lbl("report.latest")}">${period}</td>`;
      },
      // One rental. The COMPANY leads the sub-line here — "which company did
      // they rent this from" is the question this table exists to answer.
      item: (x, i) => {
        const r = x.r;
        const st = BOOKING_STATUSES.includes(r.status) ? r.status : "active";
        let tags;
        if (r.returned_at){
          tags = `<span class="return-badge returned">${escape(t("special.status.returned"))}</span>`;
        } else {
          const late = st !== "cancelled" && _raStatus(r, today) === "overdue"
            ? `<span class="return-badge overdue">${escape(t("returns.overdue"))}</span>` : "";
          tags = `<span class="status-tag ${st}">${escape(t("status." + st + ".short"))}</span>${late}`;
        }
        return `<li class="ch-item${st === "cancelled" ? " ch-item-off" : ""}">
          <div class="ch-car">
            <span class="ch-model">${r.car_model ? escape(r.car_model) : dash}</span>
            <span class="ch-sub">
              <span class="ch-org">${lbl("clientHistory.rentedFrom")} ${r.company_name ? escape(r.company_name) : dash}</span>
              <span class="ch-dot" aria-hidden="true">·</span>
              <span class="ch-plate">${r.car_plate ? ltr(r.car_plate) : dash}</span>
              <span class="ch-dot" aria-hidden="true">·</span>
              <span class="ch-gps">${lbl("report.gps")} ${gpsPill(r.car_has_gps)}</span>
            </span>
          </div>
          <div class="ch-dates">${day(r.start_date)}<span class="rp-arrow">→</span>${day(r.end_date)}</div>
          <div class="ch-tags">${tags}</div>
          <button type="button" class="row-btn ch-open" data-i="${i}">${lbl("report.details")}</button>
        </li>`;
      },
      // groupReportByClient wraps each rental as {r, idx}; the modal wants the
      // rental itself. It takes the ROW OBJECT, never an index into a feed, so
      // the table underneath can re-render without the modal going stale.
      openItem: (x) => ReportRow.open(x.r),
    });
  }

  async function refresh(){
    const u = (typeof AUTH !== "undefined") ? AUTH.user() : null;
    if (!u || u.role !== "admin") return;
    // The report feed is shared with the Cars hub's Report view. Fetch it only
    // if nobody has yet — opening this tab shouldn't re-download it.
    if (!(state.report || []).length){
      try { state.report = await API.report(); } catch (e){ state.report = []; }
    }
    populateFilters();
    Pager.reset("client-history");
    render();
  }

  function count(){ return _groups.length; }

  function setup(){
    if (_wired) return;
    _wired = true;
    ["#filter-ch-client", "#filter-ch-car"].forEach(sel => {
      // SearchSelect dispatches `change` only — wiring `input` here silently
      // never fires.
      $(sel)?.addEventListener("change", () => { Pager.reset("client-history"); render(); });
    });
    ["#ch-from", "#ch-to"].forEach(sel => {
      $(sel)?.addEventListener("change", () => { Pager.reset("client-history"); render(); });
      $(sel)?.addEventListener("input",  () => { Pager.reset("client-history"); render(); });
    });
    $("#ch-reset")?.addEventListener("click", () => {
      clearFilterSelect($("#filter-ch-client"));
      clearFilterSelect($("#filter-ch-car"));
      const f = $("#ch-from"); if (f) f.value = "";
      const t2 = $("#ch-to");  if (t2) t2.value = "";
      Pager.reset("client-history");
      render();
    });
  }

  return { setup, refresh, render, count, _rows: rows };
})();

/* ============== ADMIN: which companies rent, from whom, and what =============
   The B2B feed one level up. The Cars hub's "Rented by companies" is one row
   per RECORD; this is one row per RENTING COMPANY, expanding into which
   registered company it took each car from. `company_name` on these records is
   the RENTER (free text — a B2B counterparty, not a registered company), while
   `company_id` is the registered company that OWNS the car and rented it out.
   Getting those two backwards inverts the whole table. */
const AdminCompanyHistory = (() => {
  let _wired = false;
  let _all = [];
  let _groups = [];

  const carLabelOf = (r) => !r || !r.model ? ""
    : (r.platenumber ? `${r.model} — ${r.platenumber}` : r.model);
  const ownerName = (r) => {
    const co = (state.companies || []).find(c => c.id === Number(r.company_id));
    return co ? co.companyname : "";
  };

  function rows(){
    let rs = _all.slice();
    const co   = $("#filter-coh-company")?.value || "";
    const car  = $("#filter-coh-car")?.value     || "";
    const from = ($("#coh-from")?.value || "").trim();
    const to   = ($("#coh-to")?.value   || "").trim();
    if (co)  rs = rs.filter(r => r.company_name === co);
    if (car) rs = rs.filter(r => carLabelOf(r) === car);
    if (from) rs = rs.filter(r => r.end_date   && String(r.end_date).slice(0, 10)   >= from);
    if (to)   rs = rs.filter(r => r.start_date && String(r.start_date).slice(0, 10) <= to);
    return rs;
  }

  function populateFilters(){
    populateFilterSelect($("#filter-coh-company"), _all.map(r => r.company_name));
    populateFilterSelect($("#filter-coh-car"),     _all.map(carLabelOf));
  }

  // Group by the RENTER. Its name is free text, so the name IS the identity —
  // there's no id to key on the way client_id keys a client.
  function groupByRenter(rs){
    const by = new Map();
    rs.forEach(r => {
      const key = `co:${(r.company_name || "").trim().toLowerCase()}`;
      let g = by.get(key);
      if (!g){ g = { key, name: r.company_name || "", owner: r.owner_name || "", rentals: [] }; by.set(key, g); }
      g.rentals.push(r);
      if (!g.owner && r.owner_name) g.owner = r.owner_name;
    });
    const started = (r) => String(r.start_date || "").slice(0, 10);
    const gs = [...by.values()];
    gs.forEach(g => {
      g.rentals.sort((a, b) => started(b).localeCompare(started(a)));
      g.cars   = new Set(g.rentals.map(r => r.car_vin || carLabelOf(r))).size;
      g.froms  = new Set(g.rentals.map(r => r.company_id)).size;
      g.latest = g.rentals[0];
    });
    return gs.sort((a, b) => started(b.latest).localeCompare(started(a.latest)));
  }

  function render(){
    const ltr  = (v) => `<span class="ltr">${escape(v)}</span>`;
    const dash = `<span class="cell-dash">—</span>`;
    const day  = (d) => d ? ltr(String(d).slice(0, 10)) : dash;
    const lbl  = (k) => escape(t(k));
    const gpsPill = (on) => on
      ? `<span class="badge yes">${escape(t("yes"))}</span>`
      : `<span class="badge no">${escape(t("no"))}</span>`;

    _groups = groupByRenter(rows());

    renderMasterHistory({
      table: "#tbl-company-history", cols: 6,
      pagerKey: "company-history",
      pagerTop: "#pager-top-company-history", pagerBot: "#pager-company-history",
      countEl: "#coh-count", panelPrefix: "cohist", groups: _groups,
      rerender: render,
      masterCells: (g) => {
        const avatar = `<span class="ch-avatar" style="background:${_avatarColor(g.name)}" aria-hidden="true">${escape(_initials(g.name))}</span>`;
        const period = `${day(g.latest.start_date)}<span class="rp-arrow">→</span>${day(g.latest.end_date)}`;
        const sub = g.owner ? `<span class="sr-sub">${escape(g.owner)}</span>` : "";
        return `
          <td data-col="client" data-label="${lbl("coHistory.th.renter")}">
            <span class="ch-client">${avatar}<span class="sr-stack"><strong>${escape(g.name) || "—"}</strong>${sub}</span></span>
          </td>
          <td data-col="from" data-label="${lbl("coHistory.th.from")}">${g.froms}</td>
          <td data-col="rentals" data-label="${lbl("report.rentals")}">${g.rentals.length}</td>
          <td data-col="cars" data-label="${lbl("report.carsCount")}">${g.cars}</td>
          <td data-col="latest" data-label="${lbl("report.latest")}">${period}</td>`;
      },
      // One B2B record. "Rented from" leads: this table exists to say who each
      // company took its cars from.
      item: (r, i) => {
        const st = BOOKING_STATUSES.includes(r.status) ? r.status : "active";
        let tags;
        if (r.returned_at){
          tags = `<span class="return-badge returned">${escape(t("special.status.returned"))}</span>`;
        } else {
          const late = st === "active" && r.end_date && String(r.end_date).slice(0, 10) < _raToday()
            ? `<span class="return-badge overdue">${escape(t("returns.overdue"))}</span>` : "";
          tags = `<span class="status-tag ${st}">${escape(t("status." + st + ".short"))}</span>${late}`;
        }
        const from = ownerName(r);
        return `<li class="ch-item${st === "cancelled" ? " ch-item-off" : ""}">
          <div class="ch-car">
            <span class="ch-model">${r.model ? escape(r.model) : dash}</span>
            <span class="ch-sub">
              <span class="ch-org">${lbl("clientHistory.rentedFrom")} ${from ? escape(from) : dash}</span>
              <span class="ch-dot" aria-hidden="true">·</span>
              <span class="ch-plate">${r.platenumber ? ltr(r.platenumber) : dash}</span>
              <span class="ch-dot" aria-hidden="true">·</span>
              <span class="ch-gps">${lbl("report.gps")} ${gpsPill(r.has_gps)}</span>
            </span>
          </div>
          <div class="ch-dates">${day(r.start_date)}<span class="rp-arrow">→</span>${day(r.end_date)}</div>
          <div class="ch-tags">${tags}</div>
          <button type="button" class="row-btn ch-open" data-i="${i}">${lbl("report.details")}</button>
        </li>`;
      },
      // Same single-car shape AdminSpecial.carsFor() builds — SpecialDetail
      // wants a list, and an admin B2B row carries exactly one joined car.
      openItem: (r) => SpecialDetail.open(r, [{
        vin: r.car_vin, model: r.model, color: r.color,
        platenumber: r.platenumber, has_gps: r.has_gps, type: r.type,
      }]),
    });
  }

  async function refresh(){
    const u = (typeof AUTH !== "undefined") ? AUTH.user() : null;
    if (!u || u.role !== "admin") return;
    try { _all = await API.listAdminSpecialRentals(); }
    catch (e){ _all = []; }
    populateFilters();
    Pager.reset("company-history");
    render();
  }

  function count(){ return _groups.length; }

  function setup(){
    if (_wired) return;
    _wired = true;
    ["#filter-coh-company", "#filter-coh-car"].forEach(sel => {
      $(sel)?.addEventListener("change", () => { Pager.reset("company-history"); render(); });
    });
    ["#coh-from", "#coh-to"].forEach(sel => {
      $(sel)?.addEventListener("change", () => { Pager.reset("company-history"); render(); });
      $(sel)?.addEventListener("input",  () => { Pager.reset("company-history"); render(); });
    });
    $("#coh-reset")?.addEventListener("click", () => {
      clearFilterSelect($("#filter-coh-company"));
      clearFilterSelect($("#filter-coh-car"));
      const f = $("#coh-from"); if (f) f.value = "";
      const t2 = $("#coh-to");  if (t2) t2.value = "";
      Pager.reset("company-history");
      render();
    });
  }

  return { setup, refresh, render, count };
})();

/* ============== The Clients hub ==============
   Same shape as AdminCarsHub: three views of the same people in one section,
   swapped by the segmented control. `.hub-*` is generic, so this cost no CSS. */
const ClientsHub = (() => {
  const VIEWS = ["list", "history", "cohistory"];
  let _view = "list";
  let _wired = false;

  function setCount(sel, n){ const el = $(sel); if (el) el.textContent = n; }

  function syncCounts(){
    setCount("#hub-count-clients-list", (state.clients || []).length);
    setCount("#hub-count-clients-history", AdminClientHistory.count());
    setCount("#hub-count-clients-cohistory", AdminCompanyHistory.count());
  }

  function show(view){
    if (!VIEWS.includes(view)) view = "list";
    _view = view;
    $$("#clients .hub-view").forEach(v => { v.hidden = v.dataset.clientviewPanel !== view; });
    $$("#clients .hub-tab").forEach(b => {
      const on = b.dataset.clientview === view;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    // Both histories are per-open loads: their feeds are big, and unlike the
    // Cars hub's badges nobody needs the number before clicking the tab.
    if (view === "history")   AdminClientHistory.refresh();
    if (view === "cohistory") AdminCompanyHistory.refresh();
    syncCounts();
  }

  function refresh(){ syncCounts(); }

  function setup(){
    if (_wired || !$("#clients")) return;
    _wired = true;
    $$("#clients .hub-tab").forEach(b => {
      b.addEventListener("click", () => show(b.dataset.clientview));
    });
    AdminClientHistory.setup();
    AdminCompanyHistory.setup();
  }

  return { setup, show, refresh, syncCounts, view: () => _view };
})();

/* ============== B2B RENTAL DETAIL (view + car media) ==============
   Read-only view of one "cars rented to companies" record, plus photo /
   video upload for the car — mirrors the regular rental Detail modal but
   hits the /api/special-rentals/<id>/media endpoints. */
const SpecialDetail = (() => {
  let currentId = null, currentRec = null, currentCar = null;

  function carOf(rec, cars){
    const vin = rec.car_vin || String(rec.car_vins || "").split(",")[0]?.trim();
    return (cars || []).find(c => c.vin === vin) || {};
  }

  // Saved B2B coordinate is (x = lng, y = lat) — same convention as companies.
  // A pin opens the in-app map at those coords; the "View on map" link opens
  // Google Maps ("lat,lng" → q=y,x). Only shown when x/y were actually picked.
  const _hasXY = (x, y) => x != null && y != null && x !== "" && y !== "";
  const mapsUrl = (x, y) => _hasXY(x, y)
    ? `https://www.google.com/maps?q=${encodeURIComponent(y)},${encodeURIComponent(x)}` : "";
  const locPin = (name, x, y) => {
    if (!name && !_hasXY(x, y)) return "";
    const coordAttrs = _hasXY(x, y) ? ` data-x="${x}" data-y="${y}"` : "";
    return ` <button type="button" class="rd-loc-pin" data-name="${escape(name || "")}"${coordAttrs} title="${escape(t("companies.viewOnMap"))}" aria-label="${escape(t("companies.viewOnMap"))}">`
      + `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>`
      + `</button>`;
  };
  const mapsLink = (x, y) => {
    const u = mapsUrl(x, y);
    return u ? `<a href="${escape(u)}" target="_blank" rel="noopener" class="rd-maplink">${escape(t("special.mapLink"))}</a>` : "—";
  };
  // Wire each pin to open the in-app Leaflet viewer at its coords (or geocode
  // the bare place name), mirroring the company detail modal.
  function bindLocPins(root){
    $$(".rd-loc-pin", root).forEach(btn => {
      btn.addEventListener("click", () => {
        MapPicker.openLocation({
          x: btn.dataset.x != null ? Number(btn.dataset.x) : null,
          y: btn.dataset.y != null ? Number(btn.dataset.y) : null,
          label: btn.dataset.name,
        });
      });
    });
  }

  function bodyHtml(rec, cars){
    const k = (key) => escape(t(key));
    const v = (x) => (x == null || x === "") ? "—" : escape(String(x));
    const day = (d) => d ? escape(String(d).slice(0, 10)) : "—";
    const c = carOf(rec, cars);
    const splitCsv = (s) => String(s || "").split(",").map(x => x.trim()).filter(Boolean);
    const phones = rec.phones ? splitCsv(rec.phones) : [rec.phone, rec.extra_phone].filter(Boolean);
    const branches = rec.branches ? splitCsv(rec.branches) : [rec.branch, rec.extra_branch].filter(Boolean);
    const gps = c.has_gps
      ? `<span class="badge yes">${k("yes")}</span>`
      : `<span class="badge no">${k("no")}</span>`;
    return `
      <dl class="detail-grid">
        <dt>${k("special.th.company")}</dt> <dd><strong>${v(rec.company_name)}</strong></dd>
        <dt>${k("special.th.owner")}</dt>   <dd>${v(rec.owner_name)}</dd>
        <dt>${k("special.th.phone")}</dt>   <dd class="ltr">${phones.length ? phones.map(escape).join(" · ") : "—"}</dd>
        <dt>${k("special.f.branches")}</dt> <dd>${branches.length ? branches.map(escape).join(" · ") : "—"}</dd>
        <dt>${k("special.f.address")}</dt>  <dd>${v(rec.location)}${locPin(rec.location, rec.x, rec.y)}</dd>
        <dt>${k("special.f.location")}</dt> <dd>${mapsLink(rec.x, rec.y)}</dd>
        <div class="full"></div>
        <dt>${k("special.th.model")}</dt>   <dd>${v(c.model)}</dd>
        <dt>${k("special.th.color")}</dt>   <dd>${v(c.color)}</dd>
        <dt>${k("special.th.plate")}</dt>   <dd class="ltr">${v(c.platenumber)}</dd>
        <dt>${k("cars.f.vin")}</dt>         <dd><code>${v(c.vin || rec.car_vin)}</code></dd>
        <dt>${k("special.th.gps")}</dt>     <dd>${gps}</dd>
        <div class="full"></div>
        <dt>${k("special.th.from")}</dt>    <dd class="ltr">${day(rec.start_date)}</dd>
        <dt>${k("special.th.to")}</dt>      <dd class="ltr">${day(rec.end_date)}</dd>
        ${rec.notes ? `<div class="full"></div><dt>${k("special.f.notes")}</dt><dd>${v(rec.notes)}</dd>` : ""}
      </dl>`;
  }

  async function loadMedia(id){
    const photosGrid = $("#special-photos-grid");
    const videosGrid = $("#special-videos-grid");
    if (photosGrid) photosGrid.innerHTML = "";
    if (videosGrid) videosGrid.innerHTML = "";
    if (!id) return;
    try {
      const r = await fetch(API.url(`/api/special-rentals/${id}/media`), { headers: { ...authHeaders() } });
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
    if (!currentId) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    try {
      const r = await fetch(API.url(`/api/special-rentals/${currentId}/media`), {
        method: "POST", headers: { ...authHeaders() }, body: fd,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok){ toast(data.error || t("toast.error"), "error"); return; }
      toast(t("detail.uploaded"), "success");
      await loadMedia(currentId);
    } catch (err){ toast(err.message || t("toast.error"), "error"); }
  }

  async function deleteMedia(mediaId){
    if (!currentId) return;
    if (!confirm(t("confirm.delete"))) return;
    try {
      const r = await fetch(API.url(`/api/special-rentals/${currentId}/media/${mediaId}`), {
        method: "DELETE", headers: { ...authHeaders() },
      });
      if (!r.ok && r.status !== 204){
        const err = await r.json().catch(() => ({ error: r.statusText }));
        toast(err.error || t("toast.error"), "error"); return;
      }
      toast(t("toast.deleted"), "success");
      await loadMedia(currentId);
    } catch (err){ toast(err.message || t("toast.error"), "error"); }
  }

  function open(rec, cars){
    currentId = rec.id;
    currentRec = rec;
    currentCar = carOf(rec, cars);
    $("#special-detail-body").innerHTML = bodyHtml(rec, cars);
    bindLocPins($("#special-detail-body"));
    loadMedia(rec.id);
    showModal("#special-detail-modal");
  }

  // Clean one-page PDF of the record: the company it's rented to + the car.
  function pdf(){
    if (!currentRec) return;
    const rec = currentRec, c = currentCar || {};
    const splitCsv = (s) => String(s || "").split(",").map(x => x.trim()).filter(Boolean);
    const phones = rec.phones ? splitCsv(rec.phones) : [rec.phone, rec.extra_phone].filter(Boolean);
    const branches = rec.branches ? splitCsv(rec.branches) : [rec.branch, rec.extra_branch].filter(Boolean);
    const day = (d) => d ? String(d).slice(0, 10) : "";
    printDoc(t("special.detail.title"), rec.company_name, pdfRows([
      [t("special.th.company"),  rec.company_name],
      [t("special.th.owner"),    rec.owner_name],
      [t("special.th.phone"),    phones.join(" · ")],
      [t("special.f.branches"),  branches.join(" · ")],
      [t("special.f.address"),   rec.location],
      [t("special.th.model"),    c.model],
      [t("special.th.color"),    c.color],
      [t("special.th.plate"),    c.platenumber],
      [t("cars.f.vin"),          c.vin || rec.car_vin],
      [t("special.th.gps"),      c.has_gps ? t("yes") : t("no")],
      [t("special.th.from"),     day(rec.start_date)],
      [t("special.th.to"),       day(rec.end_date)],
      [t("special.f.notes"),     rec.notes],
    ]));
  }

  function setup(){
    $("#special-detail-close")?.addEventListener("click", () => hideModal("#special-detail-modal"));
    $("#special-detail-cancel")?.addEventListener("click", () => hideModal("#special-detail-modal"));
    $("#special-detail-pdf")?.addEventListener("click", pdf);
    $("#special-upload-photo")?.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      for (const f of files) await uploadMedia(f, "photo");
      e.target.value = "";
    });
    $("#special-upload-video")?.addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (f) await uploadMedia(f, "video");
      e.target.value = "";
    });
    ["#special-photos-grid", "#special-videos-grid"].forEach(sel => {
      $(sel)?.addEventListener("click", (e) => {
        const btn = e.target.closest(".media-remove");
        if (btn) deleteMedia(btn.dataset.id);
      });
    });
  }

  return { open, setup };
})();

async function init(){
  setupAuth();
  setupMobileNav();
  setupResponsiveTables();
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
  setupAddCarJson();
  setupApiKey();
  setupAddClientForm();
  setupCreateRentalForm();
  Returns.setup();
  SpecialRentals.setup();
  CarsHub.setup();          // after SpecialRentals — the hub drives its modal
  CoClientsHub.setup();     // the register + clients-history tabs
  SpecialDetail.setup();
  Notifications.setup();
  setupSupportForm();
  setupReportSearch();
  MapPicker.setup();
  CarGps.setup();
  setupReportPdf();

  // Enhance every <select> on the page with a searchable dropdown.
  if (typeof enhanceSelects === "function") enhanceSelects();
  // The car dropdown starts disabled until a company is picked.
  rebuildCarsVehicleDropdown();

  if (AUTH.isAuthed()){
    await enterApp();
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
  Returns.render();
});
