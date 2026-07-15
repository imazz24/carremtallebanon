# CLAUDE.md

Guidance for working in this repo. Read the "Traps" section before touching the
frontend — every item there cost a real debugging session at least once.

## What this is

A Lebanon-focused car rental app: **Flask** (`backend/`) + **vanilla JS, no
framework** (`frontend/`) + **Postgres**, run under Docker Compose.

Two signed-in roles, both dark-themed by default, with a light toggle:

- **admin** — sees every company. It has **no Report tab**: the rental report is a
  view inside Cars (see "The Cars hub").
- **company** — sees only its own data. Panels are driven by a sidebar (`data-cpanel`)
  and a home card grid (`data-cgo`), not the header nav (which is hidden for both roles).

**`#report` no longer exists.** It was the company's Clients History; that table is
a *view inside* `#company-clients` now (see "The company's clients hub"). Both roles'
report surfaces are tabs in a bigger panel — neither has a section of its own.

Auth is an `X-Auth-User` header. No JWT, no sessions. The external batch API uses
API keys instead (see `API_GUIDE.md`).

## Running it

```bash
docker compose up -d --build app     # rebuild + restart
curl http://localhost:5000/api/health
```

The app is at <http://localhost:5000>. `backend/entrypoint.sh` auto-applies pending
migrations (tracked in the `_migrations` table, each file once) and, when `RUN_SEED=1`
(set by `docker-compose.override.yml` locally), re-applies the demo seeds. Base compose
sets `RUN_SEED=0`, so prod never gets fake companies.

### Two traps that waste hours

1. **The frontend is baked into the image.** Editing `frontend/` and reloading the
   browser does nothing. You must `docker compose up -d --build app`. Verify what
   actually shipped by curling the served asset, not by reading the file on disk.
2. **There are two Postgres instances.** The app uses the Docker container
   (`carrental-postgres`, port not published to the host). `backend/.venv` + `.env`
   point at a *separate* host Postgres on `localhost:5432`. Seeding through the venv
   is invisible to the app. To touch live data:
   ```bash
   docker exec carrental-postgres psql -U postgres -d carrental -c "..."
   ```

After a rebuild the container needs a moment; poll `/api/health` before curling
assets or you'll get a bare `curl` exit 52.

## Testing

**Do not use Playwright.** This is a standing instruction from the repo owner.
Consequence: you cannot observe rendering. Report visual outcomes as unverified and
say so plainly rather than implying you checked.

What you *can* do, and should:

- `node --check frontend/js/app.js` — catches syntax errors.
- Curl the served asset and grep it — proves what shipped.
- Replay logic in Node against real API data (`curl -H "X-Auth-User: <user>"
  http://localhost:5000/api/rentals/report`).
- Extract a module from the shipped file and drive it directly. The `Pager` IIFE
  can be pulled out with `indexOf`/`eval` and exercised with a DOM stub — that's how
  the per-client history pager's page turns were verified.

Beware: the Bash tool's heredocs collapse backslashes, so `\\s` in a JS regex arrives
as `s` and silently matches nothing. Write scratch scripts with the Write tool.

Logins: admin `admin`/`admin`. Company test account `test_modal_co`/`abcd`
(company_id 12). `sarkisrentacar` (company_id 4795) has real-ish rental data.

## Traps in the frontend

### A hub is named for what it holds

Every panel that became a hub kept the name of the *one tab it started as*, which then
described a fraction of what was behind it: "Cars" hid the two "rented by" tables, the
live map and the rental report; "Clients" hid two history views; "Add Client" hid the
company's whole clients history. The home cards read as a list of forms.

They're named for the hub now — **Fleet & Rentals**, **Clients & History**, **Add Client
& See History** — and the **section `<h2>` shares the card's key**, so the card you click
and the panel you land on agree. Three keys are involved and they are not
interchangeable:

| key | names |
|---|---|
| `admin.card.cars.title` | the Cars **hub** — home card + `#cars` `<h2>` |
| `admin.card.clients.title` | the Clients **hub** — home card + `#clients` `<h2>` |
| `coClients.title` | the company's clients **hub** — sidebar + `#company-clients` `<h2>` |
| `cars.title` / `clients.title` | **one** car / **one** client — `EntityDetail`'s modal |

