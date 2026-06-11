# How to upload your data with the API

A hands-on walkthrough for a company: from clicking **Generate key** in the
dashboard to pushing your cars, clients, and branches — either **one type at a
time** or **all at once**.

> Need the full field reference (every allowed value, every validation rule)?
> See **API_GUIDE.md**. This file is the quick "do it now" version.

---

## Step 1 — Generate your key

1. Sign in to the dashboard with your company account.
2. Go to the **Add Car** tab → **API access** card.
3. Click **Generate / Regenerate key**.
4. A key appears once, like:

   ```
   crk_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```

5. **Copy it now** and keep it safe (it is shown only once). If you ever lose
   it or it leaks, click the button again — that makes a brand-new key and
   instantly disables the old one.

You send this key on **every** request as a header:

```
Authorization: Bearer crk_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Everything you upload is automatically saved under **your** company — you never
send a company id.

---

## Step 2 — Choose how to upload

| You want to… | Use this endpoint |
|---|---|
| Upload **only cars** | `POST /api/cars/batch` |
| Upload **only clients** | `POST /api/clients/batch` |
| Upload **only branches** | `POST /api/branches/batch` |
| Upload **everything in one request** | `POST /api/batch` |

Two important rules for all of them:

- **All-or-nothing:** if even one record is invalid, **nothing** is saved and
  you get back exactly which records to fix.
- You can send the data as a **JSON body** or upload a **`.json` file** (a form
  field named `file`). Both are shown below.

Replace `https://YOUR_DOMAIN` with your server address (test value:
`http://localhost:5000`).

---

## Option A — Upload each type separately

Do this when you manage cars, clients, and branches in separate exports, or want
to load them in stages.

### A1) Cars — `cars.json`

```json
[
  {"vin":"1HGCM82633A004352","type":"Sedan","model":"Honda Accord","color":"White","platenumber":"M 12345","has_gps":true},
  {"vin":"JTDBT4K32A1700001","type":"Sedan","model":"Toyota Yaris","color":"Red","plate_icon":"B","plate_number":"67890"}
]
```

Upload the file:

```bash
curl -X POST https://YOUR_DOMAIN/api/cars/batch \
  -H "Authorization: Bearer crk_XXXX..." \
  -F "file=@cars.json"
```

Or send it inline (no file):

```bash
curl -X POST https://YOUR_DOMAIN/api/cars/batch \
  -H "Authorization: Bearer crk_XXXX..." \
  -H "Content-Type: application/json" \
  -d '[{"vin":"1HGCM82633A004352","type":"Sedan","model":"Honda Accord","color":"White","platenumber":"M 12345"}]'
```

Success → `201`:

```json
{ "inserted": 2, "cars": [ … ], "failed": [] }
```

### A2) Clients — `clients.json`

```json
[
  {"licenseid":"L-9001","name":"Sami","id_type":"license"},
  {"licenseid":"L-9002","personid":"P-2002","id_type":"national_id","name":"Rana","nationality":"Lebanese"}
]
```

```bash
curl -X POST https://YOUR_DOMAIN/api/clients/batch \
  -H "Authorization: Bearer crk_XXXX..." \
  -F "file=@clients.json"
```

Success → `201`:

```json
{ "inserted": 2, "linked": 0, "results": [ … ], "failed": [] }
```

> `linked` counts clients that already existed in the system — your company is
> attached to them instead of creating a duplicate.

### A3) Branches — `branches.json`

```json
[
  {"branchname":"Hamra","location":"Beirut","phonenumber":"+9611000000"},
  {"branchname":"Jounieh","location":"Keserwan"}
]
```

```bash
curl -X POST https://YOUR_DOMAIN/api/branches/batch \
  -H "Authorization: Bearer crk_XXXX..." \
  -F "file=@branches.json"
```

Success → `201`:

```json
{ "inserted": 2, "branches": [ … ], "failed": [] }
```

---

## Option B — Upload everything in one request

Do this when you have one combined export. Put all three sections in a single
object (include only the ones you have) and post it to `/api/batch`. It's still
all-or-nothing across **everything** — one bad row anywhere saves nothing.

### `import.json`

```json
{
  "cars": [
    {"vin":"1HGCM82633A004352","type":"Sedan","model":"Honda Accord","color":"White","platenumber":"M 12345","has_gps":true}
  ],
  "clients": [
    {"licenseid":"L-9001","name":"Sami","id_type":"license"}
  ],
  "branches": [
    {"branchname":"Hamra","location":"Beirut","phonenumber":"+9611000000"}
  ]
}
```

Upload the file:

```bash
curl -X POST https://YOUR_DOMAIN/api/batch \
  -H "Authorization: Bearer crk_XXXX..." \
  -F "file=@import.json"
```

Or inline:

```bash
curl -X POST https://YOUR_DOMAIN/api/batch \
  -H "Authorization: Bearer crk_XXXX..." \
  -H "Content-Type: application/json" \
  -d @import.json
```

Success → `201`:

```json
{
  "cars":     { "inserted": 1, "rows": [ … ] },
  "clients":  { "inserted": 1, "linked": 0, "results": [ … ] },
  "branches": { "inserted": 1, "rows": [ … ] },
  "failed":   { "cars": [], "clients": [], "branches": [] }
}
```

---

## Using Postman instead of curl

1. **Method/URL:** `POST` → `https://YOUR_DOMAIN/api/batch` (or a `…/batch` endpoint).
2. **Headers tab:** add `Authorization` = `Bearer crk_XXXX...`.
3. **Body tab:**
   - To upload a file: choose **form-data**, add a key named `file`, set its
     type to **File**, and select your `.json`.
   - To paste JSON: choose **raw → JSON** and paste the content.
4. **Send.**

---

## When something is wrong (HTTP 400)

Nothing is saved, and the response lists the bad rows by their position
(`index`, starting at 0):

**Per-type endpoint:**

```json
{
  "error": "Batch rejected — fix the listed rows and resubmit.",
  "inserted": 0,
  "failed": [
    { "index": 1, "errors": { "vin": "VIN '…' has an invalid check digit (typo?)" } }
  ]
}
```

**`/api/batch`:**

```json
{
  "error": "Batch rejected — fix the listed rows and resubmit. Nothing was saved.",
  "failed": {
    "cars": [ { "index": 0, "errors": { "color": "Color 'Turquoise' is not allowed. …" } } ],
    "clients": [],
    "branches": []
  }
}
```

Fix the listed records and send the whole request again.

### Other status codes

| Code | Meaning |
|---|---|
| `401` | Missing or wrong key — check the `Authorization` header. |
| `403` | This key isn't allowed here (e.g. an admin key). |
| `409` | A duplicate slipped in (e.g. a VIN/plate already taken). Nothing saved. |
| `400` | Malformed JSON, empty payload, or more than 500 rows. |

---

## Quick checklist

- [ ] Generated a key and copied it (shown once).
- [ ] Sending `Authorization: Bearer crk_...` on every request.
- [ ] No `company_id` in the data (it's automatic).
- [ ] VINs are real 17-character VINs (no letters I, O, Q).
- [ ] Colours and plate letters are from the allowed lists (see API_GUIDE.md).
- [ ] Max 500 records per request.
- [ ] Got `201`? Done. Got `400`? Fix the listed rows and resend.
