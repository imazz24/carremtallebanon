# Car Rental — Batch Import API

A step-by-step guide for external companies to push **cars, clients, and branches**
into the Car Rental system programmatically (from your own software, a script,
curl, or Postman).

---

## At a glance

- **One key** authenticates you, and everything you send is filed under **your**
  company automatically — you never send a company id.
- **All-or-nothing:** if any row in a request is invalid, **nothing** is saved
  and you get back exactly which rows to fix.
- Send a **JSON body** or upload a **`.json` file** — your choice.
- Up to **500 records per request**.

---

## Step 1 — Get your API key

1. Sign in to the dashboard with your company account.
2. In the sidebar, click **Generate Secret Key** (the 🔑 **API access** tab).
3. Click **Generate Secret Key**.
4. Copy the key shown (it looks like `crk_AbC123...`). **It is shown only once** —
   store it somewhere safe (a secrets manager / `.env`). If you lose it, generate
   a new one (which disables the old one).

> You must have added at least one car, client, or branch first — a brand-new,
> empty company cannot generate a key (there would be nothing to integrate with).

> Keep the key secret. Anyone with it can add data as your company. If it leaks,
> regenerate it to revoke the old one.

---

## Step 2 — Know your base URL

```
https://YOUR_DOMAIN
```

Replace `YOUR_DOMAIN` with the address you were given (for local testing it is
`http://localhost:5000`).

---

## Step 3 — Send the key on every request

Add this header to every call:

```
Authorization: Bearer crk_your_key_here
```

(`X-API-Key: crk_your_key_here` is also accepted.)

---

## Step 4 — Pick the endpoint

| You want to add… | Method & Route | Body |
|---|---|---|
| Cars only | `POST /api/cars/batch` | `[ {car}, … ]` or `{"cars":[…]}` |
| Clients only | `POST /api/clients/batch` | `[ {client}, … ]` or `{"clients":[…]}` |
| Branches only | `POST /api/branches/batch` | `[ {branch}, … ]` or `{"branches":[…]}` |
| **Everything at once** | `POST /api/batch` | `{"cars":[…], "clients":[…], "branches":[…]}` |

Use `/api/batch` when you want to upload a mix in a single all-or-nothing
transaction. Each array is optional — include only what you have.

### Pulling reports back out (read-only)

| You want to read… | Method & Route | Notes |
|---|---|---|
| Reservation report | `GET /api/reports/reservations` | Every reservation for your company, with client, car, dates and status. |
| Rental report | `GET /api/reports/rentals` | Every rental for your company. Add `?client_id=<id>` to filter to one client. |

Both are scoped to **your** company automatically and use the same
`Authorization: Bearer <key>` header. They return **403** until your company
has data (cars / clients / branches) in the system.

---

## Step 5 — Build your records

### Car fields

| Field | Required | Rules |
|---|---|---|
| `vin` | ✅ | Exactly **17 characters**, letters `A–Z` and digits `0–9` only, and **never the letters I, O, or Q**. Must be a real, valid VIN (the check digit is verified) and not already registered. |
| `type` | ✅ | Body type, e.g. `Sedan`, `SUV`, `Pickup`, `Coupe`. |
| `model` | ✅ | e.g. `Toyota Camry`. |
| `color` | ✅ | One of: White, Black, Silver, Gray, Red, Blue, Green, Yellow, Brown, Beige, Gold, Orange, Maroon, Purple, Pink, Bronze, Champagne, Pearl White, Pearl Black. |
| `platenumber` | ✅ | Format `"<icon> <digits>"`, e.g. `"M 12345"`. Icon is one of `M B T G N Y Z O`; digits are 1–7 numbers. *(Alternatively send `plate_icon` and `plate_number` as separate fields.)* |
| `has_gps` | optional | `true` or `false` (default `false`). |

### Client fields

| Field | Required | Rules |
|---|---|---|
| `licenseid` | ✅ always | The driving-licence number. |
| `id_type` | recommended | One of `passport`, `national_id`, `license`. |
| `personid` | ✅ when `id_type` is `passport` or `national_id` | The national ID / passport number. |
| `name`, `fathername`, `mothername`, `nationality`, `phonenumber` | optional | Free text. |
| `dateofbirth`, `startdatelicense`, `enddatelicense` | optional | Dates in `YYYY-MM-DD` format. |

> If a client you send already exists in the system (same person + licence), your
> company is simply **linked** to that existing record — no duplicate is created.

### Branch fields