That last row is the trap: `cars.title` and `clients.title` look like the obvious keys to
retitle, and `EntityDetail` titles a single record with them (`titleKey`). Renaming them
would have made one car's detail modal say "Fleet & Rentals". They stay singular.

### i18n overwrites your HTML

`applyI18n()` does `el.textContent = t(key)` for every `[data-i18n]`. **Editing the
inline text in `index.html` changes nothing on screen** — it's only the pre-translation
fallback. Change the value in `frontend/js/i18n.js`, in *both* the English and Arabic
tables.

`t(key)` falls back current-lang → English → the literal key string. So a key missing
only from Arabic quietly shows English; missing from both renders the raw key.

Every user-facing string needs both languages. Arabic is RTL — wrap atomic Latin
tokens (dates, phones, plates) in `<span class="ltr">`.

### Theme rules must be gated

Both signed-in roles are dark by default; the toggle sets `body.theme-light`. Every
shared dark rule is gated `:not(.theme-light)`. Dark rules written without the gate
leak pale inks (`#fde68a`, `#a7f3d0`…) onto the light theme's white card and become
invisible. This has happened; don't repeat it.

### Responsive tables are card grids, and `[hidden]` loses

Tables render three ways:

| width | rendering |
|---|---|
| ≤720px | stacked cards, one per row |
| 721–1024px | card grid (`.table-wrap:not(.bento-table)`) |
| ≥1025px | real dense table |

In both card modes, CSS sets `display` on **every** `tbody tr`, which outranks the UA's
`[hidden] { display: none }`. An expandable detail row will therefore render *always
open* unless you add an id-scoped rule:

```css
#tbl-x tbody tr.detail-row[hidden] { display: none; }
```

and guard the card-mode overrides with `:not([hidden])` so they can't out-specify it.
Precedent: `#tbl-companies tr.company-branch-row[hidden]`.

Cells get their card-mode label from `data-label`; cells without one right-align with
no label (correct for action buttons).

### SearchSelect

`frontend/js/searchselect.js` wraps a native `<select>`; the select stays the source of
truth. Rules:

- It dispatches **`change` only, never `input`.** Wiring a filter select to `input`
  means picks silently don't apply.
- After changing `.value` programmatically, call `_ss.sync()` or the trigger keeps
  showing the stale label. Use the `clearFilterSelect()` helper.
- `data-ss-prefix="3"` is the house convention: under 3 typed chars every option stays
  visible (scroll-pick works); at 3+ it matches by `startsWith`.
