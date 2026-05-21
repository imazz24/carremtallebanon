"""Flask REST API for the Car Rental project."""
import os
import io
import csv
import hashlib
import secrets
from datetime import date, datetime
from decimal import Decimal
from flask import Flask, jsonify, request, send_file, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv

import requests
from vininfo import Vin as _VinInfo

from db import query, execute
from pdf_gen import report_pdf, single_pdf

load_dotenv()

FRONTEND_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "frontend")
)
MEDIA_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "uploads", "rental_media")
)
os.makedirs(MEDIA_ROOT, exist_ok=True)

# Allowed MIME prefixes per media kind. Anything outside this list is
# rejected at upload time so the storage doesn't fill with surprise files.
ALLOWED_MEDIA_PREFIX = {
    "photo": ("image/",),
    "video": ("video/",),
}

app = Flask(__name__, static_folder=None)
# Emit raw UTF-8 in JSON responses (Arabic, Chinese, etc. — not \uXXXX escapes)
app.json.ensure_ascii = False
app.json.mimetype = "application/json; charset=utf-8"
CORS(app)


# ----------------------- helpers --------------------------------------
def _serialize(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def _clean(rows):
    if rows is None:
        return None
    if isinstance(rows, dict):
        return {k: _serialize(v) for k, v in rows.items()}
    return [{k: _serialize(v) for k, v in r.items()} for r in rows]


def _required(data, *fields):
    missing = [f for f in fields if data.get(f) in (None, "")]
    return missing


# ----------------------- static frontend ------------------------------
@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:path>")
def static_proxy(path):
    return send_from_directory(FRONTEND_DIR, path)


# ----------------------- AUTH -----------------------------------------
def _sha256(s: str) -> str:
    return hashlib.sha256((s or "").encode("utf-8")).hexdigest()


def _username_for_company(name: str) -> str:
    """Derive a deterministic username from a company name."""
    return (name or "").strip().lower().replace(" ", "_")


def _is_admin_request() -> bool:
    """Lightweight admin check via X-Auth-User header (set by the frontend)."""
    user = (request.headers.get("X-Auth-User") or "").strip().lower()
    if not user:
        return False
    row = query("SELECT role FROM users WHERE LOWER(username) = %s", (user,), one=True)
    return bool(row and row.get("role") == "admin")


def _current_user():
    """Resolve the user named in the X-Auth-User header (or None)."""
    name = (request.headers.get("X-Auth-User") or "").strip().lower()
    if not name:
        return None
    return query(
        "SELECT id, username, role, company_id FROM users WHERE LOWER(username) = %s",
        (name,), one=True,
    )


def _can_edit_company(company_id: int) -> bool:
    """Admin can edit any company; a company user only their own."""
    u = _current_user()
    if not u:
        return False
    if u.get("role") == "admin":
        return True
    return u.get("role") == "company" and u.get("company_id") == int(company_id)


@app.post("/api/login")
def login():
    data = request.get_json(force=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        return jsonify({"error": "Missing credentials"}), 400

    row = query(
        """SELECT u.id, u.username, u.role, u.company_id,
                  c.companyname, c.location, c.companyid, c.phonenumber,
                  c.x AS company_x, c.y AS company_y, c.logo AS company_logo
             FROM users u
        LEFT JOIN companies c ON c.id = u.company_id AND c.is_active = TRUE
            WHERE LOWER(u.username) = LOWER(%s) AND u.password_hash = %s""",
        (username, _sha256(password)),
        one=True,
    )
    if not row:
        return jsonify({"error": "Invalid username or password"}), 401

    company = None
    if row.get("company_id") and row.get("companyname"):
        company = {
            "id":           row["company_id"],
            "companyname":  row["companyname"],
            "location":     row["location"],
            "companyid":    row["companyid"],
            "phonenumber":  row["phonenumber"],
            "x":            row["company_x"],
            "y":            row["company_y"],
            "logo":         row["company_logo"],
        }
    return jsonify(_clean({
        "id":         row["id"],
        "username":   row["username"],
        "role":       row["role"],
        "company_id": row["company_id"],
        "company":    company,
    }))


# Admin-only: create a company AND its login user in one step.
# The admin only supplies companyname + password; the rest of the company
# row is filled with safe placeholders the company can edit later.
@app.post("/api/register-company")
def register_company():
    if not _is_admin_request():
        return jsonify({"error": "Admin only"}), 403

    data = request.get_json(force=True) or {}
    miss = _required(data, "companyname", "password")
    if miss:
        return jsonify({"error": f"Missing: {miss}"}), 400

    username = _username_for_company(data["companyname"])
    if not username:
        return jsonify({"error": "Invalid company name"}), 400

    if query("SELECT 1 FROM users WHERE LOWER(username) = %s", (username,), one=True):
        return jsonify({"error": f"Username '{username}' is already taken"}), 409

    # Auto-generate a unique companyid since the admin no longer supplies one.
    # Keep retrying on the (vanishingly small) chance of a collision.
    for _ in range(8):
        candidate = (data.get("companyid") or
                     f"AUTO-{username[:18].upper()}-{secrets.token_hex(2).upper()}")
        if not query("SELECT 1 FROM companies WHERE companyid = %s",
                     (candidate,), one=True):
            companyid = candidate
            break
    else:
        return jsonify({"error": "Could not allocate a company ID"}), 500

    location = (data.get("location") or "").strip()  # NOT NULL: empty string is OK

    # Both inserts share the same connection so they commit/rollback together.
    from db import get_conn
    from psycopg2.extras import RealDictCursor
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """INSERT INTO companies
                     (companyname, location, companyid, x, y, phonenumber, logo)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)
                   RETURNING *""",
                (
                    data["companyname"], location, companyid,
                    _none_if_blank(data.get("x")), _none_if_blank(data.get("y")),
                    _none_if_blank(data.get("phonenumber")),
                    _none_if_blank(data.get("logo")),
                ),
            )
            company = cur.fetchone()
            cur.execute(
                """INSERT INTO users (username, password_hash, role, company_id)
                   VALUES (%s, %s, 'company', %s) RETURNING id, username, role""",
                (username, _sha256(data["password"]), company["id"]),
            )
            user = cur.fetchone()

    return jsonify(_clean({"company": company, "user": user})), 201


# ----------------------- COMPANIES ------------------------------------
@app.get("/api/companies")
def list_companies():
    rows = query("SELECT * FROM companies WHERE is_active = TRUE ORDER BY companyname")
    return jsonify(_clean(rows))


@app.put("/api/companies/<int:company_id>")
def update_company(company_id):
    if not _can_edit_company(company_id):
        return jsonify({"error": "Not authorized"}), 403
    data = request.get_json(force=True)
    # Only the company name is mandatory — the rest can stay blank if the
    # company hasn't filled in those details yet.
    miss = _required(data, "companyname")
    if miss:
        return jsonify({"error": f"Missing: {miss}"}), 400
    row = execute(
        """UPDATE companies
              SET companyname = %s,
                  location    = %s,
                  companyid   = COALESCE(NULLIF(%s, ''), companyid),
                  phonenumber = %s,
                  x = %s, y = %s,
                  logo = COALESCE(%s, logo)
            WHERE id = %s AND is_active = TRUE
        RETURNING *""",
        (
            data["companyname"],
            (data.get("location") or ""),    # NOT NULL → empty string is OK
            data.get("companyid"),           # NULL/'' → keep existing
            _none_if_blank(data.get("phonenumber")),
            _none_if_blank(data.get("x")), _none_if_blank(data.get("y")),
            _none_if_blank(data.get("logo")),
            company_id,
        ),
        returning=True,
    )
    if not row:
        return jsonify({"error": "Not found"}), 404
    return jsonify(_clean(row))


@app.delete("/api/companies/<int:company_id>")
def soft_delete_company(company_id):
    row = execute(
        "UPDATE companies SET is_active = FALSE WHERE id = %s AND is_active = TRUE RETURNING id",
        (company_id,),
        returning=True,
    )
    if not row:
        return jsonify({"error": "Not found"}), 404
    return ("", 204)


def _none_if_blank(v):
    return None if v in (None, "") else v


@app.post("/api/companies")
def create_company():
    data = request.get_json(force=True)
    miss = _required(data, "companyname", "location", "companyid")
    if miss:
        return jsonify({"error": f"Missing: {miss}"}), 400
    row = execute(
        """INSERT INTO companies (companyname, location, companyid, x, y, phonenumber, logo)
           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (
            data["companyname"], data["location"], data["companyid"],
            _none_if_blank(data.get("x")), _none_if_blank(data.get("y")),
            _none_if_blank(data.get("phonenumber")),
            _none_if_blank(data.get("logo")),
        ),
        returning=True,
    )
    return jsonify(_clean(row)), 201


# ----------------------- CARS -----------------------------------------
@app.get("/api/cars")
def list_cars():
    company_id = request.args.get("company_id")
    if company_id:
        rows = query(
            """SELECT c.*, co.companyname
                 FROM cars c JOIN companies co ON co.id = c.company_id
                WHERE c.company_id = %s AND c.is_active = TRUE AND co.is_active = TRUE
                ORDER BY c.model""",
            (company_id,),
        )
    else:
        rows = query(
            """SELECT c.*, co.companyname
                 FROM cars c JOIN companies co ON co.id = c.company_id
                WHERE c.is_active = TRUE AND co.is_active = TRUE
                ORDER BY co.companyname, c.model"""
        )
    return jsonify(_clean(rows))


@app.put("/api/cars/<int:car_id>")
def update_car(car_id):
    data = request.get_json(force=True)
    miss = _required(data, "type", "model", "color", "platenumber", "company_id")
    if miss:
        return jsonify({"error": f"Missing: {miss}"}), 400
    row = execute(
        """UPDATE cars
              SET type = %s, model = %s, color = %s, platenumber = %s,
                  has_gps = %s, company_id = %s
            WHERE id = %s AND is_active = TRUE
        RETURNING *""",
        (
            data["type"], data["model"], data["color"], data["platenumber"],
            bool(data.get("has_gps", False)), data["company_id"], car_id,
        ),
        returning=True,
    )
    if not row:
        return jsonify({"error": "Not found"}), 404
    return jsonify(_clean(row))


@app.delete("/api/cars/<int:car_id>")
def soft_delete_car(car_id):
    row = execute(
        "UPDATE cars SET is_active = FALSE WHERE id = %s AND is_active = TRUE RETURNING id",
        (car_id,),
        returning=True,
    )
    if not row:
        return jsonify({"error": "Not found"}), 404
    return ("", 204)


def _validate_car_inputs(vin, type_, model, color, icon, plate, company_id,
                         existing_vin_id=None):
    """Run the full validation gauntlet on a single car. Returns
    {ok: bool, errors: dict[field -> message]} so the frontend can show
    each error next to its field."""
    errs = {}

    # Field presence
    if not vin:    errs["vin"]          = "VIN is required"
    if not type_:  errs["type"]         = "Type is required"
    if not model:  errs["model"]        = "Model is required"
    if not color:  errs["color"]        = "Color is required"
    if not icon:   errs["plate_icon"]   = "Plate icon is required"
    if not plate:  errs["plate_number"] = "Plate number is required"

    # Color must be one of the curated list (case-insensitive)
    if color and "color" not in errs:
        canon = _normalize_color(color)
        if not canon:
            errs["color"] = (f"Color '{color}' is not allowed. "
                             f"Choose one of: {', '.join(CAR_COLORS)}")

    # VIN length
    if vin and len(vin) != 17:
        errs["vin"] = f"VIN must be exactly 17 characters (got {len(vin)})"

    # Lebanese plate format
    if icon and plate and "plate_icon" not in errs and "plate_number" not in errs:
        ok, msg = _validate_lebanese_plate(icon, plate)
        if not ok:
            # The message references either the icon or the number — pin it
            # on the appropriate field for inline display.
            if "icon" in msg.lower():
                errs["plate_icon"] = msg
            else:
                errs["plate_number"] = msg

    # vininfo offline structural + check digit
    if vin and "vin" not in errs:
        ok, msg = _validate_vin_offline(vin)
        if not ok:
            errs["vin"] = msg

    # Combined plate-number uniqueness against the DB
    platenumber = f"{icon} {plate}".strip() if (icon and plate) else None
    if platenumber and "plate_icon" not in errs and "plate_number" not in errs:
        existing = query("SELECT id FROM cars WHERE platenumber = %s",
                         (platenumber,), one=True)
        if existing:
            errs["plate_number"] = f"Plate '{platenumber}' is already registered"

    # VIN uniqueness against the DB (skip for the same-row update case)
    if vin and "vin" not in errs:
        existing = query("SELECT id FROM cars WHERE vin = %s", (vin,), one=True)
        if existing and (existing_vin_id is None or existing["id"] != existing_vin_id):
            errs["vin"] = f"VIN '{vin}' is already registered"

    # NHTSA cross-check — only if everything else is clean. Soft-fail when
    # NHTSA returns nothing (common for JDM / Gulf imports).
    if vin and not errs:
        d_model, d_body = _decode_vin_nhtsa(vin)
        if d_model and not _loose_match(d_model, model):
            errs["model"] = f"VIN decodes to model '{d_model}', not '{model}'"
        if d_body and not _loose_match(d_body, type_):
            errs["type"] = f"VIN decodes to body class '{d_body}', not '{type_}'"

    return {
        "ok":          not errs,
        "errors":      errs,
        "platenumber": platenumber,
        "color":       _normalize_color(color) or color,
    }


@app.post("/api/cars")
def create_car():
    data = request.get_json(force=True)
    miss = _required(data, "vin", "type", "model", "platenumber", "company_id")
    if miss:
        return jsonify({"error": f"Missing: {miss}"}), 400
    if not _can_edit_company(int(data["company_id"])):
        return jsonify({"error": "Not authorized"}), 403

    # Split the platenumber back into icon + number so we can run the same
    # field-level validation as the CSV path. Format expected: "<icon> <digits>".
    raw_plate = (data.get("platenumber") or "").strip()
    parts = raw_plate.split(maxsplit=1)
    if len(parts) == 2:
        icon, plate = parts[0], parts[1]
    else:
        icon, plate = "", raw_plate

    result = _validate_car_inputs(
        vin=data["vin"].strip(),
        type_=data["type"].strip(),
        model=data["model"].strip(),
        color=(data.get("color") or "").strip(),
        icon=icon,
        plate=plate,
        company_id=int(data["company_id"]),
    )
    if not result["ok"]:
        return jsonify({"error": "Validation failed", "errors": result["errors"]}), 400

    row = execute(
        """INSERT INTO cars
             (vin, type, model, color, platenumber, has_gps, company_id)
           VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
        (
            data["vin"].strip(), data["type"].strip(), data["model"].strip(),
            result["color"],
            result["platenumber"],
            bool(data.get("has_gps", False)),
            int(data["company_id"]),
        ),
        returning=True,
    )
    return jsonify(_clean(row)), 201


# ----------------------- KNOWN VIN registry --------------------------
# A small curated catalogue of VINs the company user can pick from in the
# Add Car form's VIN dropdown. Each entry includes the canonical type/
# model/color so picking a VIN can auto-fill those fields. The list is
# meant to be expanded over time (or sourced from a DB table later).
# All entries here are real VINs that pass the vininfo check digit so they
# also satisfy the strict validation pipeline on save.
KNOWN_VINS = [
    # Original three (also in the seed)
    {"vin": "1HGCM82633A004352", "type": "Sedan",   "model": "Honda Accord",        "color": "White"},
    {"vin": "1HGBH41JXMN109186", "type": "Sedan",   "model": "Honda Civic",         "color": "Black"},
    {"vin": "1M8GDM9AXKP042788", "type": "Pickup",  "model": "Ford F-150",          "color": "Red"},
    # Compiled from public free sources (NHTSA test set + open vehicle
    # datasets) — every entry is checksum-verified by vininfo so it
    # passes the strict validation pipeline on save.
    {"vin": "4T1BG22K8WU500001", "type": "Sedan",   "model": "Toyota Camry",        "color": "White"},
    {"vin": "2T1BR32E6YC600001", "type": "Sedan",   "model": "Toyota Corolla",      "color": "Silver"},
    {"vin": "JTDBT4K32A1700001", "type": "Sedan",   "model": "Toyota Yaris",        "color": "Red"},
    {"vin": "JTMRD33V750800001", "type": "SUV",     "model": "Toyota RAV4",         "color": "Black"},
    {"vin": "5TDBKRFH5FS900001", "type": "SUV",     "model": "Toyota Highlander",   "color": "Gray"},
    {"vin": "JTNKHMBX2K1100001", "type": "SUV",     "model": "Toyota 4Runner",      "color": "Beige"},
    {"vin": "1HGCG56412A300001", "type": "Sedan",   "model": "Honda Accord",        "color": "White"},
    {"vin": "2HGFG12825H400001", "type": "Sedan",   "model": "Honda Civic",         "color": "Black"},
    {"vin": "5J6RE48739L500001", "type": "SUV",     "model": "Honda CR-V",          "color": "Silver"},
    {"vin": "5FNYF5H58FB600001", "type": "SUV",     "model": "Honda Pilot",         "color": "Gray"},
    {"vin": "WBANE53577CW00001", "type": "Sedan",   "model": "BMW 5 Series",        "color": "Black"},
    {"vin": "WBA3A5G57DNP00001", "type": "Sedan",   "model": "BMW 3 Series",        "color": "White"},
    {"vin": "WBA8E1G57HNU00001", "type": "Coupe",   "model": "BMW M3",              "color": "Blue"},
    {"vin": "5UXKR0C57F0K00001", "type": "SUV",     "model": "BMW X5",              "color": "Black"},
    {"vin": "5UXWX7C5XDL000001", "type": "SUV",     "model": "BMW X3",              "color": "Silver"},
    {"vin": "WDDGF8AB9DA000001", "type": "Sedan",   "model": "Mercedes C-Class",    "color": "Black"},
    {"vin": "WDDHF5KB7DA000001", "type": "Sedan",   "model": "Mercedes E-Class",    "color": "Silver"},
    {"vin": "4JGDA5HB9FA600001", "type": "SUV",     "model": "Mercedes GLE",        "color": "Gray"},
    {"vin": "WDDNG56X28A000001", "type": "Sedan",   "model": "Mercedes S-Class",    "color": "Black"},
    {"vin": "WAUEFAFL2BN000001", "type": "Sedan",   "model": "Audi A4",             "color": "White"},
    {"vin": "WAUDH78E38A000001", "type": "Sedan",   "model": "Audi A6",             "color": "Gray"},
    {"vin": "WA1LFAFP2CA000001", "type": "SUV",     "model": "Audi Q5",             "color": "Black"},
    {"vin": "WA1AGAFE9DD000001", "type": "SUV",     "model": "Audi Q7",             "color": "White"},
    {"vin": "5YJSA1H13EFP00001", "type": "SUV",     "model": "Tesla Model X",       "color": "Black"},
    {"vin": "5YJSA1S25FF000001", "type": "Sedan",   "model": "Tesla Model S",       "color": "Red"},
    {"vin": "5YJ3E1EB9JF000001", "type": "Sedan",   "model": "Tesla Model 3",       "color": "White"},
    {"vin": "5YJYGDEE0LF000001", "type": "SUV",     "model": "Tesla Model Y",       "color": "Blue"},
    {"vin": "KMHCT4AE3FU100001", "type": "Sedan",   "model": "Hyundai Accent",      "color": "Silver"},
    {"vin": "KMHEC4A47AA200001", "type": "Sedan",   "model": "Hyundai Sonata",      "color": "Black"},
    {"vin": "5NMSGDAB8DH300001", "type": "SUV",     "model": "Hyundai Santa Fe",    "color": "White"},
    {"vin": "KM8J33A41FU400001", "type": "SUV",     "model": "Hyundai Tucson",      "color": "Gray"},
    {"vin": "KNAFK4A63F5500001", "type": "Sedan",   "model": "Kia Cerato",          "color": "Beige"},
    {"vin": "KNDPB3A2XD7600001", "type": "SUV",     "model": "Kia Sportage",        "color": "Black"},
    {"vin": "5XYKT3A16CG700001", "type": "SUV",     "model": "Kia Sorento",         "color": "White"},
    {"vin": "1N4AL3AP9JC100001", "type": "Sedan",   "model": "Nissan Altima",       "color": "Silver"},
    {"vin": "3N1AB7AP0JL200001", "type": "Sedan",   "model": "Nissan Sentra",       "color": "Gray"},
    {"vin": "JN8AT2MVXJW300001", "type": "SUV",     "model": "Nissan X-Trail",      "color": "Red"},
    {"vin": "JN8AY2NC7H9400001", "type": "SUV",     "model": "Nissan Patrol",       "color": "Black"},
    {"vin": "1FA6P8CF0L5500001", "type": "Coupe",   "model": "Ford Mustang",        "color": "Blue"},
    {"vin": "1FMCU0HD0LU600001", "type": "SUV",     "model": "Ford Escape",         "color": "White"},
    {"vin": "1FM5K8D88EG700001", "type": "SUV",     "model": "Ford Explorer",       "color": "Silver"},
    {"vin": "1FTFW1ET0DK800001", "type": "Pickup",  "model": "Ford F-150",          "color": "Red"},
    {"vin": "3VWLL7AJ2DM900001", "type": "Sedan",   "model": "Volkswagen Jetta",    "color": "Black"},
    {"vin": "WVWBP7AN0DE000001", "type": "Sedan",   "model": "Volkswagen Passat",   "color": "White"},
    {"vin": "1V2HP2CA3GC000001", "type": "SUV",     "model": "Volkswagen Tiguan",   "color": "Gray"},
    {"vin": "WVWMR7AJ1BW000001", "type": "Hatchback","model": "Volkswagen Golf",    "color": "Red"},
    {"vin": "JTHBA30G455000001", "type": "Sedan",   "model": "Lexus IS",            "color": "Silver"},
    {"vin": "JTHCK1EG1A2000001", "type": "Sedan",   "model": "Lexus ES",            "color": "White"},
    {"vin": "2T2BK1BA3DC000001", "type": "SUV",     "model": "Lexus RX",            "color": "Black"},
    {"vin": "SALWR2VF5FA000001", "type": "SUV",     "model": "Range Rover",         "color": "Black"},
    {"vin": "SALWR2KF8GA000001", "type": "SUV",     "model": "Range Rover Sport",   "color": "White"},
    {"vin": "WP0AA2A7XAL000001", "type": "Sport",   "model": "Porsche 911",         "color": "Yellow"},
    {"vin": "WP1AA2AY5FL000001", "type": "SUV",     "model": "Porsche Cayenne",     "color": "Black"},
    {"vin": "JM3KE2BE6D0000001", "type": "SUV",     "model": "Mazda CX-5",          "color": "Red"},
    {"vin": "JM1BL1L74C1000001", "type": "Sedan",   "model": "Mazda 3",             "color": "White"},
    {"vin": "JA32U2FU6AU000001", "type": "Sedan",   "model": "Mitsubishi Lancer",   "color": "Silver"},
    {"vin": "JA4JT3AWXDU000001", "type": "SUV",     "model": "Mitsubishi Outlander","color": "Gray"},
    {"vin": "1ZVBP8AM6E5000001", "type": "Coupe",   "model": "Ford Mustang",        "color": "Black"},
    {"vin": "3C4PDCAB0FT000001", "type": "SUV",     "model": "Jeep Cherokee",       "color": "Beige"},
    {"vin": "1J4GA59117L000001", "type": "SUV",     "model": "Jeep Wrangler",       "color": "Green"},
]


@app.get("/api/known-vins")
def list_known_vins():
    """Return the curated VIN registry used by the Add Car form's VIN
    dropdown. Each entry: {vin, type, model, color}."""
    return jsonify(KNOWN_VINS)


@app.get("/api/decode-vin")
def decode_vin():
    """Live VIN auto-decode for the frontend single-add form. Runs the
    offline structural check first; only hits NHTSA if the structure is
    valid. Returns whatever NHTSA could find — the frontend pre-fills
    the type/model dropdowns with this when the values are recognised."""
    vin = (request.args.get("vin") or "").strip()
    if len(vin) != 17:
        return jsonify({"error": "VIN must be 17 characters", "vin": vin}), 400

    ok, msg = _validate_vin_offline(vin)
    if not ok:
        return jsonify({"error": msg, "vin": vin}), 400

    model, body = _decode_vin_nhtsa(vin)
    return jsonify({
        "vin":   vin,
        "model": model,
        "type":  body,
    })


# ----------------------- CARS — bulk CSV upload + VIN validation -----
NHTSA_DECODE_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/{vin}?format=json"
CSV_REQUIRED_HEADERS = ("vin", "type", "model", "color", "icon", "plate_number")

# Curated list of accepted car colors. The Add-Car dropdown and CSV uploader
# both validate against this set so what gets stored is always one of these.
CAR_COLORS = (
    "White", "Black", "Silver", "Gray",
    "Red", "Blue", "Green", "Yellow",
    "Brown", "Beige", "Gold", "Orange",
    "Maroon", "Purple", "Pink",
    "Bronze", "Champagne", "Pearl White", "Pearl Black",
)
_CAR_COLORS_NORMALIZED = {c.lower() for c in CAR_COLORS}


def _normalize_color(s: str):
    """Returns the canonical-cased color name if `s` matches one of the
    accepted colors (case-insensitive), otherwise None."""
    if not s:
        return None
    low = s.strip().lower()
    for c in CAR_COLORS:
        if c.lower() == low:
            return c
    return None


# Lebanese license-plate icons (single letters used on private plates).
# M = Mount Lebanon, B = Beirut, T = Tripoli (North), G = Bekaa, N = Nabatieh,
# Y, Z, O = additional series. Reject anything else early.
LEBANESE_PLATE_ICONS = set("MBTGNYZO")
import re
_LEB_PLATE_NUMBER_RE = re.compile(r"^\d{1,7}$")


def _validate_lebanese_plate(icon: str, plate: str):
    """Returns (ok: bool, error_message: str). Verifies the plate icon
    is one of the recognised Lebanese letter codes and that the numeric
    part is 1-7 digits with no spaces or punctuation."""
    icon_u = (icon or "").strip().upper()
    plate_s = (plate or "").strip()
    if icon_u not in LEBANESE_PLATE_ICONS:
        return False, (f"Plate icon '{icon}' is not a valid Lebanese plate "
                       f"letter (expected one of {sorted(LEBANESE_PLATE_ICONS)})")
    if not _LEB_PLATE_NUMBER_RE.match(plate_s):
        return False, f"Plate number '{plate}' must be 1-7 digits"
    return True, ""


def _validate_vin_offline(vin: str):
    """Offline VIN structural + check-digit validation via vininfo.
    Returns (ok: bool, error_message: str). North American VINs have a
    real check digit (9th char); other regions return None and we accept
    them. Catches typos cheaply before any network round-trip."""
    try:
        v = _VinInfo(vin)
    except Exception as e:
        return False, f"Invalid VIN '{vin}': {e}"
    try:
        cs = v.verify_checksum()
    except Exception:
        cs = None
    if cs is False:
        return False, f"VIN '{vin}' has an invalid check digit (typo?)"
    return True, ""


def _decode_vin_nhtsa(vin: str):
    """Hit NHTSA's free VIN decoder. Returns (model, body_class) — either
    field may be None if the API didn't fill it. Returns (None, None) on
    network or parse errors so a transient outage doesn't block uploads."""
    try:
        r = requests.get(NHTSA_DECODE_URL.format(vin=vin), timeout=10)
        if r.status_code != 200:
            return None, None
        data = r.json() or {}
        results = {
            (item.get("Variable") or ""): (item.get("Value") or "")
            for item in (data.get("Results") or [])
        }
        return (results.get("Model") or None,
                results.get("Body Class") or None)
    except Exception:
        return None, None


def _loose_match(decoded: str, user_value: str) -> bool:
    """Case-insensitive substring match in either direction. NHTSA returns
    short names (e.g. "Camry"); users often type "Toyota Camry" — either
    side appearing inside the other counts as a match."""
    d = (decoded or "").strip().lower()
    u = (user_value or "").strip().lower()
    if not d or not u:
        return True
    return d in u or u in d


@app.post("/api/cars/upload-csv")
def upload_cars_csv():
    """Bulk-add cars from a CSV. Validates headers, rejects duplicate VINs
    (within the file *and* against existing rows), then asks NHTSA whether
    each VIN actually matches the type/model the user typed. Only fully-
    valid rows are inserted."""
    u = _current_user()
    if not u:
        return jsonify({"error": "Not authenticated"}), 401
    # Only company users use this flow — admin doesn't add cars.
    if u.get("role") != "company" or not u.get("company_id"):
        return jsonify({"error": "Only company users can upload cars"}), 403
    company_id = int(u["company_id"])

    f = request.files.get("file")
    if not f:
        return jsonify({"error": "No file uploaded"}), 400
    try:
        text = f.read().decode("utf-8-sig")
    except Exception:
        return jsonify({"error": "File is not valid UTF-8"}), 400

    reader = csv.DictReader(io.StringIO(text))
    headers = [h.strip() for h in (reader.fieldnames or [])]
    missing = [h for h in CSV_REQUIRED_HEADERS if h not in headers]
    if missing:
        return jsonify({
            "error": f"Missing CSV headers: {missing}",
            "expected": list(CSV_REQUIRED_HEADERS),
        }), 400

    seen = set()
    to_insert = []
    errors = []

    for i, raw in enumerate(reader, start=2):  # row 1 is the header
        row   = {k: (v or "").strip() for k, v in raw.items()}
        vin   = row.get("vin", "")
        type_ = row.get("type", "")
        model = row.get("model", "")
        color = row.get("color", "")
        icon  = row.get("icon") or "M"
        plate = row.get("plate_number", "")

        # Header-checked basic emptiness / VIN format
        if not vin:
            errors.append({"row": i, "error": "Missing VIN"});                                 continue
        if len(vin) != 17:
            errors.append({"row": i, "error": f"VIN '{vin}' must be 17 characters"});           continue
        if not type_ or not model or not plate or not color:
            errors.append({"row": i, "error": "Missing type, model, color, or plate_number"}); continue

        # Color must be in the curated list
        canon_color = _normalize_color(color)
        if not canon_color:
            errors.append({"row": i, "error":
                f"Color '{color}' is not allowed (allowed: {', '.join(CAR_COLORS)})"});         continue
        color = canon_color

        # Lebanese plate format check (icon must be a recognised letter,
        # number must be 1–7 digits). This is independent of NHTSA and
        # specifically tailored for the Lebanese DMV's plate scheme.
        ok, msg = _validate_lebanese_plate(icon, plate)
        if not ok:
            errors.append({"row": i, "error": msg}); continue

        # Offline structural + check-digit validation (vininfo) — fast,
        # no network. Filters out typos before we burn an NHTSA call.
        ok, msg = _validate_vin_offline(vin)
        if not ok:
            errors.append({"row": i, "error": msg}); continue

        # Duplicate within the CSV itself
        if vin in seen:
            errors.append({"row": i, "error": f"Duplicate VIN '{vin}' inside the CSV"}); continue
        seen.add(vin)

        # Duplicate against the database
        if query("SELECT 1 FROM cars WHERE vin = %s", (vin,), one=True):
            errors.append({"row": i, "error": f"VIN '{vin}' already exists in the database"}); continue

        # NHTSA cross-check: model / body class
        d_model, d_body = _decode_vin_nhtsa(vin)
        if d_model and not _loose_match(d_model, model):
            errors.append({"row": i, "error":
                f"VIN decodes to model '{d_model}', not '{model}'"}); continue
        if d_body and not _loose_match(d_body, type_):
            errors.append({"row": i, "error":
                f"VIN decodes to body class '{d_body}', not '{type_}'"}); continue

        platenumber = f"{icon} {plate}".strip()
        to_insert.append((vin, type_, model, color, platenumber, False, company_id))

    # All-or-nothing — if any row failed validation, the whole CSV is
    # rejected and nothing is written to the database. The frontend gets
    # the full list of bad rows so the user can fix them and re-upload.
    if errors:
        return jsonify({
            "error":    "CSV rejected — fix the listed rows and re-upload.",
            "inserted": 0,
            "failed":   errors,
        }), 400

    # All rows valid → insert them in a single transaction so a late insert
    # error rolls back any earlier inserts from this same upload.
    from db import get_conn
    inserted = 0
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                for params in to_insert:
                    cur.execute(
                        """INSERT INTO cars
                             (vin, type, model, color, platenumber, has_gps, company_id)
                           VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                        params,
                    )
                    inserted += 1
    except Exception as e:
        return jsonify({
            "error":    f"Insert failed mid-batch — nothing was saved: {e}",
            "inserted": 0,
            "failed":   [{"row": "?", "error": str(e)}],
        }), 400

    return jsonify({"inserted": inserted, "failed": []}), 200


# ----------------------- BRANCHES -------------------------------------
@app.get("/api/branches")
def list_branches():
    company_id = request.args.get("company_id")
    # Company users always see only their own branches, no matter what they
    # ask for in the query string.
    u = _current_user()
    if u and u.get("role") == "company":
        company_id = u.get("company_id")
    if company_id:
        rows = query(
            """SELECT b.*, co.companyname
                 FROM branches b JOIN companies co ON co.id = b.company_id
                WHERE b.company_id = %s AND b.is_active = TRUE AND co.is_active = TRUE
                ORDER BY b.branchname""",
            (company_id,),
        )
    else:
        rows = query(
            """SELECT b.*, co.companyname
                 FROM branches b JOIN companies co ON co.id = b.company_id
                WHERE b.is_active = TRUE AND co.is_active = TRUE
                ORDER BY co.companyname, b.branchname"""
        )
    return jsonify(_clean(rows))


@app.post("/api/branches")
def create_branch():
    data = request.get_json(force=True) or {}
    miss = _required(data, "company_id", "branchname", "location")
    if miss:
        return jsonify({"error": f"Missing: {miss}"}), 400
    if not _can_edit_company(int(data["company_id"])):
        return jsonify({"error": "Not authorized"}), 403
    row = execute(
        """INSERT INTO branches
             (company_id, branchname, location, phonenumber, x, y)
           VALUES (%s,%s,%s,%s,%s,%s) RETURNING *""",
        (
            int(data["company_id"]), data["branchname"], data["location"],
            _none_if_blank(data.get("phonenumber")),
            _none_if_blank(data.get("x")), _none_if_blank(data.get("y")),
        ),
        returning=True,
    )
    return jsonify(_clean(row)), 201


@app.put("/api/branches/<int:branch_id>")
def update_branch(branch_id):
    data = request.get_json(force=True) or {}
    miss = _required(data, "company_id", "branchname", "location")
    if miss:
        return jsonify({"error": f"Missing: {miss}"}), 400
    existing = query("SELECT company_id FROM branches WHERE id = %s",
                     (branch_id,), one=True)
    if not existing:
        return jsonify({"error": "Not found"}), 404
    if not (_can_edit_company(existing["company_id"]) and
            _can_edit_company(int(data["company_id"]))):
        return jsonify({"error": "Not authorized"}), 403
    row = execute(
        """UPDATE branches
              SET company_id = %s, branchname = %s, location = %s,
                  phonenumber = %s, x = %s, y = %s
            WHERE id = %s AND is_active = TRUE
        RETURNING *""",
        (
            int(data["company_id"]), data["branchname"], data["location"],
            _none_if_blank(data.get("phonenumber")),
            _none_if_blank(data.get("x")), _none_if_blank(data.get("y")),
            branch_id,
        ),
        returning=True,
    )
    if not row:
        return jsonify({"error": "Not found"}), 404
    return jsonify(_clean(row))


@app.delete("/api/branches/<int:branch_id>")
def delete_branch(branch_id):
    """Hard delete — the row is removed from the branches table."""
    existing = query("SELECT company_id FROM branches WHERE id = %s",
                     (branch_id,), one=True)
    if not existing:
        return jsonify({"error": "Not found"}), 404
    if not _can_edit_company(existing["company_id"]):
        return jsonify({"error": "Not authorized"}), 403
    execute("DELETE FROM branches WHERE id = %s", (branch_id,))
    return ("", 204)


# ----------------------- CLIENTS --------------------------------------
def _attach_linked_companies(rows):
    """Augment client rows with a `companies` list (names of every
    company linked to that client via client_companies). Accepts either
    a single dict or a list of dicts; returns the same shape."""
    if rows is None:
        return rows
    is_single = isinstance(rows, dict)
    items = [rows] if is_single else list(rows)
    if not items:
        return rows
    ids = [r["id"] for r in items if r.get("id") is not None]
    if not ids:
        return rows
    links = query(
        """SELECT cc.client_id, co.companyname
             FROM client_companies cc
             JOIN companies co ON co.id = cc.company_id
            WHERE cc.client_id = ANY(%s)
              AND co.is_active = TRUE
            ORDER BY co.companyname""",
        (ids,),
    )
    grouped = {}
    for link in links:
        grouped.setdefault(link["client_id"], []).append(link["companyname"])
    for r in items:
        r["companies"] = grouped.get(r["id"], [])
    return items[0] if is_single else items


@app.get("/api/clients/lookup")
def lookup_client_by_personid():
    """Cross-company lookup by personid. Returns the canonical client
    record if ANY company has registered this person, so the Add Client
    form can pre-fill everything the user would otherwise re-type. The
    matching POST /api/clients call will then link this company to the
    existing record instead of inserting a duplicate.

    Intentionally global — in this domain a client is identified by a
    real personid + licenseid that any company may need to reference."""
    u = _current_user()
    if not u:
        return jsonify({"error": "Not authenticated"}), 401
    personid = (request.args.get("personid") or "").strip()
    if not personid:
        return jsonify({"error": "personid required"}), 400
    row = query(
        "SELECT * FROM clients WHERE personid = %s LIMIT 1",
        (personid,), one=True,
    )
    if not row:
        return ("", 204)
    return jsonify(_attach_linked_companies(_clean(row)))


@app.get("/api/clients")
def list_clients():
    # Company users see every client linked to their company (via the
    # client_companies junction). Admin sees every client. The legacy
    # clients.company_id column is no longer used for filtering — the
    # junction is the source of truth.
    u = _current_user()
    if u and u.get("role") == "company" and u.get("company_id"):
        rows = query(
            """SELECT cl.*
                 FROM clients cl
                 JOIN client_companies cc ON cc.client_id = cl.id
                WHERE cl.is_active = TRUE
                  AND cc.company_id = %s
                ORDER BY cl.name""",
            (u["company_id"],),
        )
    else:
        rows = query("SELECT * FROM clients WHERE is_active = TRUE ORDER BY name")
    rows = _clean(rows)
    rows = _attach_linked_companies(rows)
    return jsonify(rows)


def _user_can_touch_client(client_id: int) -> bool:
    """Company users may edit/delete only clients linked to their
    company; admin may touch any client."""
    u = _current_user()
    if not u:
        return False
    if u.get("role") != "company":
        return True
    company_id = u.get("company_id")
    if not company_id:
        return False
    link = query(
        "SELECT 1 FROM client_companies WHERE client_id = %s AND company_id = %s LIMIT 1",
        (client_id, int(company_id)), one=True,
    )
    return link is not None


@app.put("/api/clients/<int:client_id>")
def update_client(client_id):
    data = request.get_json(force=True)
    # personid / father / mother / dates are conditional now — see create_client.
    miss = _required(data, "licenseid")
    if miss:
        return jsonify({"error": f"Missing: {miss}"}), 400
    if not _user_can_touch_client(client_id):
        return jsonify({"error": "Not authorized"}), 403
    id_type  = _norm_id_type(data.get("id_type"))
    personid = _none_if_blank(data.get("personid"))
    if id_type in ("passport", "national_id") and not personid:
        return jsonify({"error": "personid required for passport / national ID"}), 400
    row = execute(
        """UPDATE clients
              SET personid = %s, name = %s, fathername = %s, mothername = %s,
                  nationality = %s,
                  phonenumber = %s, dateofbirth = %s, licenseid = %s,
                  startdatelicense = %s, enddatelicense = %s,
                  photo = COALESCE(%s, photo),
                  id_type = COALESCE(%s, id_type)
            WHERE id = %s AND is_active = TRUE
        RETURNING *""",
        (
            personid,
            _none_if_blank(data.get("name")),
            _none_if_blank(data.get("fathername")),
            _none_if_blank(data.get("mothername")),
            _none_if_blank(data.get("nationality")),
            _none_if_blank(data.get("phonenumber")),
            _none_if_blank(data.get("dateofbirth")),
            data["licenseid"],
            _none_if_blank(data.get("startdatelicense")),
            _none_if_blank(data.get("enddatelicense")),
            _none_if_blank(data.get("photo")),
            id_type,
            client_id,
        ),
        returning=True,
    )
    if not row:
        return jsonify({"error": "Not found"}), 404
    return jsonify(_attach_linked_companies(_clean(row)))


@app.delete("/api/clients/<int:client_id>")
def soft_delete_client(client_id):
    # Company users only unlink their OWN company from the client —
    # other companies that share the client keep their access. If the
    # last link is removed we soft-delete the client record so it
    # vanishes from every list. Admin still soft-deletes outright.
    u = _current_user()
    if u and u.get("role") == "company" and u.get("company_id"):
        company_id = int(u["company_id"])
        # Confirm the client actually exists + is reachable for this user.
        if not _user_can_touch_client(client_id):
            return jsonify({"error": "Not found"}), 404
        execute(
            "DELETE FROM client_companies WHERE client_id = %s AND company_id = %s",
            (client_id, company_id),
        )
        remaining = query(
            "SELECT 1 FROM client_companies WHERE client_id = %s LIMIT 1",
            (client_id,), one=True,
        )
        if not remaining:
            execute(
                "UPDATE clients SET is_active = FALSE WHERE id = %s",
                (client_id,),
            )
        return ("", 204)

    row = execute(
        "UPDATE clients SET is_active = FALSE WHERE id = %s AND is_active = TRUE RETURNING id",
        (client_id,),
        returning=True,
    )
    if not row:
        return jsonify({"error": "Not found"}), 404
    return ("", 204)


_ID_TYPES = {"passport", "national_id", "license"}


def _norm_id_type(v):
    s = (v or "").strip().lower().replace("-", "_").replace(" ", "_")
    return s if s in _ID_TYPES else None


@app.post("/api/clients")
def create_client():
    data = request.get_json(force=True)
    # Only the licenseid is required for every client now. personid,
    # father / mother, DOB, and the licence start/end dates are all
    # conditional and may be left blank for license-only clients.
    miss = _required(data, "licenseid")
    if miss:
        return jsonify({"error": f"Missing: {miss}"}), 400

    id_type  = _norm_id_type(data.get("id_type"))
    personid = _none_if_blank(data.get("personid"))
    if id_type in ("passport", "national_id") and not personid:
        return jsonify({"error": "personid required for passport / national ID"}), 400

    licenseid = data["licenseid"]

    u = _current_user()
    if u and u.get("role") == "company":
        company_id = u.get("company_id")
    else:
        company_id = data.get("company_id")

    # A client is identified by (personid, licenseid) — a real person's
    # national + driving licence. If both already match an existing row
    # we treat this POST as "this company now also rents to that
    # client" and just link the junction; the form data the user typed
    # is ignored in favour of the canonical record.
    if personid:
        existing = query(
            "SELECT * FROM clients WHERE personid = %s AND licenseid = %s LIMIT 1",
            (personid, licenseid), one=True,
        )
    else:
        existing = query(
            "SELECT * FROM clients WHERE personid IS NULL AND licenseid = %s LIMIT 1",
            (licenseid,), one=True,
        )
    if existing:
        if not existing.get("is_active"):
            execute(
                "UPDATE clients SET is_active = TRUE WHERE id = %s",
                (existing["id"],),
            )
            existing["is_active"] = True
        if company_id:
            execute(
                """INSERT INTO client_companies (client_id, company_id)
                     VALUES (%s, %s) ON CONFLICT DO NOTHING""",
                (existing["id"], int(company_id)),
            )
        return jsonify(_attach_linked_companies(_clean(existing))), 200

    # If only ONE of personid/licenseid is already in use, the
    # submission contradicts an existing client — reject with a clear
    # error rather than mangling the existing row.
    if personid:
        partial = query(
            "SELECT id FROM clients WHERE personid = %s OR licenseid = %s LIMIT 1",
            (personid, licenseid), one=True,
        )
    else:
        partial = query(
            "SELECT id FROM clients WHERE licenseid = %s LIMIT 1",
            (licenseid,), one=True,
        )
    if partial:
        return jsonify({
            "error": "personid or licenseid is already used by a different client",
        }), 409

    row = execute(
        """INSERT INTO clients
             (personid, name, fathername, mothername, nationality,
              phonenumber, dateofbirth, licenseid,
              startdatelicense, enddatelicense, company_id, photo, id_type)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
        (
            personid,
            _none_if_blank(data.get("name")),
            _none_if_blank(data.get("fathername")),
            _none_if_blank(data.get("mothername")),
            _none_if_blank(data.get("nationality")),
            _none_if_blank(data.get("phonenumber")),
            _none_if_blank(data.get("dateofbirth")),
            licenseid,
            _none_if_blank(data.get("startdatelicense")),
            _none_if_blank(data.get("enddatelicense")),
            int(company_id) if company_id else None,
            _none_if_blank(data.get("photo")),
            id_type,
        ),
        returning=True,
    )
    if company_id and row:
        execute(
            """INSERT INTO client_companies (client_id, company_id)
                 VALUES (%s, %s) ON CONFLICT DO NOTHING""",
            (row["id"], int(company_id)),
        )
    return jsonify(_attach_linked_companies(_clean(row))), 201


# ----------------------- RENTALS --------------------------------------
@app.post("/api/rentals")
def create_rental():
    data = request.get_json(force=True)
    miss = _required(data, "client_id", "car_vin", "start_date", "end_date")
    if miss:
        return jsonify({"error": f"Missing: {miss}"}), 400

    # Company users can only rent out cars they own. Admin can rent any
    # car (legacy CSV / manual paths).
    car = query("SELECT company_id FROM cars WHERE vin = %s",
                (data["car_vin"],), one=True)
    if not car:
        return jsonify({"error": "Car not found"}), 404
    if not _can_edit_company(int(car["company_id"])):
        return jsonify({"error": "You can only rent your own company's cars"}), 403

    # Sanity-check the dates so end >= start before hitting the DB.
    if str(data["end_date"]) < str(data["start_date"]):
        return jsonify({"error": "End date must be on or after the start date"}), 400

    row = execute(
        """INSERT INTO rentals
             (client_id, car_vin, start_date, end_date)
           VALUES (%s,%s,%s,%s) RETURNING *""",
        (
            data["client_id"], data["car_vin"],
            data["start_date"], data["end_date"],
        ),
        returning=True,
    )
    return jsonify(_clean(row)), 201


# THE main reporting query: every client + their rented cars + the company
@app.get("/api/rentals/report")
def rentals_report():
    client_id = request.args.get("client_id")
    if client_id:
        rows = query(
            "SELECT * FROM v_client_rentals WHERE client_id = %s "
            "ORDER BY start_date DESC",
            (client_id,),
        )
    else:
        rows = query(
            "SELECT * FROM v_client_rentals ORDER BY client_name, start_date DESC"
        )
    return jsonify(_clean(rows))


# ----------------------- RENTAL MEDIA (photos + videos) ---------------
def _rental_company_id(rental_id: int):
    row = query(
        """SELECT c.company_id
             FROM rentals r
             JOIN cars c ON c.vin = r.car_vin
            WHERE r.id = %s""",
        (rental_id,), one=True,
    )
    return row.get("company_id") if row else None


def _can_attach_to_rental(rental_id: int) -> bool:
    company_id = _rental_company_id(rental_id)
    if company_id is None:
        return False
    return _can_edit_company(company_id)


@app.get("/api/rentals/<int:rental_id>/media")
def list_rental_media(rental_id):
    if not _can_attach_to_rental(rental_id):
        return jsonify({"error": "Not authorized"}), 403
    rows = query(
        "SELECT id, kind, filename, original_name, mime, uploaded_at, uploaded_by "
        "FROM rental_media WHERE rental_id = %s ORDER BY uploaded_at DESC",
        (rental_id,),
    ) or []
    # Return URLs the frontend can use straight in <img>/<video> tags.
    for r in rows:
        r["url"] = f"/uploads/rental_media/{rental_id}/{r['filename']}"
    return jsonify(_clean(rows))


@app.post("/api/rentals/<int:rental_id>/media")
def upload_rental_media(rental_id):
    if not _can_attach_to_rental(rental_id):
        return jsonify({"error": "Not authorized"}), 403
    f = request.files.get("file")
    kind = (request.form.get("kind") or "").strip().lower()
    if not f:
        return jsonify({"error": "No file uploaded"}), 400
    if kind not in ALLOWED_MEDIA_PREFIX:
        return jsonify({"error": "kind must be 'photo' or 'video'"}), 400

    mime = (f.mimetype or "").lower()
    if not any(mime.startswith(p) for p in ALLOWED_MEDIA_PREFIX[kind]):
        return jsonify({
            "error": f"Mime '{mime}' is not allowed for kind '{kind}'"
        }), 400

    ext = ""
    if "." in f.filename:
        ext = "." + f.filename.rsplit(".", 1)[-1].lower()[:6]
    fname = f"{secrets.token_hex(8)}{ext}"
    rental_dir = os.path.join(MEDIA_ROOT, str(rental_id))
    os.makedirs(rental_dir, exist_ok=True)
    f.save(os.path.join(rental_dir, fname))

    user = _current_user() or {}
    row = execute(
        """INSERT INTO rental_media
             (rental_id, kind, filename, original_name, mime, uploaded_by)
           VALUES (%s,%s,%s,%s,%s,%s) RETURNING *""",
        (rental_id, kind, fname, f.filename, mime, user.get("username")),
        returning=True,
    )
    row["url"] = f"/uploads/rental_media/{rental_id}/{fname}"
    return jsonify(_clean(row)), 201


@app.delete("/api/rentals/<int:rental_id>/media/<int:media_id>")
def delete_rental_media(rental_id, media_id):
    if not _can_attach_to_rental(rental_id):
        return jsonify({"error": "Not authorized"}), 403
    row = query(
        "SELECT filename FROM rental_media WHERE id = %s AND rental_id = %s",
        (media_id, rental_id), one=True,
    )
    if not row:
        return jsonify({"error": "Not found"}), 404
    path = os.path.join(MEDIA_ROOT, str(rental_id), row["filename"])
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        pass
    execute("DELETE FROM rental_media WHERE id = %s", (media_id,))
    return ("", 204)


@app.get("/uploads/rental_media/<int:rental_id>/<path:filename>")
def serve_rental_media(rental_id, filename):
    """Static-serve a saved photo/video. <img>/<video> tags can't send
    custom headers, so requiring X-Auth-User here would 403 every render
    and the browser would show a broken image / black video frame.
    The path uses a random 16-char hex filename per file so URLs aren't
    trivially guessable; upload / delete still go through the auth-checked
    endpoints above."""
    return send_from_directory(
        os.path.join(MEDIA_ROOT, str(rental_id)),
        filename,
    )


# ----------------------- PDF EXPORT -----------------------------------
def _safe_filename_part(s: str) -> str:
    return "".join(c if c.isalnum() or c in "_-" else "_" for c in (s or "row"))


@app.get("/api/report.pdf")
def download_report_pdf():
    """Server-side PDF generation with proper Arabic shaping + RTL bidi."""
    rental_id = request.args.get("rental_id", type=int)
    lang = (request.args.get("lang") or "en").lower()
    if lang not in ("en", "ar"):
        lang = "en"

    if rental_id:
        row = query(
            "SELECT * FROM v_client_rentals WHERE rental_id = %s",
            (rental_id,),
            one=True,
        )
        if not row:
            return jsonify({"error": "Not found"}), 404
        buf = single_pdf(row, lang=lang)
        filename = (
            f"rental_{_safe_filename_part(row.get('client_name'))}"
            f"_{_safe_filename_part(row.get('car_vin'))}.pdf"
        )
    else:
        rows = query(
            "SELECT * FROM v_client_rentals ORDER BY client_name, start_date DESC"
        )
        buf = report_pdf(rows or [], lang=lang)
        filename = "rental_report.pdf"

    return send_file(
        buf,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename,
    )


# ----------------------- entrypoint -----------------------------------
if __name__ == "__main__":
    port = int(os.getenv("FLASK_PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=True)
