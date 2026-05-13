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