- `data-ss-skip` opts out (used by the status pills, which want a native dropdown).
- `enhanceSelects()` runs over the whole document at init, so static markup is picked
  up automatically. Selects built later (e.g. the pager's size select) stay native.

Helpers: `populateFilterSelect(sel, values)` dedupes/sorts, keeps the placeholder,
prepends "— All —", preserves the current value, and syncs. `carLabel(r)` returns
`"Model — Plate"`, unique per car.

### Pager

`Pager.slice(key, rows)` / `Pager.render(key, topSel, bottomSel, info, onChange)`.
State is keyed by string and persists across re-renders, so:

- distinct keys page independently (the company report uses `report` for the client
  list and `report-history:<clientKey>` per client);
- `slice()` clamps an out-of-range page, so shrinking a filtered list self-heals;
- `render()` hides itself entirely at ≤10 rows;
- it takes **selectors**, so the target elements must already be in the DOM.

## Data model note

Migration `040_rental_status.sql` folded `reservations` into `rentals` as
`status IN ('active','pending','cancelled')`, and added the same to
`special_company_rentals`. Status is the *booking* state and is **orthogonal to
`returned_at`** — an active booking still derives Out / Due today / Overdue / Returned
from its dates. The `reservations` table is dormant, not dropped; the public
`/api/reservations/*` endpoints are repointed onto pending rentals.

`v_client_rentals` is the report view (client + company + car + rental, joined).

## The Cars hub (both roles)

Each role's Cars panel is one section holding several views of the same cars, swapped
by a `.hub-tab` segmented control. Company gets three (the fleet, *rented by
individuals*, *rented by companies*); **admin gets those three plus the live GPS map
and the rental report**. The CSS (`.hub-tabs` / `.hub-tab` / `.hub-view`) is generic and
token-driven — it is **not** role-scoped, so both roles get it for free, and neither the
fourth nor the fifth tab needed a single new rule.

|  | company | admin |
|---|---|---|
| section | `#company-cars` | `#cars` |
| view attr | `data-carview-panel` | `data-adminview-panel` |
| views | fleet, individual, company | fleet, individual, company, **gps**, **report** |
| module | the `CompanyCars` IIFE | `AdminCarsHub` |
| data entry | modals, from the header actions | inline `#form-car`, on the fleet view |

`AdminCarsHub` only swaps views and keeps the tab badges honest — the tables stay
owned by `AdminSpecial` / `AdminIndividual` and the map by `CarGps`, all of which are
keyed by element **id**, so the markup moved without touching them.

Things worth knowing before editing this:

- **`admin-special`, `admin-individual` and `car-gps` are no longer panels.** They're
  views, and their home cards / sidebar entries are gone — the Cars card is the only
  door. `AdminSidebar.show()` still maps the three old names onto the Cars panel plus
  the matching view via `CAR_VIEWS`, so old links keep working. Adding something that
  opens a view means adding to that map, **not** to `PANELS`.
- **The fleet badge reads `fleet.summary`**, the same object the tree renders, so it
  tracks the fleet filters instead of lagging one behind. `renderFleet()` calls
  `AdminCarsHub.syncCounts()` for exactly that reason.
- **The map tab carries no `.hub-tab-count`, on purpose.** It locates one car rather
  than listing records, and the only number it could show (GPS-equipped cars) costs a
  ~430-car fetch that the other three tabs don't pay. `.hub-tabs` lays out fine with a
  badge-less tab.
- **`AdminCarsHub.show("gps")` calls `CarGps.onShow()`, and order matters.** Leaflet
  can only size itself against a laid-out container, so `onShow()` must run *after* the
  view is un-hidden — never before. That call is also where the GPS view loads its
  cars, which is why `AdminCarsHub.refresh()` (panel open) doesn't fetch them.
- **The report view loads on `show("report")`, not on `refresh()`** — same reasoning as
  the map: the other tabs' rows are fetched together on panel-open so their badges are
  right whichever tab you land on, but the report feed is big enough to stay a
  per-open load.
- **The report badge is pushed in, not pulled.** `renderReport()` calls
  `AdminCarsHub.syncReportCount(rows.length)` with the **filtered** count; the hub holds
  it so a `syncCounts()` from another tab can't blank it. Pulling it here would report
  the unfiltered feed and lag the toolbar by one change.

### The report moved out of `#report` (admin only)

The admin's rental report — the flat one-row-per-rental grid, the **Data Insights**
charts and their toolbar — was its own panel, listing the same rentals the two "rented
by …" tables already showed. It's the fifth view now. What was left of `#report` was
the **company's** Clients History, and that has since moved too — into
`#company-clients`, so the section is gone entirely.

Three things this forced, all of them load-bearing:

- **The pagers are suffixed `-admin`.** Both `renderReport()` and
  `renderReportCompany()` resolve their pager by id, and `$()` returns the **first**
  match — one shared id would hand the company's pager to whichever copy the DOM listed
  first. The Cars view uses `#pager-top-report-admin` / `#pager-report-admin`; the
  company's copy keeps the plain pair. Same for `#btn-export-pdf-admin`. The two live in
  different sections now, which does **not** make this safe to undo — `$()` searches the
  whole document.
- **`"report"` is in `CAR_VIEWS`, not `PANELS`.** Leaving it in `PANELS` would toggle
  `.admin-panel-active` on the company's section. `AdminSidebar.show("report")` maps it
  onto Cars + the view, so old links and bookmarks still land.
- **The `#cars` count badges, the fleet form and the report now share one section** —
  the report's ids didn't change, so `renderReport` / `renderReportAnalytics` / the PDF
  export all still find their elements. Only the host moved.

## Row detail: modal (admin) vs inline (company)

The two report tables answer different questions, so they open a row differently.
**Don't "unify" them** — the split is the design.

| | admin `#tbl-report` | company `#tbl-report-co` |
|---|---|---|
| lives in | the Cars hub's Report view | the clients hub's History view |
| a row is | one rental | one client |
| clicking it | opens `#report-row-modal` | expands a panel underneath |
| module | `ReportRow` | `renderReportCompany()` + `expandedReportClients` |
| why | one record's fields — a modal has the room | a list you scan against its neighbours |

`ReportRow.open(r)` takes the **row object**, never a DOM index, so the table can
re-render beneath it (filter, page turn, language switch) without the modal going
stale. Its receipt CSS lives under `#report-row-body`, which is also where the
inline panel's rules moved to — `#report-row-body .rd-item` has to *undo* the
dashboard's global `.rd-item` card styling (same class name, different thing).

Three traps here:

- **The tbody listener is delegated and wired exactly once**, via
  `wireReportRowClicks()` + `_reportRowsWired`. `renderReport()` re-runs on every
  filter change and page turn but only replaces the tbody's `innerHTML` — the
  element itself survives, so wiring per render would **stack** listeners and one
  click would open the modal once per past render. For the same reason the
  listener reads `_reportRows` (reassigned each render) instead of closing over
  `rows`.
- **Hand-offs close before they open.** The modal's media button and its three
  drill buttons `hideModal()` first, then open `Detail` / `EntityDetail`. Modals
  share a z-index and `hideModal()` only releases the scroll lock when none are
  left, so two would happily stack their backdrops. `#report-row-modal` is also
  declared *before* those modals in `index.html` as a second line of defence.
- **A drill renders only when its key exists** (`drill()` returns `""` for a null
  `client_id` / empty `car_vin`), so the modal never shows a button that does
  nothing.

## Booking status: the company moves it, the admin reads it

**This split is the design — don't "unify" it.** A booking belongs to the company that
took it, so that company moves it between pending / active / cancelled from its own
Cars & Rentals tables. The admin sees the result across every company and **cannot
change it**.

| | renders | where |
|---|---|---|
| `statusPicker()` | a `<select>` in a `.status-pick` pill | the **company** hub's two "rented by …" tables |
| `statusTag()` | a read-only `.status-tag` pill, same tints, no caret | **all three admin** Cars-hub tables + the company's client history |

Shared rules, wherever the state is shown:

- **A returned booking shows "Returned" and nothing else** — it's settled, so the state
  it held on the way there is history, and "Active · Returned" read as a contradiction.
  In the admin report that's 22 of 54 live rows. This rule was *written here* before it
  was true everywhere: the company's two tables obeyed it, but the admin report, the
  admin B2B table and the company's client history each rendered the tag **and** the
  badge, because they passed the "Returned" badge in as `statusTag`'s `extra` argument.
  **Seven** surfaces render this badge now (the two admin history panels came later);
  every one branches before the tag. If you add an eighth, branch — don't pass
  "Returned" as `extra`. `statusTag`'s `extra` is for the Overdue badge only.
- **Only an `active` booking gets the date-derived Overdue badge.** A pending or
  cancelled one has no car out to be late.
- **The picker repaints on failure as well as success.** The server re-checks overlap
  when a booking reclaims a car, so a 409 is a real clash — and a picker left showing
  the status the server just rejected is lying about the record.

The read-only side is enforced **on the server, not by leaving the control out**:
`PATCH /api/special-rentals/<id>/status` is `_require_company_user()` (company-only) on
purpose. Hiding a control the API would still honour isn't a permission, it's a
suggestion. Note the asymmetry: `PATCH /api/rentals/<id>/status` still uses
`_can_edit_company`, which **does** admit admin — that predates this split and no UI
offers it, but the API would honour it.

Two things worth knowing:

- **The dark pill rules were `body.role-company`-scoped.** Admin is dark by default
  too, so the admin's tags fell back to the *light* palette — dark amber ink
  (`#92400e`) on a dark card. Both `.status-pick` and `.status-tag` are now
  `body:is(.role-company, .role-admin):not(.theme-light)`, matching the token-override
  convention. Same class of bug as an ungated dark rule, pointing the other way.
- **`/api/admin/active-rentals` has to select `status`** — without it every row renders
  as the `active` fallback, and the tag shows a state the booking isn't in.

## Readability: merged cells + icon-only row buttons

- **Row buttons are icon-only** — the bare three-dot `ROW_MORE_ICO`, named by `title`
  + `aria-label`. There was a `.row-btn.has-label` convention that put a word ("Details")
  beside the dots; it's **gone**. The word sat in a column whose `<th>` already said
  "Details", so it repeated that header down every row of the table for no gain. The
  `<th>` stays — that's what names the column — so `report.details` is still a live key.
  Don't re-add a per-row label without a reason the column header can't carry.
- **`.sr-stack` / `.sr-main` / `.sr-sub`** — fields that describe *one thing* share a
  cell: a lead line plus muted supporting lines. **All four "Cars rented by …" tables
  use it** — both roles have a copy of each:

  | table | role | was | now |
  |---|---|---|---|
  | `#tbl-admin-special` | admin | 11 | **7** (keeps "Rented from" — it spans every company) |
  | `#tbl-admin-individual` | admin | 9 | **6** |
  | `#tbl-special` | company | 11 | **6** (no "Rented from" — they're its own records) |
  | `#tbl-rented-individual` | company | 10 | **6** |

  The merges are the same everywhere: company/client + owner + phones → one cell,
  model + plate + colour → "Vehicle", From/To → one period. **Nothing is dropped** —
  the full record is in `SpecialDetail` / `Detail`, and the toolbar dropdowns still
  filter on the folded-away fields. That's why the old per-field keys
  (`special.th.owner`, `special.th.plate`, `special.th.from` …) are **still live**:
  they label the detail modal now, not a column. Only `special.th.rentedBy` and
  `special.th.vehicle` are new.
  **The shape classes are unscoped** (`.sr-stack`, `.sr-plate`, `.rp-arrow`, `.sr-dot`)
  — they were `#tbl-admin-special`-scoped while one table used them, which meant the
  second table needed every rule written twice. Tables three and four were markup-only,
  which is the whole point.
- **Column widths stay ID-scoped, and that's not an oversight.** The width rules name
  all four tables explicitly. They can't move to a class the way the shape did: the
  card-mode rule is `body:is(…) .table-wrap:not(.bento-table) tbody tr` at **(0,3,3)**,
  and `.some-class tbody td[data-col="period"]` is only **(0,2,2)** — an id keeps them
  winning. Same split as `.master-detail`: share the shape, not the widths.
- **The two roles' copies differ only in what the role may DO.** The company's status
  cell is a `statusPicker()`, the admin's a read-only `statusTag()` — see "Booking
  status". Merging cells must not quietly swap a control for a label; the suite asserts
  neither company table renders a tag and neither admin table renders a picker.

**Every cell needs a `data-label`.** Between 721 and 1024px each row becomes a card
and the `<thead>` is hidden, so `data-label` is a cell's only label —
`td:not([data-label])` right-aligns bare (correct only for action cells). All four of
these tables were missing them entirely; merged cells make it matter more, not less.

## The company's clients hub — "Add Client & See History"

`#company-clients` is a hub too: `data-coclientview` / `data-coclientview-panel`, driven
by `CoClientsHub`. Two views — the **register** (the add form + "Clients you added") and
**Clients history**, which is the old `#report` section moved in whole.

This is the third instance of the pattern, so the rules are the Cars hub's rules. What's
specific here:

- **`#report` is gone as a section.** The history view holds its markup verbatim: every
  id inside it is unchanged, so `renderReportCompany()`, both pagers and the PDF export
  still find their elements. Only the host moved. Don't rename those ids to match the new
  home — `#pager-report` / `#btn-export-pdf` have `-admin` twins in the Cars hub and the
  bare names are what keeps them apart (see "The report moved out of `#report`").
- **`"report"` is in `CO_CLIENT_VIEWS`, not `COMPANY_PANELS`** — exactly the split
  `AdminSidebar` makes with `CAR_VIEWS`. Leaving it in `COMPANY_PANELS` would toggle
  `.company-panel-active` on an element that no longer exists. `showCompanyPanel("report")`
  maps onto the panel plus the view, so old links still land.
- **The view is passed *into* `refresh(view)`**, not switched after it. `AdminSidebar`
  calls `refresh()` then `show(carView)`, which paints the previous view first; here that
  would fire `refreshReport()` for a tab you're leaving. Same reason `refresh()` doesn't
  fetch the history feed: `show("history")` does, on open.
- **The history badge is pushed in, not pulled** — `renderReportCompany()` calls
  `CoClientsHub.syncHistoryCount(groups.length)` with the **filtered** client count, and
  the hub holds it so a `syncCounts()` from the register tab can't blank it. Identical
  reasoning to `AdminCarsHub.syncReportCount`.
- **Scoping is `getReportRows()`'s job, not the markup's.** It filters the feed to
  `u.company_id` for every company user, so a company only ever sees its own clients.
  Moving the table into this panel didn't widen that by a row, and putting a control here
  wouldn't narrow it either — the API is the boundary.

The home card and the sidebar entry for Clients History are **gone**; the Add Client card
is the only door. Two cards for one set of people was the duplication — same reasoning
that folded `admin-special` / `admin-individual` / `car-gps` into the Cars hub.

## The Clients hub (admin) + `.master-detail`

`#clients` is a hub, same pattern as Cars: `data-clientview` / `data-clientview-panel`,
driven by `ClientsHub`. Three views — the client register (the form + `#tbl-clients`),
**Client history**, and **Company history**.

Both history views are **grouped**, and that's the whole point — the Cars hub already
answers the ungrouped question, so a flat table here would have rebuilt the duplication
that got the Report tab deleted:

| | unit | lives in |
|---|---|---|
| Cars ▸ Report | one row per **rental** | the Cars hub |
| Cars ▸ Rented by companies | one row per **B2B record** | the Cars hub |
| Clients ▸ Client history | one row per **client**, across every company | `#tbl-client-history` |
| Clients ▸ Company history | one row per **renting company** | `#tbl-company-history` |

- **`renderMasterHistory(cfg)`** is the shared renderer; `AdminClientHistory` and
  `AdminCompanyHistory` pass it a config (`masterCells`, `item`, `openItem`, ids, pager
  key). It is deliberately **not** merged with `renderReportCompany()` — that one is the
  company's, scoped to its own clients and its own pager keys. Sharing the *shape* is
  free; sharing the function would put two roles' scoping in one body.
- **`expandedMasters`** keeps panels open across a re-render, like `expandedReportClients`.
  Pager keys are `client-history` / `company-history` plus `<key>-history:<master>` per
  panel, so the two tables — and each open panel — page independently.
- **Client history loads the report feed only if nobody has** (`state.report`), so opening
  the tab after the Cars report doesn't re-download 54 rows.
- **`company_name` on a B2B record is the RENTER** (free text — not a registered company);
  `company_id` is the registered company that **owns** the car and rented it out. Company
  history groups by the former and names the latter as "rented from". Swapping them
  inverts the entire table, so the test asserts the owner never appears as a master row.
  The renter has no id, so the lower-cased name *is* the group key.

### `.master-detail` — the shape, not a table

The master-row-plus-history-panel CSS was `#tbl-report-co`-scoped. Three tables use it
now, so it's scoped to the class instead — same reasoning as `.sr-stack`. The company's
`#tbl-report-co` **must keep `class="data-table master-detail"`** or it loses every one
of those rules. Column widths stay per-table; only the shape is shared.

Two things here are load-bearing and non-obvious:

- **The collapsed-row guard needs the `.table-wrap` prefix.** The card modes set `display`
  on every `tbody tr` via
  `body:is(.role-admin,.role-company) .table-wrap:not(.bento-table) tbody tr` = **(0,3,3)**.
  A plain `.master-detail tbody tr.client-history-row[hidden]` is only **(0,3,2)** and
  *loses* — every panel would render permanently open. `.table-wrap .master-detail …`
  buys the fourth class → **(0,4,2)**, which wins on class count. The id-scoped version
  won the same fight with an id, which is exactly what forced the per-table copy.
- **The card-mode overrides were `body.role-company`-scoped.** The admin is not
  `.role-company`, so its two history tables would have skipped them and broken at
  721–1024px — the same role-scoping trap the status pills hit. The shape is
  role-agnostic; the rules are now too.

## Locations: one control, a full-page map

A location is **one thing you can press**, not a field plus a link to a map of itself.

- **`EntityDetail.locView(name, x, y)`** renders the company's / branch's location as a
  single button (pin + place name) that opens the in-app map. It replaced a pair of
  rows — "Location" (the name + a small pin) and "Map location" (a link *out* to Google
  Maps) — that named one place twice and offered two different maps for it. The
  `companies.f.maploc` key is still live: the registration form labels a field with it
  and the PDF export still builds a Google link (`mapsUrl` survives for exactly that;
  `mapsLink` is gone from `EntityDetail`, though `SpecialDetail` keeps its own).
- **The per-branch pins in the branch list stay.** Those point at *different* places, so
  they aren't duplicates. `bindLocPins()` binds `.rd-loc-pin, .rd-loc-view` together.
- **`MapPicker` has two modes and the modal is sized per mode.** `#map-modal.is-view`
  drops the 820px cap and fills the viewport (`100dvh`, with a `100vh` fallback that
  matters on mobile); pick mode keeps the dialog. `show()` toggles that class **before**
  its `nextPaint()` wait — Leaflet measures against the laid-out container, so resizing
  the card afterwards leaves the map sized to the wrong box. Same ordering rule as
  `CarGps.onShow()`.
- **View mode retitles rather than lying.** The header shows the place name (not "Pick a
  location in Lebanon"), the pin hint is hidden in CSS, and Cancel becomes `map.close` —
  there's no pick to abandon. Because `applyI18n()` rewrites `textContent` for every
  `[data-i18n]` on a language switch, a literal place name must **drop** the attribute
  (`setLiteral`) and a translated label must **own a key** (`setI18nKey`). Setting
  `textContent` alone would silently revert on the next language switch.

## The home cards are surfaces, and their colour is an accent

Both roles land on `.ent-home`, so it's the first thing anyone sees. The cards used to be
full-bleed saturated gradient tiles — emerald, amber, violet, blue, rose, teal — six
competing hues on one screen, each under a white gloss, each shouting equally. Nothing
was subordinate to anything else, so nothing looked deliberate. **That, not the layout,
is what read as cheap.**

A card is a `--surface` now, with `--line` and `--ink`. Its identity is one accent, held
in **`--card-accent`** on the `.ent-card-*` class and consumed generically: it tints the
icon chip, draws the hairline that appears on hover, and colours the arrow. Adding a card
means setting two custom properties, not writing a gradient.

- **It's theme-correct by construction.** The old tiles hard-coded `#fff` ink and got
  away with it because a saturated gradient is dark under either theme. Every rule is
  token-driven now, so the light toggle just works — the home page was the one place that
  had been opted out of it.
- **The accents are gated, pointing the *other* way from the usual trap.** The base
  `--card-accent` is a mid-tone chosen to read on the light theme's white card;
  `body:is(.role-company, .role-admin):not(.theme-light)` lifts each to its lighter twin
  for the dark card. Ungated, the mid-tones would go muddy on `#141c2f` — dark ink on a
  dark surface, the same class of bug as an ungated pale ink on white.
  **All eleven cards have a dark twin**; the suite asserts the two sets name the same
  cards, because a card that silently falls back to its mid-tone is exactly what you
  can't see in a diff.
- **The hairline uses `inset-inline-start`**, so RTL flips it for free — no
  `html[dir="rtl"]` rule needed. The three that remain (`text-align`, the arrow flip) are
  the ones logical properties can't cover.
- **`.ent-home-hero::after` carries `z-index: 1`** on purpose. It's the top-light wash;
  a positioned `::after` with `z-index: auto` paints *after* its siblings, i.e. over the
  text. `.ent-home-hero-content` is `z-index: 2`, and the ordering only works if the wash
  claims a layer below it.
- **`#fff` survives in exactly one place** — `.ent-card:hover .ent-card-icon`, on a
  saturated `--card-accent` fill. That's the house pattern, and it's theme-safe.

## The edit counter outlived its cap

Company edits to a car / client / B2B record were once capped at **2×**, so three company
tables carried an **Edits** column and the API could refuse a third change. The cap is
gone — edits are unlimited, and accountability is the **audit log**, which the admin sees
live. The counter columns survived it by a while, answering a question nobody was asking
any more.

**No company-role surface counts edits now.** `#tbl-my-cars`, `#tbl-my-clients` and
`#tbl-special` show **Edit and nothing else**. Worth knowing:

- **`edit_count` is still written**, and that's deliberate — the admin uses it to see how
  often a record is touched (`app.py` says so at the `cars` update). Don't drop the column
  from the schema on the strength of the UI change; only the *company's* view of it went.
  The frontend no longer reads it at all, which is what the test asserts.
- **The admin's audit dashboard keeps its Edits KPI** (`#audit-kpi-edits`, inside
  `#stats-dashboard`, which is `admin-only-show`). That KPI *is* the live auditing this
  change leans on — it's the reason the company doesn't need a per-row number, so don't
  "finish the job" by removing it too.
- **Removing a counter is only safe because there's no cap behind it.** If the ceiling
  still existed, hiding the number would strand a company at a wall with no warning —
  strictly worse than showing it. The test asserts no `edit_count >= N` exists in either
  `app.py` or `app.js`, because that's the premise the whole change rests on.
- **Three keys went with the columns**: `addClient.editsLeft`, `addClient.noEditsLeft` and
  `special.th.edits`, deleted from both language tables. `t()` falls back to the literal
  key string, so a dangling `data-i18n` renders raw rather than failing — deleting a key
  means deleting the markup that used it in the same breath.
- Four comments still said "typo correction, **max 2×**" (or "the backend caps company
  edits at two per client") long after the cap died. They say "unlimited" now. A comment
  that documents a removed constraint is how those counters survived this long.
- **`#tbl-special` writes its empty state twice** — `special.empty` and `special.noMatch`.
  Both colspans have to follow the column count; changing one and not the other leaves the
  no-match row a cell short of the header.

## The head office is a tag

`.branch-head-badge` shipped with a class and **no CSS whatsoever** — so "★ Head office"
rendered as bare text run straight into the location link beside it. That, not the
layout, is what made the admin's Companies table look messy. It's a pill now, matching
the `.rd-badge` the branch detail modal already used for the same fact.

- **The pill goes under the location, not beside it** (`.company-loc-stack`).
  `.company-loc-link` is a `nowrap` flex button; appending a badge after it was the
  crowding.
- **Both pale-ink halves are gated `:not(.theme-light)`.** `.rd-badge`'s dark rule
  wasn't — `#a7f3d0` was leaking onto the light theme's white card, exactly the trap the
  theme section warns about. Fixed here; `.branch-head-badge` was written gated.
- `.branch-tag-head` also had no rules and now tints the head-office branch's tag.

## Recent work — company "Clients History"

The company role's Report tab was rebuilt as a **master-detail client history** and
renamed. It is **no longer a tab**: it's the second view of `#company-clients` (see "The
company's clients hub"), so neither role's report has a panel of its own any more. The
notes below describe the table, which the move left untouched.

- **`renderReportCompany()`** (`app.js`) — was a flat, one-row-per-rental table
  (9 columns). Now `groupReportByClient()` folds the filtered rows into one row per
  client (Client · Phone · Rentals · Cars · Latest · History, 6 columns); expanding a
  row lists that client's rentals newest-first, each with a button to the shared
  `Detail` modal. Paging counts **clients**; each panel pages its own history.
- **Open panels and per-client pages survive a re-render** via `expandedReportClients`
  (a Set of client keys) plus the per-client pager keys — mirrors how
  `expandedCompanies` keeps branch rows open in the admin Companies table.
- **The 30-day default was removed** from `getReportRows()` for the company branch. It
  used to clamp to the last month whenever no filter was set; a panel labelled
  "history" that silently stopped a month back would be wrong. Size is held by paging
  clients instead. From/To still give a window.
- **Filters** (client / car dropdowns + From/To) narrow both levels at once — the
  options are built from the same company-scoped rows the table renders, so a pick
  can't return an empty table.
- **Its door moved twice.** It was renamed "Clients History" on a home card, a sidebar
  entry and a header-nav link; all three are **gone** now that it's a tab inside Add
  Client, and `ent.card.report.title` / `nav.clientsHistory` are dead with them (kept in
  `i18n.js` on purpose — see the comment there). The live keys are
  `coClientsHub.tab.history` for the tab and `report.clientsTitle` for the heading, which
  is a plain `<h3>`: the `admin-only-show` / `company-only-show` split went when the admin
  half left the section, and the section itself went after it.
- **`.status-tag`** — a read-only twin of `.status-pick` (same three tints, no caret,
  no `<select>`) for the history panel: the report *reads* a booking's state; moving
  one is the Cars & Rentals tables' job.

Earlier in the same stretch of work: the booking-status column in the two "rented by"
tables became a picker (`statusPicker()`), its light-theme contrast was fixed, and the
individuals table's free-text search box became two prefix-searchable dropdowns
(`#filter-ind-client`, `#filter-ind-car`).

**Both roles' individuals tables have now had that same box→dropdown change** — the
company's uses `#filter-ind-*`, the admin's `#filter-ai-*` (kept apart so neither
clears the other), and both pair the two pickers with a From/To window. Worth knowing
what it trades away: the old box also matched **phone and colour**, and the dropdowns
don't. What you gain is that a pick can't return an empty table — the options are built
from the very rows being rendered — and there's nothing to mistype.
