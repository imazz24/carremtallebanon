# Car Rental — Full Stack Project

A bilingual (English / Arabic) car-rental management app.

- **Frontend:** `index.html` + vanilla JS (RTL-aware, EN/AR switcher)
- **Backend:** Python (Flask) REST API
- **Database:** PostgreSQL — DB name `carrental`

## Tables

1. **companies** — `id, companyname, location, companyid`
2. **cars** — `id, vin, type, model, color, platenumber, has_gps, company_id` (cars belong to companies)
3. **clients** — `id, personid, name, fathername, mothername, phonenumber, dateofbirth, licenseid, startdatelicense, enddatelicense`
4. **rentals** — `id, client_id, car_vin, start_date, end_date, total_price` (links clients ↔ cars ↔ companies)

## Setup

### 1) PostgreSQL

```bash
# in psql, as a superuser:
CREATE DATABASE carrental;
\c carrental
\i backend/schema.sql
```

The schema also creates a view `v_client_rentals` that returns every client with the cars they rented and the company that owns each car. That view backs the **Report** page.

### 2) Backend

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env       # then edit DB_PASSWORD
python app.py              # serves http://localhost:5000
```

Flask serves both the API (`/api/*`) **and** the frontend (`/`), so you can just open <http://localhost:5000>.

### 3) Frontend (alternative — open the HTML directly)

Open `frontend/index.html` in a browser. The JS auto-detects and falls back to `http://localhost:5000` for the API.

## Endpoints

| Method | Route                         | Description                                |
|--------|-------------------------------|--------------------------------------------|
| GET    | `/api/companies`              | List companies                             |
| POST   | `/api/companies`              | Add company                                |
| GET    | `/api/cars?company_id=`       | List cars (optionally filtered by company) |
| POST   | `/api/cars`                   | Add car                                    |
| GET    | `/api/clients`                | List clients                               |
| POST   | `/api/clients`                | Add client                                 |
| POST   | `/api/rentals`                | Create rental                              |
| GET    | `/api/rentals/report`         | Joined report: client + car + company      |

## Batch import API (for external companies)

Company users can push many records at once from their own systems. These
endpoints are **company-only** (admin is rejected), **all-or-nothing** (if any
row fails validation, nothing is written), and accept either a JSON body or an
uploaded `.json` file (multipart `file` field).

| Method | Route                  | Body                                                   |
|--------|------------------------|--------------------------------------------------------|
| POST   | `/api/cars/batch`      | `[ {car}, … ]` or `{"cars":[…]}`                        |
| POST   | `/api/clients/batch`   | `[ {client}, … ]` or `{"clients":[…]}`                 |
| POST   | `/api/branches/batch`  | `[ {branch}, … ]` or `{"branches":[…]}`                |
| POST   | `/api/batch`           | `{"cars":[…], "clients":[…], "branches":[…]}` (any subset, all in one transaction) |

Everything is filed under the caller's own company (any `company_id` in the
payload is ignored). The cap on combined rows per request is `MAX_BATCH` (500).

### Authentication — API key

Apply migration `022_api_keys.sql` (`python migrate.py`), then each company
generates a secret key from the dashboard **API access** card (or
`POST /api/api-key`). Send it on every batch request:

```bash
curl -X POST http://localhost:5000/api/batch \
  -H "Authorization: Bearer crk_your_key_here" \
  -F "file=@import.json"
```

`X-API-Key: <key>` is also accepted. The key is shown once; only its hash is
stored, and regenerating invalidates the old one.

### Validation (keeps junk out)

Each car runs the full gauntlet: 17-char VIN with an enforced check digit
(rejects typo'd / fabricated VINs), Lebanese plate format, an allowed colour,
no duplicate VIN/plate (in the batch or the DB), and an NHTSA model/body
cross-check. NHTSA results are cached per VIN, so repeat batches and retries
skip the network. A rejected batch returns the offending rows:

```json
{ "error": "Batch rejected …", "inserted": 0,
  "failed": [ { "index": 2, "errors": { "vin": "VIN '…' has an invalid check digit (typo?)" } } ] }
```

Smoke tests for all of the above: `cd backend && python test_batch.py`.

## The reporting query

```sql
SELECT cl.name AS client, co.companyname AS company,
       c.model, c.platenumber, r.start_date, r.end_date
  FROM rentals r
  JOIN clients   cl ON cl.id  = r.client_id
  JOIN cars      c  ON c.vin  = r.car_vin
  JOIN companies co ON co.id  = c.company_id;
```

(Same logic, materialised as the view `v_client_rentals` used by `/api/rentals/report`.)

## Language

Click **EN** or **عربي** in the header to switch. Arabic flips the layout to RTL automatically.