| Field | Required | Rules |
|---|---|---|
| `branchname` | ✅ | Branch name. |
| `location` | ✅ | Address / area. |
| `phonenumber` | optional | |
| `x`, `y` | optional | Map coordinates (longitude / latitude). |

---

## Step 6 — Send it

### Option A — JSON body

```bash
curl -X POST https://YOUR_DOMAIN/api/batch \
  -H "Authorization: Bearer crk_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "cars": [
      {"vin":"1HGCM82633A004352","type":"Sedan","model":"Honda Accord","color":"White","platenumber":"M 12345","has_gps":true}
    ],
    "clients": [
      {"licenseid":"L-9001","name":"Sami","id_type":"license"}
    ],
    "branches": [
      {"branchname":"Hamra","location":"Beirut","phonenumber":"+9611000000"}
    ]
  }'
```

### Option B — Upload a `.json` file

Put the same JSON in a file (e.g. `import.json`) and upload it. **Do not** set a
`Content-Type` header for file upload:

```bash
curl -X POST https://YOUR_DOMAIN/api/batch \
  -H "Authorization: Bearer crk_your_key_here" \
  -F "file=@import.json"
```

### In Postman

1. Method `POST`, URL `https://YOUR_DOMAIN/api/batch`.
2. **Headers** → add `Authorization` = `Bearer crk_your_key_here`.
3. **Body** → either *raw / JSON* (paste the JSON), or *form-data* with a key
   named `file` of type **File** pointing at your `.json`.

---

## Step 7 — Read the response

### Success — HTTP 201

```json
{
  "cars":     { "inserted": 1, "rows": [ … ] },
  "clients":  { "inserted": 1, "linked": 0, "results": [ … ] },
  "branches": { "inserted": 1, "rows": [ … ] },
  "failed":   { "cars": [], "clients": [], "branches": [] }
}
```

- `inserted` — newly created records.
- `clients.linked` — existing clients your company was attached to.

> The single-entity endpoints (`/api/cars/batch`, etc.) return a simpler shape:
> `{ "inserted": N, "failed": [ … ] }`.

### Rejected — HTTP 400 (nothing was saved)

```json
{
  "error": "Batch rejected — fix the listed rows and resubmit. Nothing was saved.",
  "failed": {
    "cars": [
      { "index": 2, "errors": { "vin": "VIN '…' has an invalid check digit (typo?)" } }
    ],
    "clients": [],
    "branches": []
  }
}
```

`index` is the position (starting at 0) of the bad row in the array you sent.
Fix those rows and send the whole request again.

### Other status codes

| Code | Meaning |
|---|---|
| `401` | Missing or invalid API key. |
| `403` | This key isn't allowed here (e.g. an admin key). |
| `409` | A database conflict (e.g. a VIN/plate became a duplicate). Nothing saved. |
| `413`/`400` | Malformed JSON, empty payload, or over the 500-row limit. |

---

## Why a row might be rejected (validation rules)

A **car** row fails if its VIN is:

1. empty, or not exactly 17 characters;
2. using illegal characters (anything other than `A–Z`/`0–9`, or any `I`, `O`, `Q`);
3. not a valid VIN / has a wrong **check digit** (a typo or fabricated VIN);
4. the same as the plate number;
5. already registered (by you or another company);
6. duplicated within the same request.

It can also be rejected if the **plate** format is wrong, the **colour** isn't in
the allowed list, or the VIN decodes (via NHTSA) to a different model/body than
you typed.

> **About the VIN check digit:** the 9th character is a checksum of the other 16.
> A real VIN read off an actual car is always self-consistent and passes — even
> though the last 6 characters (the serial number) differ from car to car. A row
> only fails the check digit when the VIN is internally inconsistent (a typo or
> an edited template). North-American VINs are checked; many imported VINs that
> don't carry a check digit are accepted as-is.

A **client** row fails if `licenseid` is missing, or if `personid` is missing for
a `passport`/`national_id` client, or if the personid/licence conflicts with a
different existing client.

A **branch** row fails if `branchname` or `location` is missing.

---

## Ready-to-edit template (`import.json`)

```json
{
  "cars": [
    {
      "vin": "REPLACE_WITH_REAL_17_CHAR_VIN",
      "type": "Sedan",
      "model": "Toyota Corolla",
      "color": "White",
      "platenumber": "M 12345",
      "has_gps": false
    }
  ],
  "clients": [
    {
      "licenseid": "L-0001",
      "id_type": "license",
      "name": "Full Name",
      "phonenumber": "+961...",
      "dateofbirth": "1990-01-31"
    }
  ],
  "branches": [
    {
      "branchname": "Main Branch",
      "location": "Beirut",
      "phonenumber": "+961..."
    }
  ]
}
```

Remove any section you don't need, fill in real values, and POST it as shown in
Step 6.

---

## For the system owner (admin) — generating a key for a company

*This section is for you, the operator — not the external company. You can
delete it before sharing this guide.*

There are two ways a company gets its key:

**A. The company generates it themselves** (preferred — see Step 1): they sign
in, open the **Add Car → API access** card, and click *Generate / Regenerate*.

**B. You generate it for them as admin.** Sign in as an admin and call the key
endpoint with the target `company_id`. Admin requests authenticate with the
`X-Auth-User` header (the same one the dashboard uses), not a Bearer key:

```bash
# Create / rotate the key for company #3 — the raw key is returned ONCE
curl -X POST https://YOUR_DOMAIN/api/api-key \
  -H "X-Auth-User: admin" \
  -H "Content-Type: application/json" \
  -d '{"company_id": 3}'
```

Response:

```json
{
  "api_key": "crk_AbC123...",
  "prefix":  "crk_AbC123",
  "note":    "Store this now — it is shown only once. Send it as 'Authorization: Bearer <key>' on batch requests."
}
```

Hand the `api_key` value to that company over a secure channel. Related calls:

```bash
# Is a key set? (shows prefix + created date only, never the secret)
curl "https://YOUR_DOMAIN/api/api-key?company_id=3" -H "X-Auth-User: admin"

# Revoke the company's key (disables it until a new one is generated)
curl -X DELETE "https://YOUR_DOMAIN/api/api-key" \
  -H "X-Auth-User: admin" -H "Content-Type: application/json" \
  -d '{"company_id": 3}'
```

Notes:
- Generating a new key **replaces** any previous one — the old key stops working
  immediately.
- The raw key is never stored (only its hash), so you cannot look it up later;
  if a company loses it, generate a new one.
- **One-time setup:** the key endpoints require database migration
  `022_api_keys.sql`. On the server run it once: `cd backend && python migrate.py`.

---

## For the system owner (admin) — performance, limits & scaling

- **Per-request limit:** 500 records (combined for `/api/batch`). Large imports
  are just multiple requests; a company can fire several in parallel.
- **Validation is bulk:** VIN/plate and client uniqueness are checked with one
  or two queries per *batch* (not per row), and the NHTSA VIN cross-check is
  cached and fanned out across threads — so big files stay fast.
- **Measured throughput** (single dev process; production gunicorn is higher):
  ~1,300 cars/sec and ~1,000 clients/sec with 12–20 companies importing
  simultaneously, with no failures and full per-company isolation.

### Scaling knobs (env — see `backend/gunicorn.conf.py`, wired in `docker-compose.yml`)

| Variable | Default | Purpose |
|---|---|---|
| `GUNICORN_WORKERS` | `2×CPU+1` (4 in compose) | Request-parallel processes. |
| `GUNICORN_THREADS` | `4` | I/O concurrency per worker. |
| `PG_MAX_CONNECTIONS` | `200` | Must match Postgres `max_connections`. The app auto-sizes its per-worker DB pool from this so `workers × pool` can never exhaust Postgres. |
| `NHTSA_CROSS_CHECK` | `1` | `0` skips the external model/body check (VIN structure + check digit still enforced) — faster for trusted bulk imports or when NHTSA is down. |
| `NHTSA_TIMEOUT` | `4` | Seconds to wait on NHTSA per VIN. |

> **Connection safety:** the one risk at scale is `workers × DB_POOL_MAX`
> exceeding Postgres' `max_connections`. The compose setup keeps these in sync
> automatically; if you run gunicorn yourself, leave `DB_POOL_MAX` unset so the
> config derives a safe value from `PG_MAX_CONNECTIONS`.

### Verifying under load

`backend/load_test.py` simulates many companies uploading huge batches at once,
checks DB integrity + isolation + all-or-nothing, then **deletes all test data**:

```bash
# start the server first with the cross-check off, then:
python load_test.py --companies 20 --cars 500 --mode cars
python load_test.py --companies 15 --clients 800 --mode clients
python load_test.py --companies 12 --cars 400 --clients 400 --mode both
python load_test.py --cleanup-only          # sweep leftovers if a run was killed
```
