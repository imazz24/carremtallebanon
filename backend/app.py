"""Flask REST API for the Car Rental project."""
import os
import io
import csv
import json
import time
import hashlib
import secrets
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from decimal import Decimal
from flask import Flask, jsonify, request, send_file, send_from_directory, g
from flask_cors import CORS
from dotenv import load_dotenv

import requests
from vininfo import Vin as _VinInfo

from psycopg2.extras import RealDictCursor, execute_values

from db import query, execute, get_conn
from pdf_gen import report_pdf, single_pdf
from openapi import build_spec, SWAGGER_HTML

load_dotenv()

FRONTEND_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "frontend")
)
MEDIA_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "uploads", "rental_media")
)
os.makedirs(MEDIA_ROOT, exist_ok=True)

# Photos / videos for B2B "cars rented to companies" records live in a
# separate folder tree, keyed by the special_company_rentals row id.
SPECIAL_MEDIA_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "uploads", "special_rental_media")
)
os.makedirs(SPECIAL_MEDIA_ROOT, exist_ok=True)

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

# Cap the request body so hundreds of concurrent uploads can't OOM a worker with
# one oversized payload. `request.get_json` / file reads pull the whole body into
# memory, so an unbounded upload is a denial-of-service and a stability risk at
# scale. A MAX_BATCH-row JSON file is well under this; raise MAX_UPLOAD_MB only if
# a legitimate import needs more. Flask enforces the limit before the body is
# read, returning 413 (handled below as JSON).
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "32"))
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024


@app.errorhandler(413)
def _payload_too_large(_e):
    return jsonify({
        "error": f"Payload too large — max {MAX_UPLOAD_MB} MB per request. "
                 f"Split the import into smaller files (≤{MAX_BATCH} rows each)."
    }), 413


@app.errorhandler(500)
def _internal_error(_e):
    """Never leak a stack trace / HTML error page to an API client. A worker that
    momentarily can't reach the DB (pool saturated past the queue window, network
    blip) returns clean JSON so the caller can back off and retry."""
    return jsonify({"error": "Internal server error — please retry shortly."}), 500


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


# Largest number of records accepted in a single batch-insert call. Keeps a
# stray multi-thousand-row payload from holding a DB connection (and the NHTSA
# cross-check loop) open indefinitely.
MAX_BATCH = 500

# How many car rows to validate concurrently. Each row's NHTSA model/body
# cross-check is a network round-trip, so a thread pool collapses an
# N×latency wait into roughly one round-trip. Override via env if needed;
# capped against batch size and the DB pool at call time.
BATCH_WORKERS = int(os.getenv("BATCH_WORKERS", "16"))

# Process-wide ceiling on concurrent VIN-validation threads across ALL in-flight
# batch requests. Each validation thread can hold one pooled DB connection
# during its uniqueness checks, so without a cap several companies running big
# batches at once could drain the Postgres pool (DB_POOL_MAX) and stall every
# other request. The pool and this semaphore are both per-process (gunicorn
# worker), so we size the cap a comfortable margin below the pool, leaving
# headroom for the app's non-batch traffic. Threads that exceed the cap simply
# wait — cheaply, holding no connection — until a slot frees.
_DB_POOL_MAX = int(os.getenv("DB_POOL_MAX", "50"))
VALIDATION_CONCURRENCY = max(4, min(32, _DB_POOL_MAX - 16))
_validation_slots = threading.BoundedSemaphore(VALIDATION_CONCURRENCY)


def _batch_rows(payload, key):
    """Normalise a batch-insert body into a list of row dicts. Accepts either
    a bare JSON array (``[ {...}, {...} ]``) or an object that wraps the array
    under `key` (``{"cars": [...]}``). Returns the list, or None if the body
    is neither shape."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get(key), list):
        return payload[key]
    return None


def _load_json_request():
    """Parse the request body as JSON from EITHER an uploaded file (multipart
    field ``file`` — how an external company hands us a document) OR a raw JSON
    request body. Returns ``(payload, error)``: on success ``payload`` is the
    parsed JSON (any shape) and ``error`` is None; on failure ``payload`` is
    None and ``error`` is a human-readable reason for a 400."""
    f = request.files.get("file")
    if f is not None:
        try:
            text = f.read().decode("utf-8-sig")
        except Exception:
            return None, "Uploaded file is not valid UTF-8"
        try:
            return json.loads(text), None
        except Exception as e:
            return None, f"Uploaded file is not valid JSON: {e}"
    payload = request.get_json(force=True, silent=True)
    if payload is None:
        return None, 'Send a JSON body, or upload a .json file in the "file" form field'
    return payload, None


def _batch_rows_from_request(key):
    """Resolve a single-entity batch into a list of row dicts — a bare array or
    ``{key: [...]}`` — from a JSON body or an uploaded file. Returns
    ``(rows, error)`` (rows is None on failure)."""
    payload, err = _load_json_request()
    if err:
        return None, err
    rows = _batch_rows(payload, key)
    if rows is None:
        return None, f'Expected a JSON array or {{"{key}": [...]}}'
    return rows, None


# ----------------------- static frontend ------------------------------
def _no_cache(resp):
    """Force browsers to revalidate the app shell (HTML/JS/CSS) on every load.
    The ?v= query on assets is ignored by the static server, so without this a
    browser that cached index.html keeps pulling the matching stale app.js from
    its own cache — making a rebuilt frontend appear "not to update". `no-cache`
    still allows caching but requires a revalidation (fast 304 when unchanged)."""
    resp.headers["Cache-Control"] = "no-cache, must-revalidate"
    return resp


@app.route("/")
def index():
    return _no_cache(send_from_directory(FRONTEND_DIR, "index.html"))


@app.get("/api/health")
@app.get("/healthz")
def health():
    """Liveness + readiness probe for a load balancer / orchestrator. Round-trips
    a trivial query so an instance whose DB is unreachable (or whose pool is
    wedged) reports unhealthy and gets pulled from rotation instead of black-
    holing traffic. Returns 200 {"status":"ok"} when the DB answers, else 503."""
    from db import ping
    try:
        ping()
        return jsonify({"status": "ok"}), 200
    except Exception as e:
        return jsonify({"status": "unavailable", "error": str(e)}), 503


@app.get("/api/openapi.json")
def openapi_json():
    """Machine-readable OpenAPI 3.0 contract for the external API."""
    return jsonify(build_spec())


@app.get("/api/docs")
def api_docs():
    """Interactive Swagger UI so an external company can read the API and try
    it out with their key. The page itself is public; calls still need a key.

    Served with a strict Content-Security-Policy: every asset is same-origin
    (self-hosted Swagger UI, no CDN), there are no inline scripts, and the only
    network the page talks to is this server (`connect-src 'self'` for
    Try-it-out). Style needs 'unsafe-inline' because Swagger UI injects styles
    at runtime."""
    resp = app.response_class(SWAGGER_HTML, mimetype="text/html")
    resp.headers["Content-Security-Policy"] = (
        "default-src 'none'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "font-src 'self'; "
        "connect-src 'self'; "
        "base-uri 'none'; "
        "form-action 'self'; "
        "frame-ancestors 'none'"
    )
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    return resp


@app.route("/<path:path>")
def static_proxy(path):
    resp = send_from_directory(FRONTEND_DIR, path)
    if path.endswith((".html", ".js", ".css")):
        _no_cache(resp)
    return resp


# ----------------------- AUTH -----------------------------------------
def _sha256(s: str) -> str:
    return hashlib.sha256((s or "").encode("utf-8")).hexdigest()


def _username_for_company(name: str) -> str:
    """Derive a deterministic username from a company name."""
    return (name or "").strip().lower().replace(" ", "_")


def _is_admin_request() -> bool:
    """Lightweight admin check. Routes through _current_user() so it reuses the
    per-request cache instead of issuing its own users lookup."""
    u = _current_user()
    return bool(u and u.get("role") == "admin")


API_KEY_PREFIX = "crk_"   # "car-rental key" — lets a glance tell it's one of ours


def _extract_api_key():
    """Pull an API key off the request: ``Authorization: Bearer <key>`` (the
    convention external integrations expect) or an ``X-API-Key`` header.
    Returns the raw key string, or None."""
    auth = request.headers.get("Authorization") or ""
    if auth[:7].lower() == "bearer ":
        key = auth[7:].strip()
        if key:
            return key
    return (request.headers.get("X-API-Key") or "").strip() or None


def _api_key_user():
    """Resolve the company user that owns the request's API key (or None).
    The raw key is hashed and matched against the stored hash — we never keep
    the plaintext, so a stolen DB row can't be replayed against the API."""
    key = _extract_api_key()
    if not key:
        return None
    return query(
        "SELECT id, username, role, company_id FROM users WHERE api_key_hash = %s",
        (_sha256(key),), one=True,
    )


_USER_UNSET = object()   # sentinel: distinguishes "not resolved yet" from "resolved to None"


def _current_user():
    """Resolve the calling user. The in-browser app sends an X-Auth-User header
    (no secret — trusted only because it's same-origin after a password login);
    external integrations send a secret API key. Header wins when present so the
    dashboard behaves exactly as before; otherwise we fall back to the key.

    The result is cached on flask.g for the life of the request: a single request
    resolves the user 2–3× (here, _can_edit_company, _is_admin_request), and this
    collapses those to one DB lookup — important now that the users table can hold
    ~100k rows."""
    cached = getattr(g, "_current_user_cache", _USER_UNSET)
    if cached is not _USER_UNSET:
        return cached
    name = (request.headers.get("X-Auth-User") or "").strip().lower()
    if name:
        user = query(
            "SELECT id, username, role, company_id FROM users WHERE LOWER(username) = %s",
            (name,), one=True,
        )
    else:
        user = _api_key_user()
    g._current_user_cache = user
    return user


def _can_edit_company(company_id: int) -> bool:
    """Admin can edit any company; a company user only their own."""
    u = _current_user()
    if not u:
        return False
    if u.get("role") == "admin":
        return True
    return u.get("role") == "company" and u.get("company_id") == int(company_id)


def _resolve_branch_id(branch_id, company_id):
    """Return a branch_id (int) that genuinely belongs to `company_id` and is
    active, or None. Empty / absent / mismatched values all resolve to None so a
    car simply sits at the company's "Main" office rather than being wrongly
    linked to another company's branch."""
    if branch_id in (None, "", "null", "0", 0):
        return None
    try:
        bid = int(branch_id)
    except (TypeError, ValueError):
        return None
    row = query(
        "SELECT id FROM branches WHERE id = %s AND company_id = %s AND is_active = TRUE",
        (bid, int(company_id)), one=True,
    )
    return bid if row else None


def _branch_label(branch_id):
    """Human name for a branch id, for audit detail. NULL/None → 'Main'."""
    if branch_id in (None, "", "null", "0", 0):
        return "Main"
    row = query("SELECT branchname FROM branches WHERE id = %s", (int(branch_id),), one=True)
    return (row and row.get("branchname")) or f"#{branch_id}"


def _car_label(vin):
    """'Model · Plate' for a VIN — used in audit detail so an admin recognises
    the car at a glance instead of a bare VIN. Falls back to the raw VIN."""
    if not vin:
        return ""
    row = query("SELECT model, platenumber FROM cars WHERE vin = %s", (vin,), one=True)
    if not row:
        return vin
    return " · ".join(x for x in (row.get("model"), row.get("platenumber")) if x) or vin


def _diff_fields(old, new, fields):
    """Build a compact audit string of what actually changed, e.g.
    "plate: ABC123→XYZ789, color: red→blue". `fields` is a list of
    (label, key) pairs (or bare keys). Only changed values appear; returns
    '' when nothing in `fields` changed."""
    parts = []
    for f in fields:
        label, key = (f, f) if isinstance(f, str) else f
        ov = old.get(key)
        nv = new.get(key)
        # Normalise so 5 vs "5" and None vs "" don't read as spurious changes.
        if str(ov if ov is not None else "") != str(nv if nv is not None else ""):
            parts.append(f'{label}: {ov if ov not in (None, "") else "—"}→'
                         f'{nv if nv not in (None, "") else "—"}')
    return ", ".join(parts)


def _log_activity(company_id, action, entity, detail=None, ref=None):
    """Record one company action for the admin dashboard's "what are they
    doing" view. Best-effort: a logging failure must never break the
    user's actual create/update/delete.

    ``ref`` is an optional "kind:key" pointer (e.g. "car:<vin>", "client:<id>",
    "branch:<id>") so the admin feed can open that record's detail on click."""
    if not company_id:
        return
    try:
        u = _current_user() or {}
        execute(
            """INSERT INTO activity_log
                 (company_id, user_id, username, action, entity, detail, entity_ref)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (int(company_id), u.get("id"), u.get("username"),
             action, entity, detail, ref),
        )
    except Exception:
        pass


@app.post("/api/login")
def login():
    data = request.get_json(force=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        return jsonify({"error": "Missing credentials"}), 400

    row = query(
        """SELECT u.id, u.username, u.role, u.company_id,
                  u.must_reset_password,
                  c.companyname, c.location, c.companyid, c.phonenumber,
                  c.x AS company_x, c.y AS company_y, c.logo AS company_logo,
                  c.owner_name AS company_owner_name
             FROM users u
        LEFT JOIN companies c ON c.id = u.company_id AND c.is_active = TRUE
            WHERE LOWER(u.username) = LOWER(%s) AND u.password_hash = %s""",
        (username, _sha256(password)),
        one=True,
    )
    if not row:
        return jsonify({"error": "Invalid username or password"}), 401

    # Stamp the login so the admin dashboard can tell who's still active and
    # how long a company has been away. Best-effort — never block sign-in.
    try:
        execute("UPDATE users SET last_login = NOW() WHERE id = %s", (row["id"],))
    except Exception:
        pass

    # Record the login in the audit trail so the admin dashboard's activity
    # stream shows sign-ins alongside every other action. We insert directly
    # (rather than via _log_activity) because the login request carries no
    # X-Auth-User header yet, so _current_user() can't resolve the actor here.
    try:
        if row.get("company_id"):
            execute(
                """INSERT INTO activity_log
                     (company_id, user_id, username, action, entity, detail)
                   VALUES (%s,%s,%s,'login','auth',NULL)""",
                (int(row["company_id"]), row["id"], row["username"]),
            )
    except Exception:
        pass

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
            "owner_name":   row["company_owner_name"],
        }
    return jsonify(_clean({
        "id":         row["id"],
        "username":   row["username"],
        "role":       row["role"],
        "company_id": row["company_id"],
        "must_reset_password": bool(row.get("must_reset_password")),
        "company":    company,
    }))


@app.post("/api/logout")
def logout():
    """Record a sign-out in the audit trail. The app is stateless (no server
    session to destroy), so this endpoint exists purely so the admin dashboard
    can show logouts next to logins. Best-effort and always returns ok."""
    try:
        u = _current_user()
        if u and u.get("company_id"):
            _log_activity(u["company_id"], "logout", "auth", None)
    except Exception:
        pass
    return jsonify({"ok": True})


# ----------------------- API KEYS (external integrations) --------------
def _api_key_target_user():
    """Resolve which user row an API-key request acts on. A company user
    manages its own key; an admin may manage a company's key by passing
    ``company_id`` in the JSON body. Returns (user_id, error_response)."""
    u = _current_user()
    if not u:
        return None, (jsonify({"error": "Not authenticated"}), 401)
    if u.get("role") == "company" and u.get("company_id"):
        return u["id"], None
    if u.get("role") == "admin":
        data = request.get_json(silent=True) or {}
        company_id = data.get("company_id") or request.args.get("company_id")
        if not company_id:
            return None, (jsonify({"error": "company_id required"}), 400)
        target = query(
            "SELECT id FROM users WHERE company_id = %s AND role = 'company' "
            "ORDER BY id LIMIT 1",
            (int(company_id),), one=True,
        )
        if not target:
            return None, (jsonify({"error": "No company user for that company_id"}), 404)
        return target["id"], None
    return None, (jsonify({"error": "Not authorized"}), 403)


def _company_has_data(company_id) -> bool:
    """True if the company has actually put something into the system — at
    least one car, linked client, or branch. We gate the external API on this:
    a brand-new company with nothing added can neither generate a key nor pull
    reports (there would be nothing to report on, and it stops empty shells
    from probing the API)."""
    if not company_id:
        return False
    row = query(
        """SELECT
             EXISTS(SELECT 1 FROM cars            WHERE company_id = %s) AS has_cars,
             EXISTS(SELECT 1 FROM client_companies WHERE company_id = %s) AS has_clients,
             EXISTS(SELECT 1 FROM branches        WHERE company_id = %s) AS has_branches""",
        (company_id, company_id, company_id), one=True,
    )
    return bool(row and (row["has_cars"] or row["has_clients"] or row["has_branches"]))


@app.get("/api/api-key")
def api_key_info():
    """Report whether an API key is set (prefix + created_at only — never the
    secret). Lets the dashboard show "key active: crk_AbC12… since <date>"."""
    user_id, err = _api_key_target_user()
    if err:
        return err
    row = query(
        "SELECT api_key_prefix, api_key_created_at FROM users WHERE id = %s",
        (user_id,), one=True,
    )
    if not row or not row.get("api_key_prefix"):
        return jsonify({"has_key": False})
    return jsonify(_clean({
        "has_key":    True,
        "prefix":     row["api_key_prefix"],
        "created_at": row["api_key_created_at"],
    }))


@app.post("/api/api-key")
def api_key_generate():
    """Generate (or rotate) the API key for a company. The raw key is returned
    ONCE in this response and never again — only its hash is stored, and any
    previous key stops working immediately. Company users rotate their own;
    admins may rotate a company's by passing ``company_id``."""
    user_id, err = _api_key_target_user()
    if err:
        return err
    # Gate: no key until the company has actually added data. A company user
    # generating its own key is blocked here; an admin generating on a
    # company's behalf is checked against that company's data too.
    u = _current_user() or {}
    target_company = u.get("company_id")
    if u.get("role") == "admin":
        data = request.get_json(silent=True) or {}
        target_company = data.get("company_id") or request.args.get("company_id")
    if not _company_has_data(target_company):
        return jsonify({
            "error": "Add at least one car, client, or branch before generating "
                     "an API key — there's nothing to integrate with yet.",
        }), 403
    raw    = API_KEY_PREFIX + secrets.token_urlsafe(32)
    prefix = raw[:12]
    execute(
        """UPDATE users
              SET api_key_hash = %s, api_key_prefix = %s, api_key_created_at = NOW()
            WHERE id = %s""",
        (_sha256(raw), prefix, user_id),
    )
    return jsonify({
        "api_key": raw,
        "prefix":  prefix,
        "note":    "Store this now — it is shown only once. "
                   "Send it as 'Authorization: Bearer <key>' on batch requests.",
    }), 201


@app.delete("/api/api-key")
def api_key_revoke():
    """Revoke the API key (clears the hash) so no key authenticates until a
    new one is generated."""
    user_id, err = _api_key_target_user()
    if err:
        return err
    execute(
        """UPDATE users
              SET api_key_hash = NULL, api_key_prefix = NULL, api_key_created_at = NULL
            WHERE id = %s""",
        (user_id,),
    )
    return ("", 204)


# Admin-only: create a company AND its login user in one step.
# The admin only supplies companyname + password; the rest of the company
# row is filled with safe placeholders the company can edit later.1
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

    from db import get_conn
    from psycopg2.extras import RealDictCursor
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """INSERT INTO companies
                     (companyname, location, companyid, x, y, phonenumber, logo, owner_name)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                   RETURNING *""",
                (
                    data["companyname"], location, companyid,
                    _none_if_blank(data.get("x")), _none_if_blank(data.get("y")),
                    _none_if_blank(data.get("phonenumber")),
                    _none_if_blank(data.get("logo")),
                    _none_if_blank(data.get("owner_name")),
                ),
            )
            company = cur.fetchone()
            cur.execute(
                """INSERT INTO users (username, password_hash, role, company_id, must_reset_password)
                   VALUES (%s, %s, 'company', %s, TRUE) RETURNING id, username, role""",
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
    old = query(
        "SELECT companyname, location, phonenumber, owner_name FROM companies "
        "WHERE id = %s AND is_active = TRUE", (company_id,), one=True) or {}
    row = execute(
        """UPDATE companies
              SET companyname = %s,
                  location    = %s,
                  companyid   = COALESCE(NULLIF(%s, ''), companyid),
                  phonenumber = %s,
                  x = %s, y = %s,
                  logo = COALESCE(%s, logo),
                  owner_name  = %s
            WHERE id = %s AND is_active = TRUE
        RETURNING *""",
        (
            data["companyname"],
            (data.get("location") or ""),    # NOT NULL → empty string is OK
            data.get("companyid"),           # NULL/'' → keep existing
            _none_if_blank(data.get("phonenumber")),
            _none_if_blank(data.get("x")), _none_if_blank(data.get("y")),
            _none_if_blank(data.get("logo")),
            _none_if_blank(data.get("owner_name")),
            company_id,
        ),
        returning=True,
    )
    if not row:
        return jsonify({"error": "Not found"}), 404
    # Head office: ticking "this is my head office" makes the company's MAIN
    # office (its earliest branch) the head office. If the company has no branch
    # yet, this first info is created as its head-office branch — so the very
    # first entry the company makes also becomes a branch.
    if data.get("is_head_office"):
        _sync_main_head_office(
            company_id, row.get("location"), row.get("phonenumber"),
            row.get("x"), row.get("y"))
    # Audit: which company-info fields changed (name, location, phone, owner).
    diff = _diff_fields(old, row, [
        ("name", "companyname"), ("location", "location"),
        ("phone", "phonenumber"), ("owner", "owner_name"),
    ])
    _log_activity(company_id, "update", "company",
                  f'{row.get("companyname") or ""}' + (f' — {diff}' if diff else ''))
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
    # Data isolation: a company user only ever sees their own cars,
    # whatever company_id is passed. Admin may filter by company_id or
    # list the whole fleet. Unauthenticated callers see nothing.
    u = _current_user()
    if not u:
        return jsonify({"error": "Not authenticated"}), 401
    if u.get("role") == "company" and u.get("company_id"):
        # ?available=1 → only cars free to book. With from/to it's date-aware:
        # exclude cars whose pending reservation or un-returned rental OVERLAPS
        # [from, to]. Overlap is strict (start < to AND end > from) so a booking
        # may start the exact day another ends — same-day handoff. Without dates
        # it falls back to "free right now" (any open booking excludes the car).
        params = [u["company_id"]]
        avail_sql = ""
        if request.args.get("available"):
            frm = request.args.get("from")
            to = request.args.get("to")
            # A car is taken while a booking is live — active or pending, not
            # yet returned. Cancelled bookings release it. (Pre-040 this also
            # probed `reservations`; those are pending rentals now.)
            if frm and to:
                avail_sql = """
              AND NOT EXISTS (SELECT 1 FROM rentals r
                               WHERE r.car_vin = c.vin AND r.returned_at IS NULL
                                 AND r.status IN ('active', 'pending')
                                 AND r.start_date < %s AND r.end_date > %s)"""
                params += [to, frm]
            else:
                avail_sql = """
              AND NOT EXISTS (SELECT 1 FROM rentals r
                               WHERE r.car_vin = c.vin AND r.returned_at IS NULL
                                 AND r.status IN ('active', 'pending'))"""
        rows = query(
            """SELECT c.*, co.companyname, br.branchname
                 FROM cars c JOIN companies co ON co.id = c.company_id
                 LEFT JOIN branches br ON br.id = c.branch_id
                WHERE c.company_id = %s AND c.is_active = TRUE AND co.is_active = TRUE"""
            + avail_sql +
            "\n                ORDER BY c.model",
            tuple(params),
        )
        return jsonify(_clean(rows))
    if u.get("role") != "admin":
        return jsonify({"error": "Not authorized"}), 403

    company_id = request.args.get("company_id")

    # Server-side paginated fleet view. Triggered only when ?page= is present so
    # existing callers (reservation forms, GPS map, etc.) that expect the full
    # array keep working. This is what scales the admin cars table to very large
    # fleets — the browser never downloads the whole table, only one page.
    if request.args.get("page") is not None:
        try:
            page = max(1, int(request.args.get("page", 1)))
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = int(request.args.get("page_size", 25))
        except (TypeError, ValueError):
            page_size = 25
        page_size = max(1, min(page_size, 100))

        where = ["c.is_active = TRUE", "co.is_active = TRUE"]
        params = []
        if company_id:
            where.append("c.company_id = %s")
            params.append(company_id)
        vin = (request.args.get("vin") or "").strip()
        if vin:
            where.append("c.vin = %s")
            params.append(vin)
        search = (request.args.get("search") or "").strip()
        if search:
            where.append(
                "(c.vin ILIKE %s OR c.model ILIKE %s OR c.type ILIKE %s "
                "OR c.platenumber ILIKE %s OR co.companyname ILIKE %s "
                "OR br.branchname ILIKE %s)"
            )
            like = f"%{search}%"
            params += [like, like, like, like, like, like]
        gps = request.args.get("gps")
        if gps in ("1", "true", "yes"):
            where.append("c.has_gps = TRUE")
        elif gps in ("0", "false", "no"):
            where.append("c.has_gps = FALSE")
        where_sql = " AND ".join(where)

        total = query(
            "SELECT COUNT(*) AS n FROM cars c "
            "JOIN companies co ON co.id = c.company_id "
            "LEFT JOIN branches br ON br.id = c.branch_id "
            f"WHERE {where_sql}",
            tuple(params),
            one=True,
        )["n"]
        offset = (page - 1) * page_size
        rows = query(
            f"""SELECT c.*, co.companyname, br.branchname
                  FROM cars c JOIN companies co ON co.id = c.company_id
                  LEFT JOIN branches br ON br.id = c.branch_id
                 WHERE {where_sql}
                 ORDER BY co.companyname, br.branchname NULLS FIRST, c.model, c.id
                 LIMIT %s OFFSET %s""",
            tuple(params + [page_size, offset]),
        )
        return jsonify({
            "rows": _clean(rows),
            "total": int(total),
            "page": page,
            "page_size": page_size,
        })

    # Optional has_gps filter for the whole-fleet views (e.g. the Car GPS map,
    # which only ever wants GPS-equipped cars). Keeps the payload small instead
    # of shipping every car and filtering in the browser.
    gps = request.args.get("gps")
    gps_sql = ""
    if gps in ("1", "true", "yes"):
        gps_sql = " AND c.has_gps = TRUE"
    elif gps in ("0", "false", "no"):
        gps_sql = " AND c.has_gps = FALSE"

    if company_id:
        # branch_id lets the grouped fleet tree drill into ONE branch at a time
        # (never downloading a whole 100+ car company at once). "" / none / 0
        # means the "Head office" bucket — cars with no branch assigned.
        branch_id = request.args.get("branch_id")
        branch_sql = ""
        bparams = [company_id]
        if branch_id is not None:
            if branch_id in ("", "none", "null", "0"):
                branch_sql = " AND c.branch_id IS NULL"
            else:
                branch_sql = " AND c.branch_id = %s"
                bparams.append(branch_id)
        # Same search predicate as the paged list + summary, so a drill-down's
        # rows always match the counts shown on the collapsed tree.
        search = (request.args.get("search") or "").strip()
        search_sql = ""
        if search:
            search_sql = (
                " AND (c.vin ILIKE %s OR c.model ILIKE %s OR c.type ILIKE %s "
                "OR c.platenumber ILIKE %s OR co.companyname ILIKE %s "
                "OR br.branchname ILIKE %s)"
            )
            like = f"%{search}%"
            bparams += [like, like, like, like, like, like]
        # Same exact-match dropdown filters as the summary, so a drilled-in
        # branch's rows always match the counts on the collapsed tree.
        ctype = (request.args.get("type") or "").strip()
        if ctype:
            search_sql += " AND c.type = %s"
            bparams.append(ctype)
        cmodel = (request.args.get("model") or "").strip()
        if cmodel:
            search_sql += " AND c.model = %s"
            bparams.append(cmodel)
        rows = query(
            f"""SELECT c.*, co.companyname, br.branchname
                 FROM cars c JOIN companies co ON co.id = c.company_id
                 LEFT JOIN branches br ON br.id = c.branch_id
                WHERE c.company_id = %s AND c.is_active = TRUE AND co.is_active = TRUE{gps_sql}{branch_sql}{search_sql}
                ORDER BY c.model""",
            tuple(bparams),
        )
    else:
        rows = query(
            f"""SELECT c.*, co.companyname
                 FROM cars c JOIN companies co ON co.id = c.company_id
                WHERE c.is_active = TRUE AND co.is_active = TRUE{gps_sql}
                ORDER BY co.companyname, c.model"""
        )
    return jsonify(_clean(rows))


@app.get("/api/cars/summary")
def cars_summary():
    """Admin-only aggregate powering the grouped fleet tree.

    Returns, per company, the total car count plus a per-branch breakdown (and
    an "unassigned"/Head-office bucket) — WITHOUT shipping a single car row. The
    tree renders every company/branch count from this, then lazily fetches the
    actual cars of just ONE branch when it's expanded. Honors the same search +
    gps filters as the paged fleet list so the counts always match a drill-down.
    """
    u = _current_user()
    if not u or u.get("role") != "admin":
        return jsonify({"error": "Not authorized"}), 403

    where = ["c.is_active = TRUE", "co.is_active = TRUE"]
    params = []
    search = (request.args.get("search") or "").strip()
    if search:
        where.append(
            "(c.vin ILIKE %s OR c.model ILIKE %s OR c.type ILIKE %s "
            "OR c.platenumber ILIKE %s OR co.companyname ILIKE %s "
            "OR br.branchname ILIKE %s)"
        )
        like = f"%{search}%"
        params += [like, like, like, like, like, like]
    # Exact-match dropdown filters (admin fleet toolbar). Applied to both the
    # summary counts here AND each branch drill-down (see list_cars) so the two
    # never disagree.
    ctype = (request.args.get("type") or "").strip()
    if ctype:
        where.append("c.type = %s")
        params.append(ctype)
    cmodel = (request.args.get("model") or "").strip()
    if cmodel:
        where.append("c.model = %s")
        params.append(cmodel)
    ccompany = (request.args.get("company_id") or "").strip()
    if ccompany.isdigit():
        where.append("c.company_id = %s")
        params.append(int(ccompany))
    gps = request.args.get("gps")
    if gps in ("1", "true", "yes"):
        where.append("c.has_gps = TRUE")
    elif gps in ("0", "false", "no"):
        where.append("c.has_gps = FALSE")
    where_sql = " AND ".join(where)

    rows = query(
        f"""SELECT c.company_id, c.branch_id, COUNT(*) AS n
              FROM cars c JOIN companies co ON co.id = c.company_id
              LEFT JOIN branches br ON br.id = c.branch_id
             WHERE {where_sql}
             GROUP BY c.company_id, c.branch_id""",
        tuple(params),
    )
    companies = {}
    for r in rows:
        cid = str(int(r["company_id"]))
        entry = companies.setdefault(cid, {"total": 0, "unassigned": 0, "branches": {}})
        n = int(r["n"])
        entry["total"] += n
        if r["branch_id"] is None:
            entry["unassigned"] += n
        else:
            entry["branches"][str(int(r["branch_id"]))] = n
    return jsonify({"companies": companies})


@app.put("/api/cars/<int:car_id>")
def update_car(car_id):
    data = request.get_json(force=True)
    miss = _required(data, "type", "model", "color", "company_id")
    if miss:
        return jsonify({"error": f"Missing: {miss}"}), 400

    # Only the car's owning company (or admin) may edit it. The VIN is never
    # touched here — it's the car's identity; edits are limited to the
    # descriptive fields (the plate is a company-pool concern now, not per-car).
    car = query(
        """SELECT vin, company_id, edit_count, type, model, color, platenumber,
                  has_gps, branch_id
             FROM cars WHERE id = %s AND is_active = TRUE""",
        (car_id,), one=True)
    if not car:
        return jsonify({"error": "Not found"}), 404
    if not _can_edit_company(int(car["company_id"])):
        return jsonify({"error": "Not authorized"}), 403

    # The in-app form sends no plate, so the car keeps whatever platenumber it
    # already had (NULL for in-app cars, a value for API/seed cars). Only the
    # external API can change it by sending `platenumber`; validate uniqueness.
    plate_val = car.get("platenumber")
    if "platenumber" in data:
        np = (data.get("platenumber") or "").strip() or None
        if np and np != car.get("platenumber"):
            clash = query("SELECT 1 FROM cars WHERE platenumber = %s AND id <> %s",
                          (np, car_id), one=True)
            if clash:
                return jsonify({"error": "Validation failed",
                                "errors": {"plate_number": f"Plate '{np}' is already registered"}}), 409
        plate_val = np

    # Company car edits are unlimited — accountability comes from the audit log
    # (every change is recorded below and visible to the admin), not a hard cap.
    # edit_count is still bumped so the admin can see how often a car is touched.
    u = _current_user()
    is_company = bool(u and u.get("role") == "company")

    # Branch is validated against the (possibly changed) company_id, so moving a
    # car to a company it doesn't belong to can't smuggle in a foreign branch —
    # a mismatch just resolves to NULL (Main).
    branch_id = _resolve_branch_id(data.get("branch_id"), int(data["company_id"]))
    try:
        row = execute(
            """UPDATE cars
                  SET type = %s, model = %s, color = %s, platenumber = %s,
                      has_gps = %s, company_id = %s, branch_id = %s,
                      edit_count = edit_count + %s
                WHERE id = %s AND is_active = TRUE
            RETURNING *""",
            (
                data["type"], data["model"], data["color"], plate_val,
                bool(data.get("has_gps", False)), data["company_id"], branch_id,
                1 if is_company else 0, car_id,
            ),
            returning=True,
        )
    except Exception as e:
        msg = str(e).lower()
        if "plate" in msg:
            return jsonify({"error": "Validation failed",
                            "errors": {"plate_number": f"Plate '{plate_val}' is already registered"}}), 409
        return jsonify({"error": "Could not update car"}), 409
    if not row:
        return jsonify({"error": "Not found"}), 404
    if plate_val:
        _ensure_company_plate(int(row["company_id"]), plate_val)
    # Audit: record exactly which fields changed (plate, branch, colour, …).
    diff = _diff_fields(
        {**car, "branch_id": _branch_label(car.get("branch_id"))},
        {**row, "branch_id": _branch_label(row.get("branch_id"))},
        [("type", "type"), ("model", "model"), ("color", "color"),
         ("plate", "platenumber"), ("gps", "has_gps"), ("branch", "branch_id")],
    )
    _log_activity(int(row["company_id"]), "update", "car",
                  " · ".join(x for x in (row.get("model"), row.get("platenumber"),
                                         row.get("color")) if x)
                  + (f' — {diff}' if diff else ''),
                  ref=(f'car:{row.get("vin")}' if row.get("vin") else None))
    return jsonify(_clean(row))


@app.post("/api/cars/<vin>/gps")
def ingest_car_gps(vin):
    """Ingest a live GPS fix for a car — what an in-car tracker (or a
    company's telematics integration) POSTs as the car moves. Body:
    {"lat": <number>, "lng": <number>}. Admin may update any car; a
    company user only its own. Stores the fix + a fresh timestamp so the
    fleet map can plot where a rented car actually is."""
    u = _current_user()
    if not u:
        return jsonify({"error": "Not authenticated"}), 401

    car = query(
        "SELECT vin, company_id FROM cars WHERE vin = %s AND is_active = TRUE",
        (vin,), one=True,
    )
    if not car:
        return jsonify({"error": "Car not found"}), 404
    if u.get("role") == "company" and u.get("company_id") != car["company_id"]:
        return jsonify({"error": "Not authorized"}), 403

    data = request.get_json(silent=True) or {}
    try:
        lat = float(data["lat"])
        lng = float(data["lng"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "lat and lng are required numbers"}), 400
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
        return jsonify({"error": "lat/lng out of range"}), 400

    row = execute(
        """UPDATE cars
              SET gps_lat = %s, gps_lng = %s, gps_updated_at = NOW()
            WHERE vin = %s AND is_active = TRUE
        RETURNING vin, gps_lat, gps_lng, gps_updated_at""",
        (lat, lng, vin),
        returning=True,
    )
    return jsonify(_clean(row))


@app.delete("/api/cars/<int:car_id>")
def soft_delete_car(car_id):
    row = execute(
        "UPDATE cars SET is_active = FALSE WHERE id = %s AND is_active = TRUE "
        "RETURNING company_id, model, platenumber",
        (car_id,),
        returning=True,
    )
    if not row:
        return jsonify({"error": "Not found"}), 404
    _log_activity(int(row["company_id"]), "delete", "car",
                  f'{row["model"]} · {row["platenumber"]}')
    return ("", 204)


def _validate_car_inputs(vin, type_, model, color, icon, plate, company_id,
                         existing_vin_id=None, enforce_check_digit=True,
                         check_db_uniqueness=True, require_plate=True):
    """Run the full validation gauntlet on a single car. Returns
    {ok: bool, errors: dict[field -> message]} so the frontend can show
    each error next to its field.

    enforce_check_digit: when False, the VIN still has to be structurally
    valid (17 chars, legal VIN characters) but a wrong North-American
    check digit is tolerated. The single Add-Car form sets this False
    because the user deliberately edits the last 6 chars to match their
    real car, which legitimately changes what the check digit would be.

    check_db_uniqueness: when False, the two per-row DB lookups (VIN and plate
    already registered?) are skipped. The batch path sets this False and does
    those checks in bulk instead — one query for the whole batch rather than
    two per car — which is dramatically faster for large imports."""
    errs = {}

    # Field presence
    if not vin:    errs["vin"]          = "VIN is required"
    if not type_:  errs["type"]         = "Type is required"
    if not model:  errs["model"]        = "Model is required"
    if not color:  errs["color"]        = "Color is required"
    if require_plate and not icon:   errs["plate_icon"]   = "Plate icon is required"
    if require_plate and not plate:  errs["plate_number"] = "Plate number is required"

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

    # vininfo offline structural + (optional) check digit
    if vin and "vin" not in errs:
        ok, msg = _validate_vin_offline(vin, enforce_check_digit=enforce_check_digit)
        if not ok:
            errs["vin"] = msg

    # Combined plate-number uniqueness against the DB
    platenumber = f"{icon} {plate}".strip() if (icon and plate) else None
    if (check_db_uniqueness and platenumber
            and "plate_icon" not in errs and "plate_number" not in errs):
        existing = query("SELECT id FROM cars WHERE platenumber = %s",
                         (platenumber,), one=True)
        if existing:
            errs["plate_number"] = f"Plate '{platenumber}' is already registered"

    # The VIN must not be the same as the plate (icon + plate number). Compare
    # case-insensitively and ignore spacing so "B 12345" / "B12345" both match.
    if vin and platenumber and "vin" not in errs:
        norm = lambda s: (s or "").upper().replace(" ", "")
        if norm(vin) == norm(platenumber):
            errs["vin"] = "VIN must not be the same as the plate number"

    # VIN uniqueness against the DB (skip for the same-row update case).
    # When another company already registered this VIN, say so explicitly so
    # the company user knows it's claimed elsewhere, not just a typo.
    if check_db_uniqueness and vin and "vin" not in errs:
        existing = query("SELECT id, company_id FROM cars WHERE vin = %s",
                         (vin,), one=True)
        if existing and (existing_vin_id is None or existing["id"] != existing_vin_id):
            if company_id and existing.get("company_id") != int(company_id):
                errs["vin"] = "this vin car already use by another rental companies"
            else:
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
    # In-app the car carries no plate (plates are a company pool now). A
    # platenumber is OPTIONAL and only the external batch API / seeds send one;
    # when present it's validated as before AND added to the company's pool.
    miss = _required(data, "vin", "type", "model", "company_id")
    if miss:
        return jsonify({"error": f"Missing: {miss}"}), 400
    if not _can_edit_company(int(data["company_id"])):
        return jsonify({"error": "Not authorized"}), 403

    raw_plate = (data.get("platenumber") or "").strip()
    has_plate = bool(raw_plate)
    p_icon, p_num = _split_plate(raw_plate) if has_plate else ("", "")

    vin = data["vin"].strip().upper()
    result = _validate_car_inputs(
        vin=vin,
        type_=data["type"].strip(),
        model=data["model"].strip(),
        color=(data.get("color") or "").strip(),
        icon=p_icon,
        plate=p_num,
        company_id=int(data["company_id"]),
        # The user may edit the last 6 chars of a catalog VIN to match their
        # actual car, which changes the check digit — accept that, but still
        # require a structurally valid VIN and reject duplicates below.
        enforce_check_digit=False,
        require_plate=has_plate,
    )
    if not result["ok"]:
        return jsonify({"error": "Validation failed", "errors": result["errors"]}), 400

    branch_id = _resolve_branch_id(data.get("branch_id"), int(data["company_id"]))
    try:
        row = execute(
            """INSERT INTO cars
                 (vin, type, model, color, platenumber, has_gps, company_id, branch_id)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
            (
                vin, data["type"].strip(), data["model"].strip(),
                result["color"],
                result["platenumber"],   # None when no plate was supplied
                bool(data.get("has_gps", False)),
                int(data["company_id"]),
                branch_id,
            ),
            returning=True,
        )
    except Exception as e:
        # Belt-and-suspenders: the UNIQUE(vin)/UNIQUE(platenumber) constraints
        # catch any duplicate that slipped past the checks above (e.g. a race
        # between two concurrent adds) — return a clean 409, not a 500.
        msg = str(e).lower()
        if "platenumber" in msg or "plate" in msg:
            return jsonify({"error": "Validation failed",
                            "errors": {"plate_number": f"Plate '{result['platenumber']}' is already registered"}}), 409
        if "vin" in msg:
            return jsonify({"error": "Validation failed",
                            "errors": {"vin": f"VIN '{vin}' is already registered"}}), 409
        return jsonify({"error": "Could not save car"}), 409

    # A pushed plate also joins the company's pool so it's pickable at rental.
    if has_plate and result["platenumber"]:
        _ensure_company_plate(int(data["company_id"]), result["platenumber"])

    _log_activity(int(data["company_id"]), "create", "car",
                  " · ".join(x for x in (row.get("model"), row.get("platenumber"),
                                         row.get("color")) if x),
                  ref=(f'car:{row.get("vin")}' if row.get("vin") else None))
    return jsonify(_clean(row)), 201


# ----------------------- Company plate pool endpoints -----------------
# The company manages all of its plate numbers here, independent of cars. A
# rental / B2B record then picks WHICH pool plate the car is on.

@app.get("/api/plates")
def list_company_plates():
    u, err = _require_company_user()
    if err:
        return err
    rows = query(
        "SELECT id, platenumber, created_at FROM company_plates "
        "WHERE company_id = %s ORDER BY platenumber",
        (u["company_id"],),
    )
    out = []
    for r in rows:
        icon, num = _split_plate(r["platenumber"])
        out.append({"id": r["id"], "plate": r["platenumber"],
                    "icon": icon, "number": num, "created_at": r["created_at"]})
    return jsonify(_clean(out))


@app.post("/api/plates")
def add_company_plate():
    u, err = _require_company_user()
    if err:
        return err
    data = request.get_json(force=True) or {}
    combined, icon, num = _normalize_plate_input(data)
    if not combined:
        return jsonify({"error": "Plate is required",
                        "errors": {"plate_number": "Plate is required"}}), 400
    ok, msg = _validate_lebanese_plate(icon, num)
    if not ok:
        field = "plate_icon" if "icon" in msg.lower() else "plate_number"
        return jsonify({"error": msg, "errors": {field: msg}}), 400
    existing = query("SELECT company_id FROM company_plates WHERE platenumber = %s",
                     (combined,), one=True)
    if existing:
        m = ("You already added this plate."
             if int(existing["company_id"]) == int(u["company_id"])
             else f"Plate '{combined}' is already registered.")
        return jsonify({"error": m, "errors": {"plate_number": m}}), 409
    try:
        row = execute(
            "INSERT INTO company_plates (company_id, platenumber) "
            "VALUES (%s,%s) RETURNING id, platenumber",
            (u["company_id"], combined), returning=True,
        )
    except Exception:
        m = f"Plate '{combined}' is already registered."
        return jsonify({"error": m, "errors": {"plate_number": m}}), 409
    _log_activity(u["company_id"], "create", "plate", combined)
    return jsonify({"id": row["id"], "plate": row["platenumber"],
                    "icon": icon, "number": num}), 201


@app.delete("/api/plates/<int:plate_id>")
def delete_company_plate(plate_id):
    u, err = _require_company_user()
    if err:
        return err
    rec = query("SELECT company_id, platenumber FROM company_plates WHERE id = %s",
                (plate_id,), one=True)
    if not rec:
        return jsonify({"error": "Not found"}), 404
    if int(rec["company_id"]) != int(u["company_id"]):
        return jsonify({"error": "Not authorized"}), 403
    execute("DELETE FROM company_plates WHERE id = %s", (plate_id,))
    _log_activity(u["company_id"], "delete", "plate", rec["platenumber"])
    return ("", 204)


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


@app.get("/api/check-vin")
def check_vin():
    """Look up a VIN across every active car so the Add-Car form can warn,
    before save, that the VIN is already registered (and by which company).
    Returns the car row, or 204 No Content when the VIN is free."""
    vin = (request.args.get("vin") or "").strip().upper()
    if not vin:
        return ("", 204)
    row = query(
        "SELECT id, vin, company_id, model, type, color, platenumber, has_gps "
        "FROM cars WHERE vin = %s AND is_active = TRUE",
        (vin,), one=True,
    )
    if not row:
        return ("", 204)
    return jsonify(_clean(row))


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


# ----------------------- Company plate pool ---------------------------
# A company owns a POOL of plate numbers (company_plates), independent of its
# cars. Each plate is combined "<code> <number>" (e.g. "M 123456") and globally
# UNIQUE. A booking (rental / B2B record) records WHICH pool plate the car is on
# via its own `plate` column; a car itself no longer carries a plate in-app
# (cars.platenumber is nullable and only the external API / seeds still set it).

def _split_plate(combined):
    """'M 123456' -> ('M', '123456'). Tolerates a missing space (icon '')."""
    raw = (combined or "").strip()
    parts = raw.split(maxsplit=1)
    if len(parts) == 2:
        return parts[0], parts[1]
    return "", raw


def _normalize_plate_input(p):
    """Accept a plate as a dict ({icon|code|plate_icon, number|plate|
    plate_number}) or a combined string. Returns (combined, icon, number);
    combined is None when nothing was supplied. Icon is upper-cased."""
    if isinstance(p, dict):
        icon = (p.get("icon") or p.get("code") or p.get("plate_icon") or "")
        num = (p.get("number") or p.get("plate") or p.get("plate_number") or "")
    else:
        icon, num = _split_plate(p)
    icon = str(icon).strip().upper()
    num = str(num).strip()
    if not icon and not num:
        return None, "", ""
    return f"{icon} {num}".strip(), icon, num


def _company_plate_set(company_id):
    """The set of plate strings in a company's pool (for validating a booking's
    chosen plate)."""
    rows = query(
        "SELECT platenumber FROM company_plates WHERE company_id = %s",
        (company_id,),
    )
    return {r["platenumber"] for r in rows}


def _ensure_company_plate(company_id, combined):
    """Add a plate to a company's pool if it isn't there yet (best-effort — the
    external car-batch/create path calls this so a pushed platenumber also lands
    in the pool). Silently ignores a plate already registered anywhere."""
    if not combined:
        return
    try:
        execute(
            "INSERT INTO company_plates (company_id, platenumber) "
            "VALUES (%s, %s) ON CONFLICT (platenumber) DO NOTHING",
            (company_id, combined),
        )
    except Exception:
        pass


def _resolve_booking_plate(company_id, plate):
    """Resolve the plate a booking is for. A supplied plate must be one in the
    company's pool; blank/omitted stays NULL (the report falls back to the car's
    own platenumber via COALESCE). Returns (plate_or_None, error_message)."""
    plate = (plate or "").strip()
    if not plate:
        return None, None
    if plate not in _company_plate_set(company_id):
        return None, f"Plate '{plate}' is not in your plates. Add it under Plates first."
    return plate, None


# A VIN never contains the letters I, O, or Q (to avoid 1/0 confusion).
_VIN_CHAR_RE = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$", re.IGNORECASE)


def _validate_vin_offline(vin: str, enforce_check_digit: bool = True):
    """Offline VIN structural + check-digit validation via vininfo.
    Returns (ok: bool, error_message: str). North American VINs have a
    real check digit (9th char); other regions return None and we accept
    them. Catches typos cheaply before any network round-trip.

    When enforce_check_digit is False we still require a structurally
    valid VIN (17 legal characters) but allow a non-matching check digit,
    so a user can hand-edit the last 6 chars to match their real car."""
    # Structural: exactly 17 chars from the legal VIN alphabet (no I/O/Q).
    if not _VIN_CHAR_RE.match(vin or ""):
        return False, (f"VIN '{vin}' is not valid: must be 17 letters/digits "
                       f"(letters I, O, Q are not allowed)")
    try:
        v = _VinInfo(vin)
    except Exception as e:
        return False, f"Invalid VIN '{vin}': {e}"
    if enforce_check_digit:
        try:
            cs = v.verify_checksum()
        except Exception:
            cs = None
        if cs is False:
            return False, f"VIN '{vin}' has an invalid check digit (typo?)"
    return True, ""


# How long to wait on NHTSA per VIN. Kept short: the cross-check soft-fails when
# NHTSA is slow/empty anyway, so a long timeout only lets a degraded NHTSA drag
# down throughput. Override via env.
NHTSA_TIMEOUT = int(os.getenv("NHTSA_TIMEOUT", "4"))

# Master switch for the NHTSA model/body cross-check. ON by default (keeps the
# strict "VIN must match the model you typed" behaviour). Set NHTSA_CROSS_CHECK=0
# to skip the external call entirely — useful when NHTSA is unreachable, or when
# load-testing the platform itself without depending on a third-party API. The
# offline VIN structure + check-digit validation always runs regardless.
NHTSA_CROSS_CHECK = os.getenv("NHTSA_CROSS_CHECK", "1").strip().lower() not in (
    "0", "false", "no", "off",
)


def _decode_vin_nhtsa_network(vin: str):
    """Hit NHTSA's free VIN decoder. Returns (model, body_class) — either
    field may be None if the API didn't fill it. Returns (None, None) on
    network or parse errors so a transient outage doesn't block uploads."""
    try:
        r = requests.get(NHTSA_DECODE_URL.format(vin=vin), timeout=NHTSA_TIMEOUT)
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


# A VIN's NHTSA decode never changes, so caching it makes repeat batches (and
# retries of a rejected batch) skip the network entirely — the single biggest
# speed-up for bulk imports. Thread-safe and bounded. A positive decode is
# cached for a long TTL; an empty/failed answer for a short one, so a transient
# NHTSA outage can't poison the cache for a day. Keyed by VIN (already
# upper-cased before validation).
NHTSA_CACHE_TTL     = int(os.getenv("NHTSA_CACHE_TTL", "86400"))   # 24h for a real hit
NHTSA_CACHE_NEG_TTL = int(os.getenv("NHTSA_CACHE_NEG_TTL", "300"))  # 5m for empty/down
NHTSA_CACHE_MAX     = int(os.getenv("NHTSA_CACHE_MAX", "50000"))
_nhtsa_cache = {}                       # vin -> (expires_monotonic, (model, body))
_nhtsa_cache_lock = threading.Lock()


def _decode_vin_nhtsa(vin: str):
    """Cached front for `_decode_vin_nhtsa_network`. Identical return contract;
    just answers instantly for a VIN seen recently. Returns (None, None) with no
    network call when the cross-check is switched off."""
    if not NHTSA_CROSS_CHECK:
        return (None, None)
    now = time.monotonic()
    with _nhtsa_cache_lock:
        hit = _nhtsa_cache.get(vin)
        if hit and hit[0] > now:
            return hit[1]
    result = _decode_vin_nhtsa_network(vin)
    ttl = NHTSA_CACHE_TTL if (result[0] or result[1]) else NHTSA_CACHE_NEG_TTL
    with _nhtsa_cache_lock:
        # Crude bound: if the cache is full, drop it wholesale. It's a cache —
        # a rare full reset just means the next lookups re-fetch.
        if len(_nhtsa_cache) >= NHTSA_CACHE_MAX:
            _nhtsa_cache.clear()
        _nhtsa_cache[vin] = (now + ttl, result)
    return result


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


# ----------------------- BATCH building blocks ------------------------
# Each entity has a `_prepare_*` (pure validation → param tuples + per-row
# errors, no writes) and an `_insert_*` (runs the writes on an already-open
# cursor). The per-entity batch endpoints AND the unified /api/batch endpoint
# share these, so a car validated one way is validated the same way everywhere.

def _prepare_cars_batch(rows, company_id):
    """Validate car rows for `company_id`. Returns (to_insert, errors): a list
    of INSERT param tuples and a list of {index, errors}. The per-row NHTSA
    cross-check runs concurrently; within-batch duplicate VIN/plate is caught."""
    errors = []
    parsed = []
    for i, raw in enumerate(rows):
        if not isinstance(raw, dict):
            errors.append({"index": i, "errors": {"_": "Row must be a JSON object"}}); continue
        # Plate may arrive pre-joined ("M 12345") or split into icon + number.
        raw_plate = (raw.get("platenumber") or "").strip()
        if raw_plate:
            parts = raw_plate.split(maxsplit=1)
            icon, plate = (parts[0], parts[1]) if len(parts) == 2 else ("", raw_plate)
        else:
            icon  = (raw.get("plate_icon") or raw.get("icon") or "").strip()
            plate = (raw.get("plate_number") or raw.get("plate") or "").strip()
        parsed.append({
            "i":     i, "raw": raw,
            "vin":   (raw.get("vin") or "").strip().upper(),
            "type":  (raw.get("type") or "").strip(),
            "model": (raw.get("model") or "").strip(),
            "color": (raw.get("color") or "").strip(),
            "icon":  icon, "plate": plate,
        })

    # NHTSA model/body check is a per-row network round-trip — fan it out so N
    # rows cost ~ceil(N / workers) round-trips, not N. Check digit tolerated
    # exactly like the single Add-Car form (user may hand-edit the last 6).
    def _validate(p):
        # Hold a global slot only while actually validating, so the number of
        # threads touching the DB pool / NHTSA at once stays under the cap no
        # matter how many batches are running concurrently.
        with _validation_slots:
            return p["i"], _validate_car_inputs(
                vin=p["vin"], type_=p["type"], model=p["model"], color=p["color"],
                icon=p["icon"], plate=p["plate"], company_id=company_id,
                # Unlike the single Add-Car form (where a user hand-edits the
                # last 6 chars), a bulk import carries real fleet VINs — so we
                # enforce the check digit to keep typo'd / fabricated VINs out.
                enforce_check_digit=True,
                # Per-row DB uniqueness is skipped here and done in ONE bulk
                # query below — two lookups per car would be the bottleneck on
                # a large import.
                check_db_uniqueness=False,
            )

    results = {}
    if parsed:
        workers = max(1, min(BATCH_WORKERS, len(parsed)))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for idx, result in pool.map(_validate, parsed):
                results[idx] = result

    # Bulk uniqueness: collect the VINs/plates of rows that passed field
    # validation, then ask the DB about all of them in two queries (not two
    # per row). ANY(%s) hits the same VIN/plate indexes the per-row lookups did.
    ok_parsed = [p for p in parsed if results[p["i"]]["ok"]]
    cand_vins   = [p["vin"] for p in ok_parsed]
    cand_plates = [results[p["i"]]["platenumber"] for p in ok_parsed]
    existing_vins = {}
    existing_plates = set()
    if cand_vins:
        for r in (query("SELECT vin, company_id FROM cars WHERE vin = ANY(%s)",
                        (cand_vins,)) or []):
            existing_vins[r["vin"]] = r.get("company_id")
    if cand_plates:
        for r in (query("SELECT platenumber FROM cars WHERE platenumber = ANY(%s)",
                        (cand_plates,)) or []):
            existing_plates.add(r["platenumber"])

    seen_vins = {}      # vin -> first index it appeared at
    seen_plates = {}    # platenumber -> first index
    to_insert = []
    for p in parsed:
        i, vin = p["i"], p["vin"]
        result = results[i]
        if not result["ok"]:
            errors.append({"index": i, "errors": result["errors"]}); continue
        if vin in seen_vins:
            errors.append({"index": i, "errors": {
                "vin": f"Duplicate VIN '{vin}' — also at index {seen_vins[vin]} in this batch"}}); continue
        plate_key = result["platenumber"]
        if plate_key in seen_plates:
            errors.append({"index": i, "errors": {
                "plate_number": f"Duplicate plate '{plate_key}' — also at index {seen_plates[plate_key]} in this batch"}}); continue
        # Already in the DB? (bulk-fetched sets above)
        if vin in existing_vins:
            if company_id and existing_vins[vin] != int(company_id):
                errors.append({"index": i, "errors": {
                    "vin": "this vin car already use by another rental companies"}}); continue
            errors.append({"index": i, "errors": {
                "vin": f"VIN '{vin}' is already registered"}}); continue
        if plate_key in existing_plates:
            errors.append({"index": i, "errors": {
                "plate_number": f"Plate '{plate_key}' is already registered"}}); continue
        seen_vins[vin] = i
        seen_plates[plate_key] = i
        to_insert.append((
            vin, p["type"], p["model"], result["color"], result["platenumber"],
            bool(p["raw"].get("has_gps", False)), company_id,
        ))

    errors.sort(key=lambda e: e["index"])
    return to_insert, errors


def _insert_cars(cur, to_insert):
    """Bulk-insert prepared car tuples in a SINGLE multi-row statement and
    return the inserted rows. One round-trip for the whole batch instead of one
    per car. Raises on a UNIQUE violation so the caller can roll back."""
    if not to_insert:
        return []
    return execute_values(
        cur,
        """INSERT INTO cars
             (vin, type, model, color, platenumber, has_gps, company_id)
           VALUES %s
        RETURNING *""",
        to_insert,
        page_size=len(to_insert),   # one statement for the entire batch
        fetch=True,
    )


def _prepare_branches_batch(rows, company_id):
    """Validate branch rows for `company_id`. Returns (to_insert, errors)."""
    to_insert = []
    errors = []
    for i, raw in enumerate(rows):
        if not isinstance(raw, dict):
            errors.append({"index": i, "errors": {"_": "Row must be a JSON object"}}); continue
        branchname = _none_if_blank(raw.get("branchname"))
        location   = _none_if_blank(raw.get("location"))
        row_errs = {}
        if not branchname:
            row_errs["branchname"] = "branchname is required"
        if not location:
            row_errs["location"] = "location is required"
        if row_errs:
            errors.append({"index": i, "errors": row_errs}); continue
        to_insert.append((
            company_id, branchname, location,
            _none_if_blank(raw.get("phonenumber")),
            _none_if_blank(raw.get("x")), _none_if_blank(raw.get("y")),
        ))
    return to_insert, errors


def _insert_branches(cur, to_insert):
    """Bulk-insert prepared branch tuples in a SINGLE multi-row statement and
    return the rows."""
    if not to_insert:
        return []
    return execute_values(
        cur,
        """INSERT INTO branches
             (company_id, branchname, location, phonenumber, x, y)
           VALUES %s
        RETURNING *""",
        to_insert,
        page_size=len(to_insert),
        fetch=True,
    )


def _prepare_clients_batch(rows, company_id):
    """Validate client rows for `company_id`, resolving each into a plan:
    "insert" (new client) or "link" (existing client → attach this company),
    mirroring the single Add-Client endpoint. Returns (plans, errors)."""
    # ---- Pass 1: field validation + within-batch dedup (no DB yet) ----
    seen = {}        # (personid, licenseid) -> first index
    cands = []       # rows that passed field checks, awaiting DB resolution
    plans = []
    errors = []
    for i, raw in enumerate(rows):
        if not isinstance(raw, dict):
            errors.append({"index": i, "errors": {"_": "Row must be a JSON object"}}); continue

        licenseid = _none_if_blank(raw.get("licenseid"))
        if not licenseid:
            errors.append({"index": i, "errors": {"licenseid": "licenseid is required"}}); continue

        id_type  = _norm_id_type(raw.get("id_type"))
        personid = _none_if_blank(raw.get("personid"))
        if id_type in ("passport", "national_id") and not personid:
            errors.append({"index": i, "errors": {
                "personid": "personid required for passport / national ID"}}); continue

        key = (personid or "", licenseid)
        if key in seen:
            errors.append({"index": i, "errors": {
                "licenseid": f"Duplicate client (personid+licenseid) — also at index {seen[key]} in this batch"}}); continue
        seen[key] = i
        cands.append({"i": i, "raw": raw, "licenseid": licenseid,
                      "personid": personid, "id_type": id_type})

    # ---- Bulk-fetch every existing client touching this batch (1 query) ----
    # Replaces the previous two lookups PER ROW. Index the results by licenseid
    # and personid so the link/insert/conflict decision is pure in-memory.
    lics = list({c["licenseid"] for c in cands})
    pids = list({c["personid"] for c in cands if c["personid"]})
    by_lic, by_pid = {}, {}
    if lics or pids:
        for r in (query("SELECT * FROM clients WHERE licenseid = ANY(%s) OR personid = ANY(%s)",
                        (lics, pids)) or []):
            by_lic.setdefault(r.get("licenseid"), []).append(r)
            if r.get("personid"):
                by_pid.setdefault(r.get("personid"), []).append(r)

    # ---- Pass 2: resolve each candidate against the fetched snapshot ----
    for c in cands:
        i, licenseid, personid = c["i"], c["licenseid"], c["personid"]
        # An exact existing client → link this company to it.
        if personid:
            existing = next((r for r in by_pid.get(personid, [])
                             if r.get("licenseid") == licenseid), None)
        else:
            existing = next((r for r in by_lic.get(licenseid, [])
                             if r.get("personid") is None), None)
        if existing:
            plans.append({"action": "link", "index": i,
                          "existing": existing, "company_id": company_id})
            continue
        # Only one of personid/licenseid taken by a different client → conflict.
        if personid:
            partial = bool(by_pid.get(personid)) or bool(by_lic.get(licenseid))
        else:
            partial = bool(by_lic.get(licenseid))
        if partial:
            errors.append({"index": i, "errors": {
                "licenseid": "personid or licenseid is already used by a different client"}}); continue

        raw = c["raw"]
        plans.append({
            "action": "insert", "index": i, "company_id": company_id,
            "params": (
                personid,
                _none_if_blank(raw.get("name")),
                _none_if_blank(raw.get("fathername")),
                _none_if_blank(raw.get("mothername")),
                _none_if_blank(raw.get("nationality")),
                _none_if_blank(raw.get("phonenumber")),
                _none_if_blank(raw.get("dateofbirth")),
                licenseid,
                _none_if_blank(raw.get("startdatelicense")),
                _none_if_blank(raw.get("enddatelicense")),
                int(company_id) if company_id else None,
                _none_if_blank(raw.get("photo")),
                c["id_type"],
            ),
        })
    errors.sort(key=lambda e: e["index"])
    return plans, errors


def _insert_clients(cur, plans):
    """Run client insert/link plans via an open cursor using bulk statements.
    Returns (results, log_rows): `results` is the per-row outcome list;
    `log_rows` is [(company_id, label)] for the activity log of newly-inserted
    clients.

    Instead of 1-2 statements PER row, this runs at most a handful for the
    whole batch: one bulk reactivate, one bulk INSERT of all new clients, and
    one bulk INSERT of all company links."""
    # --- Bulk-reactivate any inactive existing clients we're linking to ---
    reactivate_ids = [p["existing"]["id"] for p in plans
                      if p["action"] == "link" and not p["existing"].get("is_active")]
    if reactivate_ids:
        cur.execute("UPDATE clients SET is_active = TRUE WHERE id = ANY(%s)",
                    (reactivate_ids,))

    # --- Bulk-insert every brand-new client in ONE statement, RETURNING ids.
    # personid (params[0]) + licenseid (params[7]) is unique within the batch
    # (deduped in _prepare_clients_batch), so we map returned rows back by it. ---
    insert_plans = [p for p in plans if p["action"] == "insert"]
    new_by_key = {}
    if insert_plans:
        new_rows = execute_values(
            cur,
            """INSERT INTO clients
                 (personid, name, fathername, mothername, nationality,
                  phonenumber, dateofbirth, licenseid,
                  startdatelicense, enddatelicense, company_id, photo, id_type)
               VALUES %s
            RETURNING id, personid, licenseid, name""",
            [p["params"] for p in insert_plans],
            page_size=len(insert_plans),
            fetch=True,
        )
        for r in new_rows:
            new_by_key[(r.get("personid") or "", r.get("licenseid"))] = r

    # --- Build per-row results + the full list of company links to write ---
    results = []
    log_rows = []
    link_values = []   # (client_id, company_id) for both linked and inserted
    for p in plans:
        cid = int(p["company_id"]) if p["company_id"] else None
        if p["action"] == "link":
            ex = p["existing"]
            if cid:
                link_values.append((ex["id"], cid))
            results.append({"index": p["index"], "action": "linked", "id": ex["id"]})
        else:
            new = new_by_key.get((p["params"][0] or "", p["params"][7]))
            new_id = new["id"] if new else None
            if cid and new_id:
                link_values.append((new_id, cid))
            results.append({"index": p["index"], "action": "inserted", "id": new_id})
            label = (new.get("name") if new else None) or p["params"][7]
            log_rows.append((cid, label))

    # --- One bulk INSERT for all client→company links ---
    if link_values:
        execute_values(
            cur,
            """INSERT INTO client_companies (client_id, company_id)
               VALUES %s ON CONFLICT DO NOTHING""",
            link_values,
            page_size=len(link_values),
        )

    results.sort(key=lambda r: r["index"])
    return results, log_rows


@app.post("/api/cars/batch")
def create_cars_batch():
    """Bulk-add cars from a JSON array (all-or-nothing). The payload may be a
    JSON request body OR an uploaded .json file (multipart ``file`` field), and
    in either case a bare array or ``{"cars": [...]}``. Each row runs the exact
    same validation
    gauntlet as the single Add-Car form — 17-char VIN, vininfo structure,
    Lebanese plate, curated colour, DB uniqueness, and the NHTSA model/body
    cross-check — plus a within-batch duplicate VIN/plate check. If ANY row
    fails, nothing is written and the full per-row error list is returned so
    the caller can fix and resubmit.

    This is the external (curl / Postman) bulk path for COMPANY users only —
    admin cannot create cars here, only view the resulting rows and activity
    logs. Every car is filed under the caller's own company; any ``company_id``
    in the payload is ignored."""
    u = _current_user()
    if not u:
        return jsonify({"error": "Not authenticated"}), 401
    if u.get("role") != "company" or not u.get("company_id"):
        return jsonify({"error": "Only company users can batch-add cars"}), 403
    company_id = int(u["company_id"])

    rows, err = _batch_rows_from_request("cars")
    if err:
        return jsonify({"error": err}), 400
    if not rows:
        return jsonify({"error": "No cars provided"}), 400
    if len(rows) > MAX_BATCH:
        return jsonify({"error": f"Too many rows ({len(rows)}); max {MAX_BATCH} per batch"}), 400

    to_insert, errors = _prepare_cars_batch(rows, company_id)
    if errors:
        return jsonify({
            "error":    "Batch rejected — fix the listed rows and resubmit.",
            "inserted": 0,
            "failed":   errors,
        }), 400

    # Every row is valid → insert in a single transaction so a late failure
    # rolls back the whole batch (true all-or-nothing).
    inserted = []
    try:
        with get_conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                inserted = _insert_cars(cur, to_insert)
    except Exception as e:
        # A UNIQUE(vin)/UNIQUE(platenumber) violation that slipped past the
        # checks above (e.g. a concurrent add) — clean 409, nothing saved.
        msg = str(e).lower()
        if "vin" in msg:
            field = "vin"
        elif "plate" in msg:
            field = "plate_number"
        else:
            field = "_"
        return jsonify({
            "error":    "Insert failed mid-batch — nothing was saved.",
            "inserted": 0,
            "failed":   [{"index": "?", "errors": {field: str(e)}}],
        }), 409

    for row in inserted:
        _log_activity(row.get("company_id"), "create", "car",
                      " · ".join(x for x in (row.get("model"), row.get("platenumber"),
                                             row.get("color")) if x),
                      ref=(f'car:{row.get("vin")}' if row.get("vin") else None))
    return jsonify({"inserted": len(inserted), "cars": _clean(inserted), "failed": []}), 201


# ----------------------- BRANCHES -------------------------------------
def _company_has_branches(company_id):
    """True if the company already has at least one active branch."""
    row = query(
        "SELECT 1 FROM branches WHERE company_id = %s AND is_active = TRUE LIMIT 1",
        (company_id,), one=True,
    )
    return bool(row)


def _set_head_office(company_id, branch_id):
    """Make `branch_id` the sole head office of `company_id`, atomically.

    Clears any existing head-office flag first (the partial unique index
    allows only one per company), then sets the target — both in one
    transaction so the swap never leaves the company with two head offices
    or trips the unique index. The target must be an active branch of the
    company; returns True if it was set."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE branches SET is_head_office = FALSE "
                "WHERE company_id = %s AND is_head_office = TRUE",
                (company_id,),
            )
            cur.execute(
                "UPDATE branches SET is_head_office = TRUE "
                "WHERE id = %s AND company_id = %s AND is_active = TRUE",
                (branch_id, company_id),
            )
            return cur.rowcount > 0


def _ensure_head_office(company_id):
    """Guarantee the company has a head office if it has any active branch —
    promote the earliest branch when none is flagged (e.g. after the current
    head office was deleted)."""
    execute(
        """UPDATE branches SET is_head_office = TRUE
            WHERE id = (SELECT MIN(id) FROM branches
                         WHERE company_id = %s AND is_active = TRUE)
              AND NOT EXISTS (SELECT 1 FROM branches
                               WHERE company_id = %s AND is_active = TRUE
                                 AND is_head_office = TRUE)""",
        (company_id, company_id),
    )


def _sync_main_head_office(company_id, location, phone, x, y):
    """Make the company's MAIN office its head office. The main office is the
    earliest branch; ticking "this is my head office" on the company form makes
    that branch the head office. If the company has NO branch yet, the first info
    the company entered is created here as its head-office branch — so the very
    first entry also becomes a branch. Returns the head-office branch id."""
    earliest = query(
        "SELECT id FROM branches WHERE company_id = %s AND is_active = TRUE "
        "ORDER BY id LIMIT 1", (company_id,), one=True)
    if earliest:
        _set_head_office(company_id, earliest["id"])
        return earliest["id"]
    row = execute(
        """INSERT INTO branches
             (company_id, branchname, location, phonenumber, x, y, is_head_office)
           VALUES (%s,%s,%s,%s,%s,%s, TRUE) RETURNING id""",
        (company_id, location or "", location or "", phone, x, y),
        returning=True,
    )
    return row["id"] if row else None


@app.get("/api/branches")
def list_branches():
    company_id = request.args.get("company_id")
    # Company users always see only their own branches, no matter what they
    # ask for in the query string.
    u = _current_user()
    if u and u.get("role") == "company":
        company_id = u.get("company_id")
    # Head office first, then alphabetical — so the designated head office is
    # always the leading row wherever branches are listed.
    if company_id:
        rows = query(
            """SELECT b.*, co.companyname
                 FROM branches b JOIN companies co ON co.id = b.company_id
                WHERE b.company_id = %s AND b.is_active = TRUE AND co.is_active = TRUE
                ORDER BY b.is_head_office DESC, b.branchname""",
            (company_id,),
        )
    else:
        rows = query(
            """SELECT b.*, co.companyname
                 FROM branches b JOIN companies co ON co.id = b.company_id
                WHERE b.is_active = TRUE AND co.is_active = TRUE
                ORDER BY co.companyname, b.is_head_office DESC, b.branchname"""
        )
    return jsonify(_clean(rows))


@app.post("/api/branches")
def create_branch():
    data = request.get_json(force=True) or {}
    miss = _required(data, "company_id", "branchname", "location")
    if miss:
        return jsonify({"error": f"Missing: {miss}"}), 400
    company_id = int(data["company_id"])
    if not _can_edit_company(company_id):
        return jsonify({"error": "Not authorized"}), 403
    # The company's MAIN location is the default head office. A branch becomes
    # head office ONLY when the caller explicitly ticks it (which then demotes the
    # main office / any other branch, enforced by _set_head_office).
    make_head = bool(data.get("is_head_office"))
    row = execute(
        """INSERT INTO branches
             (company_id, branchname, location, phonenumber, x, y)
           VALUES (%s,%s,%s,%s,%s,%s) RETURNING *""",
        (
            company_id, data["branchname"], data["location"],
            _none_if_blank(data.get("phonenumber")),
            _none_if_blank(data.get("x")), _none_if_blank(data.get("y")),
        ),
        returning=True,
    )
    if make_head and row:
        _set_head_office(company_id, row["id"])
        row["is_head_office"] = True
    _log_activity(company_id, "create", "branch",
                  f'{row["branchname"]} — {row["location"]}',
                  ref=(f'branch:{row.get("id")}' if row.get("id") else None))
    return jsonify(_clean(row)), 201


@app.post("/api/branches/batch")
def create_branches_batch():
    """Bulk-add branches from a JSON array (all-or-nothing). The payload may be
    a JSON request body OR an uploaded .json file (multipart ``file`` field),
    as a bare array or ``{"branches": [...]}``. Each row needs branchname and
    location; phonenumber/x/y are optional. COMPANY users only — admin cannot
    create branches here, only view them and the activity logs. Every branch
    is filed under the caller's own company; any ``company_id`` in the payload
    is ignored. If ANY row fails validation, nothing is written."""
    u = _current_user()
    if not u:
        return jsonify({"error": "Not authenticated"}), 401
    if u.get("role") != "company" or not u.get("company_id"):
        return jsonify({"error": "Only company users can batch-add branches"}), 403
    company_id = int(u["company_id"])

    rows, err = _batch_rows_from_request("branches")
    if err:
        return jsonify({"error": err}), 400
    if not rows:
        return jsonify({"error": "No branches provided"}), 400
    if len(rows) > MAX_BATCH:
        return jsonify({"error": f"Too many rows ({len(rows)}); max {MAX_BATCH} per batch"}), 400

    to_insert, errors = _prepare_branches_batch(rows, company_id)
    if errors:
        return jsonify({
            "error":    "Batch rejected — fix the listed rows and resubmit.",
            "inserted": 0,
            "failed":   errors,
        }), 400

    inserted = []
    try:
        with get_conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                inserted = _insert_branches(cur, to_insert)
    except Exception as e:
        return jsonify({
            "error":    "Insert failed mid-batch — nothing was saved.",
            "inserted": 0,
            "failed":   [{"index": "?", "errors": {"_": str(e)}}],
        }), 409

    return jsonify({"inserted": len(inserted), "branches": _clean(inserted), "failed": []}), 201


@app.put("/api/branches/<int:branch_id>")
def update_branch(branch_id):
    data = request.get_json(force=True) or {}
    miss = _required(data, "company_id", "branchname", "location")
    if miss:
        return jsonify({"error": f"Missing: {miss}"}), 400
    existing = query(
        "SELECT company_id, branchname, location, phonenumber FROM branches WHERE id = %s",
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
    if data.get("is_head_office"):
        _set_head_office(int(data["company_id"]), branch_id)
        row["is_head_office"] = True
    # Audit: which branch fields changed (name, location, phone).
    diff = _diff_fields(existing, row, [
        ("name", "branchname"), ("location", "location"), ("phone", "phonenumber"),
    ])
    _log_activity(int(data["company_id"]), "update", "branch",
                  f'{row["branchname"]}' + (f' — {diff}' if diff else ''),
                  ref=(f'branch:{row.get("id")}' if row.get("id") else None))
    return jsonify(_clean(row))


@app.put("/api/branches/<int:branch_id>/head-office")
def set_branch_head_office(branch_id):
    """Designate an existing branch as its company's head office. Company users
    (own company) and admins only. Clears the previous head office in the same
    transaction, so a company always has exactly one."""
    existing = query("SELECT company_id, is_active, branchname FROM branches WHERE id = %s",
                     (branch_id,), one=True)
    if not existing or not existing.get("is_active"):
        return jsonify({"error": "Not found"}), 404
    if not _can_edit_company(existing["company_id"]):
        return jsonify({"error": "Not authorized"}), 403
    _set_head_office(existing["company_id"], branch_id)
    _log_activity(existing["company_id"], "update", "branch",
                  f'{existing.get("branchname") or ("#" + str(branch_id))} set as head office',
                  ref=f'branch:{branch_id}')
    return jsonify({"id": branch_id, "is_head_office": True})


@app.delete("/api/branches/<int:branch_id>")
def delete_branch(branch_id):
    """Hard delete — the row is removed from the branches table. If the deleted
    branch was the head office, the company's MAIN location automatically becomes
    the head office again (no branch is flagged), matching the default model."""
    existing = query(
        "SELECT company_id, is_head_office, branchname FROM branches WHERE id = %s",
        (branch_id,), one=True)
    if not existing:
        return jsonify({"error": "Not found"}), 404
    if not _can_edit_company(existing["company_id"]):
        return jsonify({"error": "Not authorized"}), 403
    execute("DELETE FROM branches WHERE id = %s", (branch_id,))
    _log_activity(existing["company_id"], "delete", "branch",
                  existing.get("branchname") or f'#{branch_id}')
    return ("", 204)


# ----------------------- SPECIAL-COMPANY RENTALS (B2B) ----------------
# The enterprise records another company it rents its own cars OUT to. Each
# record is owned by the calling company and lists which of the company's own
# car VINs that other company currently holds. Company users only.
def _require_company_user():
    u = _current_user()
    if not u:
        return None, (jsonify({"error": "Not authenticated"}), 401)
    if u.get("role") != "company" or not u.get("company_id"):
        return None, (jsonify({"error": "Only company users can do this"}), 403)
    return u, None


@app.get("/api/special-rentals")
def list_special_rentals():
    u, err = _require_company_user()
    if err:
        return err
    rows = query(
        """SELECT * FROM special_company_rentals
            WHERE company_id = %s
            ORDER BY created_at DESC""",
        (u["company_id"],),
    )
    return jsonify(_clean(rows))


@app.get("/api/admin/special-rentals")
def admin_list_special_rentals():
    """Admin-wide view of every B2B "cars rented to companies" record across
    ALL companies. Joins the owning company's car so the model/color/plate/GPS
    travel with each row (admin has no per-company car list loaded)."""
    u = _current_user()
    if not u:
        return jsonify({"error": "Not authenticated"}), 401
    if u.get("role") != "admin":
        return jsonify({"error": "Only admins can do this"}), 403
    rows = query(
        """SELECT s.*, c.model, c.color,
                  COALESCE(s.plate, c.platenumber) AS platenumber,
                  c.has_gps, c.type
             FROM special_company_rentals s
             LEFT JOIN cars c
               ON c.vin = s.car_vin AND c.company_id = s.company_id
            ORDER BY s.created_at DESC"""
    )
    return jsonify(_clean(rows))


@app.post("/api/special-rentals")
def create_special_rental():
    u, err = _require_company_user()
    if err:
        return err
    data = request.get_json(force=True) or {}
    miss = _required(data, "company_name")
    if miss:
        return jsonify({"error": f"Missing: {miss}"}), 400

    # phones / branches / car_vins may arrive as a list OR an already
    # comma-joined string; normalise all three to a clean CSV string.
    def _csv(value):
        if isinstance(value, list):
            return ",".join(str(v).strip() for v in value if str(v).strip())
        return value

    status, status_err = _validate_status(data.get("status"))
    if status_err:
        return jsonify({"error": status_err, "errors": {"status": status_err}}), 400

    # One record now holds a single car (car_vin) plus its rental period.
    # car_vins is still written (= car_vin) so legacy readers keep working.
    car_vin = _none_if_blank(data.get("car_vin"))
    # Which of the car's plates this record is on (only when a car is set).
    plate = None
    if car_vin:
        plate, plate_err = _resolve_booking_plate(u["company_id"], data.get("plate"))
        if plate_err:
            return jsonify({"error": plate_err, "errors": {"plate": plate_err}}), 400
    row = execute(
        """INSERT INTO special_company_rentals
             (company_id, company_name, owner_name, location, x, y,
              phones, branches, car_vin, car_vins, start_date, end_date, notes,
              status, plate)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
        (
            u["company_id"], data["company_name"],
            _none_if_blank(data.get("owner_name")),
            _none_if_blank(data.get("location")),
            _none_if_blank(data.get("x")), _none_if_blank(data.get("y")),
            _none_if_blank(_csv(data.get("phones"))),
            _none_if_blank(_csv(data.get("branches"))),
            car_vin, car_vin,
            _none_if_blank(data.get("start_date")),
            _none_if_blank(data.get("end_date")),
            _none_if_blank(data.get("notes")),
            status, plate,
        ),
        returning=True,
    )
    _log_activity(u["company_id"], "create", "special_rental",
                  f'{data["company_name"]} · {status}')
    return jsonify(_clean(row)), 201


def _prepare_company_rentals_batch(rows, company_id):
    """Validate B2B 'cars rented to companies' rows (all-or-nothing). Each row
    records another company that is holding one of YOUR cars. ``company_name``
    is required; a supplied ``car_vin`` must be one of your active cars.
    ``phones`` / ``branches`` accept a list or a comma-joined string. Returns
    ``(to_insert, errors)`` where each to_insert is the INSERT param tuple."""
    def _csv(value):
        if isinstance(value, list):
            return ",".join(str(v).strip() for v in value if str(v).strip())
        return value

    parsed, errors = [], []
    for i, raw in enumerate(rows):
        if not isinstance(raw, dict):
            errors.append({"index": i, "errors": {"_": "Row must be a JSON object"}}); continue
        row_errs = {}
        company_name = _none_if_blank(raw.get("company_name"))
        if not company_name:
            row_errs["company_name"] = "company_name is required"
        car_vin = ((raw.get("car_vin") or "").strip().upper()) or None
        start = _none_if_blank(raw.get("start_date"))
        end   = _none_if_blank(raw.get("end_date"))
        if start and end and str(end) < str(start):
            row_errs["end_date"] = "end_date must be on or after start_date"
        if row_errs:
            errors.append({"index": i, "errors": row_errs}); continue
        parsed.append({"i": i, "raw": raw, "company_name": company_name,
                       "car_vin": car_vin, "start": start, "end": end})

    # One query resolves ownership of every VIN referenced in the batch.
    vins = list({p["car_vin"] for p in parsed if p["car_vin"]})
    owned = set()
    if vins:
        for r in (query("SELECT vin FROM cars "
                        "WHERE vin = ANY(%s) AND company_id = %s AND is_active = TRUE",
                        (vins, company_id)) or []):
            owned.add(r["vin"])

    to_insert = []
    for p in parsed:
        if p["car_vin"] and p["car_vin"] not in owned:
            errors.append({"index": p["i"], "errors": {
                "car_vin": f"No active car with VIN '{p['car_vin']}' in your fleet"}}); continue
        raw = p["raw"]
        to_insert.append((
            company_id, p["company_name"],
            _none_if_blank(raw.get("owner_name")),
            _none_if_blank(raw.get("location")),
            _none_if_blank(raw.get("x")), _none_if_blank(raw.get("y")),
            _none_if_blank(_csv(raw.get("phones"))),
            _none_if_blank(_csv(raw.get("branches"))),
            p["car_vin"], p["car_vin"],
            p["start"], p["end"],
            _none_if_blank(raw.get("notes")),
        ))
    errors.sort(key=lambda e: e["index"])
    return to_insert, errors


@app.post("/api/company-rentals/batch")
def create_company_rentals_batch():
    """Bulk-record cars rented OUT to other companies (B2B, all-or-nothing).
    Payload is a JSON body OR an uploaded .json file, as a bare array or
    ``{"company_rentals": [...]}``. Everything is filed under the caller's
    company; ``company_id`` is never accepted. If ANY row is invalid nothing is
    saved. COMPANY users only (header login or API key)."""
    u = _current_user()
    if not u:
        return jsonify({"error": "Not authenticated"}), 401
    if u.get("role") != "company" or not u.get("company_id"):
        return jsonify({"error": "Only company users can batch-add B2B rentals"}), 403
    company_id = int(u["company_id"])

    rows, err = _batch_rows_from_request("company_rentals")
    if err:
        return jsonify({"error": err}), 400
    if not rows:
        return jsonify({"error": "No company rentals provided"}), 400
    if len(rows) > MAX_BATCH:
        return jsonify({"error": f"Too many rows ({len(rows)}); max {MAX_BATCH} per batch"}), 400

    to_insert, errors = _prepare_company_rentals_batch(rows, company_id)
    if errors:
        return jsonify({"error": "Batch rejected — fix the listed rows and resubmit.",
                        "inserted": 0, "failed": errors}), 400

    inserted = []
    try:
        with get_conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                inserted = execute_values(
                    cur,
                    """INSERT INTO special_company_rentals
                         (company_id, company_name, owner_name, location, x, y,
                          phones, branches, car_vin, car_vins,
                          start_date, end_date, notes)
                       VALUES %s RETURNING *""",
                    to_insert, page_size=len(to_insert), fetch=True,
                )
    except Exception as e:
        return jsonify({"error": "Insert failed mid-batch — nothing was saved.",
                        "inserted": 0,
                        "failed": [{"index": "?", "errors": {"_": str(e)}}]}), 409

    for row in inserted:
        _log_activity(company_id, "create", "special_rental", row.get("company_name"))
    return jsonify({"inserted": len(inserted),
                    "company_rentals": _clean(inserted), "failed": []}), 201


@app.put("/api/special-rentals/<int:rental_id>")
def update_special_rental(rental_id):
    u, err = _require_company_user()
    if err:
        return err
    data = request.get_json(force=True) or {}
    miss = _required(data, "company_name")
    if miss:
        return jsonify({"error": f"Missing: {miss}"}), 400

    # Only the company that recorded it may edit it. Edits are unlimited now —
    # the audit log records each change instead of a hard cap.
    rec = query(
        "SELECT company_id, edit_count FROM special_company_rentals WHERE id = %s",
        (rental_id,), one=True,
    )
    if not rec:
        return jsonify({"error": "Not found"}), 404
    if int(rec["company_id"]) != int(u["company_id"]):
        return jsonify({"error": "Not authorized"}), 403

    def _csv(value):
        if isinstance(value, list):
            return ",".join(str(v).strip() for v in value if str(v).strip())
        return value

    # An edit that omits `status` must not silently reset it — keep what's there.
    status, status_err = _validate_status(data.get("status"), default=None)
    if status_err:
        return jsonify({"error": status_err, "errors": {"status": status_err}}), 400

    car_vin = _none_if_blank(data.get("car_vin"))
    plate = None
    if car_vin:
        plate, plate_err = _resolve_booking_plate(u["company_id"], data.get("plate"))
        if plate_err:
            return jsonify({"error": plate_err, "errors": {"plate": plate_err}}), 400
    row = execute(
        """UPDATE special_company_rentals
              SET company_name = %s, owner_name = %s, location = %s,
                  x = %s, y = %s, phones = %s, branches = %s,
                  car_vin = %s, car_vins = %s,
                  start_date = %s, end_date = %s, notes = %s,
                  status = COALESCE(%s, status),
                  plate = %s,
                  edit_count = edit_count + 1
            WHERE id = %s AND company_id = %s
        RETURNING *""",
        (
            data["company_name"],
            _none_if_blank(data.get("owner_name")),
            _none_if_blank(data.get("location")),
            _none_if_blank(data.get("x")), _none_if_blank(data.get("y")),
            _none_if_blank(_csv(data.get("phones"))),
            _none_if_blank(_csv(data.get("branches"))),
            car_vin, car_vin,
            _none_if_blank(data.get("start_date")),
            _none_if_blank(data.get("end_date")),
            _none_if_blank(data.get("notes")),
            status, plate,
            rental_id, u["company_id"],
        ),
        returning=True,
    )
    if not row:
        return jsonify({"error": "Not found"}), 404
    _log_activity(u["company_id"], "update", "special_rental", data["company_name"])
    return jsonify(_clean(row))


@app.patch("/api/special-rentals/<int:rental_id>/status")
def update_special_rental_status(rental_id):
    """Move a B2B record between pending / active / cancelled, on its own.

    The PUT above can also set status, but it rewrites every field and bumps
    edit_count — flipping a dropdown in the table shouldn't read as an edit of
    the record. Unlike a rental, a B2B record never enters the car-overlap probe
    (`_check_car_date_overlap` reads `rentals` only), so reclaiming a car here
    can't clash with anything and needs no lock.

    COMPANY-ONLY, deliberately: `_require_company_user`, not
    `_can_edit_company`. A booking belongs to the company that took it — that
    company moves it, and the admin only reads the result (its Cars hub renders
    these states as read-only tags). Widening this to admin would leave the API
    honouring a move the UI deliberately doesn't offer, which is a permission
    hole dressed as a convenience."""
    u, err = _require_company_user()
    if err:
        return err
    data = request.get_json(force=True) or {}
    status, status_err = _validate_status(data.get("status"), default=None)
    if status is None:
        return jsonify({"error": status_err or "Status is required",
                        "errors": {"status": status_err or "Status is required"}}), 400

    rec = query(
        """SELECT company_id, company_name, status, returned_at
             FROM special_company_rentals WHERE id = %s""",
        (rental_id,), one=True)
    if not rec:
        return jsonify({"error": "Not found"}), 404
    if int(rec["company_id"]) != int(u["company_id"]):
        return jsonify({"error": "Not authorized"}), 403
    if rec["returned_at"] is not None:
        return jsonify({"error": "This car has already been returned"}), 409
    if rec["status"] == status:
        return jsonify(_clean(rec)), 200

    row = execute(
        "UPDATE special_company_rentals SET status = %s WHERE id = %s RETURNING *",
        (status, rental_id), returning=True)
    _log_activity(u["company_id"], "update", "special_rental",
                  f'{rec["company_name"]} · {rec["status"]}→{status}')
    return jsonify(_clean(row)), 200


@app.delete("/api/special-rentals/<int:rental_id>")
def delete_special_rental(rental_id):
    existing = query(
        "SELECT company_id, company_name FROM special_company_rentals WHERE id = %s",
        (rental_id,), one=True,
    )
    if not existing:
        return jsonify({"error": "Not found"}), 404
    if not _can_edit_company(existing["company_id"]):
        return jsonify({"error": "Not authorized"}), 403
    execute("DELETE FROM special_company_rentals WHERE id = %s", (rental_id,))
    _log_activity(existing["company_id"], "delete", "special_rental",
                  existing.get("company_name"))
    return ("", 204)


@app.post("/api/special-rentals/<int:rental_id>/extend")
def extend_special_rental(rental_id):
    """The other company keeps one of our cars longer: push this B2B record's
    end_date out. Company-owner only; the record must still be out (not yet
    returned); the new date can't move before the start."""
    u, err = _require_company_user()
    if err:
        return err
    data = request.get_json(force=True) or {}
    new_end = _none_if_blank(data.get("end_date"))
    if not new_end:
        return jsonify({"error": "Missing: end_date"}), 400
    rec = query(
        """SELECT company_id, company_name, car_vin, start_date, end_date, returned_at
             FROM special_company_rentals WHERE id = %s""",
        (rental_id,), one=True,
    )
    if not rec:
        return jsonify({"error": "Not found"}), 404
    if int(rec["company_id"]) != int(u["company_id"]):
        return jsonify({"error": "Not authorized"}), 403
    if rec["returned_at"] is not None:
        return jsonify({"error": "This car has already been returned"}), 409
    if rec["start_date"] and str(new_end) < str(rec["start_date"]):
        return jsonify({"error": "New return date must be on or after the start date"}), 400
    row = execute(
        """UPDATE special_company_rentals SET end_date = %s
            WHERE id = %s AND company_id = %s RETURNING *""",
        (new_end, rental_id, u["company_id"]), returning=True,
    )
    _log_activity(u["company_id"], "update", "special_rental",
                  f'{rec["company_name"]} — extended {rec["end_date"]}→{new_end}')
    return jsonify(_clean(row))


@app.post("/api/special-rentals/<int:rental_id>/return")
def return_special_rental(rental_id):
    """The other company hands one of our cars back. Stamps returned_at so the
    record drops off the active "Cars Rented by Companies" list (kept as
    history), records WHICH branch it came back to, and moves the car to that
    branch so it's available there again. Company-owner only."""
    u, err = _require_company_user()
    if err:
        return err
    rec = query(
        "SELECT company_id, company_name, car_vin, returned_at FROM special_company_rentals WHERE id = %s",
        (rental_id,), one=True,
    )
    if not rec:
        return jsonify({"error": "Not found"}), 404
    if int(rec["company_id"]) != int(u["company_id"]):
        return jsonify({"error": "Not authorized"}), 403
    if rec["returned_at"] is not None:
        return jsonify({"error": "This car has already been returned"}), 409
    data = request.get_json(silent=True) or {}
    branch_id = _resolve_branch_id(data.get("return_branch_id"), rec["company_id"])
    row = execute(
        """UPDATE special_company_rentals
              SET returned_at = NOW(), return_branch_id = %s
            WHERE id = %s AND company_id = %s AND returned_at IS NULL
        RETURNING *""",
        (branch_id, rental_id, u["company_id"]), returning=True,
    )
    if not row:
        return jsonify({"error": "Not found or already returned"}), 404
    # Move the car back to the branch it was returned to (NULL = Main).
    if rec.get("car_vin"):
        execute("UPDATE cars SET branch_id = %s WHERE vin = %s AND company_id = %s",
                (branch_id, rec["car_vin"], rec["company_id"]))
    _log_activity(u["company_id"], "update", "special_rental",
                  f'{rec["company_name"]} — car returned to {_branch_label(branch_id)}')
    return jsonify(_clean(row))


@app.get("/api/company/alerts")
def company_alerts():
    """Login dashboard for a company user: what needs attention today.
      * returns_due     — cars still out (individual rentals + B2B records) whose
                          return date is today or already past (overdue).
      * reservations_today — pending reservations that START today.
    Small, bounded lists so the client can render a notification panel without
    pulling every rental/reservation."""
    u, err = _require_company_user()
    if err:
        return err
    cid = u["company_id"]
    # "Today" is the business's local calendar day. The app process runs in the
    # deployment's timezone (e.g. Asia/Beirut), which matches the user's browser
    # — whereas the database may store/serve in UTC, so CURRENT_DATE could be a
    # day off near midnight. Anchoring on date.today() and passing it in keeps
    # the alert, its overdue flags, and the browser's calendar all in agreement.
    today = date.today()

    # Individual rentals still out, due today or overdue. v_client_rentals is
    # already company-scoped and excludes returned rentals via returned_at.
    ind = query(
        """SELECT rental_id AS id, 'individual' AS kind,
                  client_name AS who, car_model, car_plate, car_vin, end_date,
                  (end_date < %s) AS overdue
             FROM v_client_rentals
            WHERE company_id = %s AND returned_at IS NULL
              AND end_date IS NOT NULL AND end_date <= %s
            ORDER BY end_date ASC""",
        (today, cid, today),
    )
    # B2B records still out (returned_at NULL), due today or overdue. Join the
    # owning company's car so model/plate travel with the row.
    b2b = query(
        """SELECT s.id, 'company' AS kind, s.company_name AS who,
                  c.model AS car_model,
                  COALESCE(s.plate, c.platenumber) AS car_plate,
                  s.car_vin, s.end_date,
                  (s.end_date < %s) AS overdue
             FROM special_company_rentals s
             LEFT JOIN cars c ON c.vin = s.car_vin AND c.company_id = s.company_id
            WHERE s.company_id = %s AND s.returned_at IS NULL
              AND s.end_date IS NOT NULL AND s.end_date <= %s
            ORDER BY s.end_date ASC""",
        (today, cid, today),
    )
    returns = _clean(list(ind) + list(b2b))
    overdue = sum(1 for r in returns if r.get("overdue"))
    due_today = len(returns) - overdue

    # Pending bookings whose period has begun (start_date on or before today)
    # but which nobody has marked active yet. `late` marks any whose start day
    # has already passed. Pre-040 these were pending reservations; they're
    # pending rentals now, and rentals carry no company_id — the owning company
    # comes from the car.
    res_today = query(
        """SELECT r.id, c.name AS client_name, c.phonenumber AS client_phone,
                  ca.model AS car_model,
                  COALESCE(r.plate, ca.platenumber) AS car_plate,
                  r.start_date, r.end_date,
                  (r.start_date < %s) AS late
             FROM rentals r
             JOIN clients c ON c.id = r.client_id
             JOIN cars ca ON ca.vin = r.car_vin
            WHERE ca.company_id = %s AND r.status = 'pending'
              AND r.returned_at IS NULL
              AND r.start_date <= %s
            ORDER BY r.start_date ASC, r.created_at DESC""",
        (today, cid, today),
    )
    res_today = _clean(res_today)
    return jsonify({
        "returns_due": {
            "overdue": overdue,
            "today": due_today,
            "total": len(returns),
            "items": returns,
        },
        "reservations_today": {
            "count": len(res_today),
            "items": res_today,
        },
    })


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
    if not u:
        return jsonify({"error": "Not authenticated"}), 401
    if u.get("role") == "company" and u.get("company_id"):
        rows = query(
            """SELECT cl.*
                 FROM clients cl
                 JOIN client_companies cc ON cc.client_id = cl.id
                WHERE cl.is_active = TRUE
                  AND cc.company_id = %s
                ORDER BY cl.name""",
            (u["company_id"],),
        )
    elif u.get("role") == "admin":
        rows = query("SELECT * FROM clients WHERE is_active = TRUE ORDER BY name")
    else:
        return jsonify({"error": "Not authorized"}), 403
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

    # Company client edits are unlimited — the audit log below records every
    # change for the admin. Fetch the old row first so we can diff it.
    u = _current_user()
    is_company = bool(u and u.get("role") == "company")
    old = query(
        """SELECT company_id, name, fathername, mothername, nationality,
                  phonenumber, dateofbirth, licenseid, personid, id_type,
                  startdatelicense, enddatelicense
             FROM clients WHERE id = %s AND is_active = TRUE""",
        (client_id,), one=True)
    if not old:
        return jsonify({"error": "Not found"}), 404

    row = execute(
        """UPDATE clients
              SET personid = %s, name = %s, fathername = %s, mothername = %s,
                  nationality = %s,
                  phonenumber = %s, dateofbirth = %s, licenseid = %s,
                  startdatelicense = %s, enddatelicense = %s,
                  photo = COALESCE(%s, photo),
                  id_type = COALESCE(%s, id_type),
                  edit_count = edit_count + %s
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
            1 if is_company else 0,
            client_id,
        ),
        returning=True,
    )
    if not row:
        return jsonify({"error": "Not found"}), 404
    # Audit: which client fields changed (name, phone, licence, id, …).
    diff = _diff_fields(old, row, [
        ("name", "name"), ("father", "fathername"), ("mother", "mothername"),
        ("nationality", "nationality"), ("phone", "phonenumber"),
        ("dob", "dateofbirth"), ("license", "licenseid"), ("personid", "personid"),
        ("id_type", "id_type"), ("lic_start", "startdatelicense"),
        ("lic_end", "enddatelicense"),
    ])
    log_company = (u.get("company_id") if is_company else old.get("company_id"))
    _log_activity(log_company, "update", "client",
                  f'{row.get("name") or row.get("licenseid")}'
                  + (f' — {diff}' if diff else ''),
                  ref=(f'client:{row.get("id")}' if row.get("id") else None))
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
        cli = query("SELECT name, licenseid FROM clients WHERE id = %s",
                    (client_id,), one=True) or {}
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
        _log_activity(company_id, "delete", "client",
                      f'{cli.get("name") or cli.get("licenseid") or client_id} (unlinked)')
        return ("", 204)

    row = execute(
        "UPDATE clients SET is_active = FALSE WHERE id = %s AND is_active = TRUE "
        "RETURNING id, company_id, name, licenseid",
        (client_id,),
        returning=True,
    )
    if not row:
        return jsonify({"error": "Not found"}), 404
    _log_activity(row.get("company_id"), "delete", "client",
                  f'{row.get("name") or row.get("licenseid")}')
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
    if row:
        _log_activity(int(company_id) if company_id else None, "create", "client",
                      row.get("name") or row.get("licenseid"),
                      ref=(f'client:{row.get("id")}' if row.get("id") else None))
    return jsonify(_attach_linked_companies(_clean(row))), 201


@app.post("/api/clients/batch")
def create_clients_batch():
    """Bulk-add clients from a JSON array (all-or-nothing). The payload may be a
    JSON request body OR an uploaded .json file (multipart ``file`` field), as a
    bare array or ``{"clients": [...]}``. Each row carries the same rules as the
    single Add-Client form:

      * licenseid is always required; personid is required only for passport /
        national-ID clients.
      * If a row matches an existing client (personid + licenseid, or
        licenseid-only for license-only clients) it is treated as a *link* —
        the caller's company is attached to the canonical record and the typed
        fields are ignored — exactly like the single endpoint.
      * If only one of personid / licenseid collides with a different client,
        the row is rejected (contradicts an existing record).

    Validation runs over the whole batch first; if ANY row is rejected nothing
    is written. The valid rows (a mix of inserts and links) are then committed
    in a single transaction.

    COMPANY users only — admin cannot create clients here, only view them and
    the activity logs. Every client is linked to the caller's own company; any
    ``company_id`` in the payload is ignored."""
    u = _current_user()
    if not u:
        return jsonify({"error": "Not authenticated"}), 401
    if u.get("role") != "company" or not u.get("company_id"):
        return jsonify({"error": "Only company users can batch-add clients"}), 403
    company_id = int(u["company_id"])

    rows, err = _batch_rows_from_request("clients")
    if err:
        return jsonify({"error": err}), 400
    if not rows:
        return jsonify({"error": "No clients provided"}), 400
    if len(rows) > MAX_BATCH:
        return jsonify({"error": f"Too many rows ({len(rows)}); max {MAX_BATCH} per batch"}), 400

    plans, errors = _prepare_clients_batch(rows, company_id)
    if errors:
        return jsonify({
            "error":    "Batch rejected — fix the listed rows and resubmit.",
            "inserted": 0,
            "failed":   errors,
        }), 400

    # Commit every insert + link in one transaction (true all-or-nothing).
    try:
        with get_conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                results, log_rows = _insert_clients(cur, plans)
    except Exception as e:
        return jsonify({
            "error":    "Insert failed mid-batch — nothing was saved.",
            "inserted": 0,
            "failed":   [{"index": "?", "errors": {"_": str(e)}}],
        }), 409

    for cid, label in log_rows:
        _log_activity(cid, "create", "client", label)

    n_inserted = sum(1 for r in results if r["action"] == "inserted")
    n_linked   = sum(1 for r in results if r["action"] == "linked")
    return jsonify({
        "inserted": n_inserted,
        "linked":   n_linked,
        "results":  results,
        "failed":   [],
    }), 201


@app.post("/api/batch")
def create_batch_all():
    """ONE endpoint to import cars, clients, and branches together. The payload
    is a single JSON object (request body OR uploaded .json file) with any of
    these arrays::

        {
          "cars":     [ { ...car... },    ... ],
          "clients":  [ { ...client... }, ... ],
          "branches": [ { ...branch... }, ... ]
        }

    Each section is validated by the exact same rules as its dedicated batch
    endpoint. It is all-or-nothing across EVERYTHING: if any row in any section
    fails, nothing at all is written and the per-section error lists come back.
    On success all three sections commit in a single transaction.

    COMPANY users only — admin cannot create here, only view the rows and the
    activity logs. Everything is filed under the caller's own company; any
    ``company_id`` in the payload is ignored. The ``MAX_BATCH`` cap applies to
    the combined row count across all sections."""
    u = _current_user()
    if not u:
        return jsonify({"error": "Not authenticated"}), 401
    if u.get("role") != "company" or not u.get("company_id"):
        return jsonify({"error": "Only company users can batch-import data"}), 403
    company_id = int(u["company_id"])

    payload, err = _load_json_request()
    if err:
        return jsonify({"error": err}), 400
    if not isinstance(payload, dict):
        return jsonify({"error": 'Body must be a JSON object with "cars" / '
                                 '"clients" / "branches" arrays'}), 400

    sections = {}
    for key in ("cars", "clients", "branches"):
        val = payload.get(key)
        if val is None:
            val = []
        if not isinstance(val, list):
            return jsonify({"error": f'"{key}" must be a JSON array'}), 400
        sections[key] = val

    total = sum(len(v) for v in sections.values())
    if total == 0:
        return jsonify({"error": "No data provided — include at least one of "
                                 "cars / clients / branches"}), 400
    if total > MAX_BATCH:
        return jsonify({"error": f"Too many rows ({total}); max {MAX_BATCH} per batch"}), 400

    # Validate everything first (no writes). Car validation fans out the NHTSA
    # checks internally; client validation does read-only DB lookups.
    car_inserts,    car_errors    = _prepare_cars_batch(sections["cars"], company_id)
    client_plans,   client_errors = _prepare_clients_batch(sections["clients"], company_id)
    branch_inserts, branch_errors = _prepare_branches_batch(sections["branches"], company_id)

    if car_errors or client_errors or branch_errors:
        return jsonify({
            "error":  "Batch rejected — fix the listed rows and resubmit. Nothing was saved.",
            "failed": {"cars": car_errors, "clients": client_errors, "branches": branch_errors},
        }), 400

    # All clean → one transaction for all three entities. A failure anywhere
    # rolls the whole import back.
    try:
        with get_conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                inserted_branches = _insert_branches(cur, branch_inserts)
                inserted_cars     = _insert_cars(cur, car_inserts)
                client_results, client_logs = _insert_clients(cur, client_plans)
    except Exception as e:
        return jsonify({
            "error":  "Insert failed mid-batch — nothing was saved.",
            "detail": str(e),
        }), 409

    for row in inserted_cars:
        _log_activity(row.get("company_id"), "create", "car",
                      " · ".join(x for x in (row.get("model"), row.get("platenumber"),
                                             row.get("color")) if x),
                      ref=(f'car:{row.get("vin")}' if row.get("vin") else None))
    for cid, label in client_logs:
        _log_activity(cid, "create", "client", label)

    n_cli_ins  = sum(1 for r in client_results if r["action"] == "inserted")
    n_cli_link = sum(1 for r in client_results if r["action"] == "linked")
    return jsonify({
        "cars":     {"inserted": len(inserted_cars),     "rows": _clean(inserted_cars)},
        "clients":  {"inserted": n_cli_ins, "linked": n_cli_link, "results": client_results},
        "branches": {"inserted": len(inserted_branches), "rows": _clean(inserted_branches)},
        "failed":   {"cars": [], "clients": [], "branches": []},
    }), 201


# ----------------------- PASSWORD CHANGE --------------------------------
@app.post("/api/change-password")
def change_password():
    data = request.get_json(force=True) or {}
    username = (data.get("username") or "").strip()
    old_password = data.get("old_password") or ""
    new_password = data.get("new_password") or ""
    if not username or not old_password or not new_password:
        return jsonify({"error": "Missing credentials"}), 400
    if len(new_password) < 4:
        return jsonify({"error": "Password must be at least 4 characters"}), 400

    row = query(
        "SELECT id FROM users WHERE LOWER(username) = LOWER(%s) AND password_hash = %s",
        (username, _sha256(old_password)), one=True,
    )
    if not row:
        return jsonify({"error": "Current password is incorrect"}), 401

    execute(
        "UPDATE users SET password_hash = %s, must_reset_password = FALSE WHERE id = %s",
        (_sha256(new_password), row["id"]),
    )
    return jsonify({"ok": True})


# ----------------------- RENTALS --------------------------------------
def _lock_cars_for_booking(cur, vins):
    """Serialize concurrent booking writes that touch the SAME car. Two requests
    inserting a new rental/reservation for one car in overlapping date ranges
    can't see each other's uncommitted rows (READ COMMITTED) and there's no
    existing row for `_check_car_date_overlap`'s FOR UPDATE to grab — so a plain
    overlap check races and both can win. A transaction-scoped advisory lock per
    VIN forces requests touching the same car to run one-at-a-time (different
    cars stay fully parallel). Locks are taken in sorted order so two batches
    sharing several cars can't deadlock. The lock is released automatically when
    the transaction commits or rolls back."""
    for vin in sorted({v for v in vins if v}):
        cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (vin,))


def _check_car_date_overlap(cur, car_vin, start_date, end_date,
                            exclude_rental_id=None,
                            exclude_reservation_id=None):
    """Check if a car has any overlapping booking in the given date range. Must
    be called inside a transaction with an open cursor — uses FOR UPDATE to
    prevent two concurrent requests from both passing the check on the same car.

    Overlap is strict (existing.start < new_end AND existing.end > new_start)
    so a booking may start the exact day another ends — same-day handoff.

    Since migration 040 this reads `rentals` alone: a pending rental IS what a
    reservation used to be, so one probe covers both. A booking only holds the
    car while it's live — status 'active' or 'pending' AND not yet returned.
    A CANCELLED booking blocks nothing, which is the point of cancelling.

    `exclude_reservation_id` is accepted for call-site compatibility and treated
    as a rental id, since reservations are now rentals."""
    exclude_id = exclude_rental_id if exclude_rental_id is not None else exclude_reservation_id
    cur.execute(
        """SELECT r.id, r.status, c.name AS client_name, r.start_date, r.end_date
             FROM rentals r
             JOIN clients c ON c.id = r.client_id
            WHERE r.car_vin = %s
              AND r.returned_at IS NULL
              AND r.status IN ('active', 'pending')
              AND r.start_date < %s AND r.end_date > %s
              AND (%s IS NULL OR r.id != %s)
            FOR UPDATE OF r""",
        (car_vin, end_date, start_date, exclude_id, exclude_id),
    )
    overlap = cur.fetchone()
    if overlap:
        verb = ("has a pending booking for" if overlap["status"] == "pending"
                else "is already rented to")
        return (f"This car {verb} {overlap['client_name']} "
                f"from {overlap['start_date']} to {overlap['end_date']}")

    return None


# ---- Booking status (migration 040) ----------------------------------
#
# A booking's life is one column, on both rentals and special_company_rentals:
#   pending    — booked, not started yet (what a reservation used to be)
#   active     — out with the renter
#   cancelled  — called off; the record stays, the car is freed
#
# Status is the BOOKING state and is orthogonal to returned_at: an active
# booking still derives Out / Due today / Overdue / Returned from its dates.
# Only 'active' and 'pending' hold a car — see `_check_car_date_overlap`.
BOOKING_STATUSES = ("active", "pending", "cancelled")


def _validate_status(value, default="active"):
    """Normalise an incoming status. Returns ``(status, error)`` — exactly one
    is None. Blank/absent falls back to `default` so older API clients that
    never send a status keep working unchanged."""
    if value is None or str(value).strip() == "":
        return default, None
    s = str(value).strip().lower()
    if s not in BOOKING_STATUSES:
        return None, (f"Status must be one of: {', '.join(BOOKING_STATUSES)}")
    return s, None


@app.post("/api/rentals")
def create_rental():
    data = request.get_json(force=True)
    miss = _required(data, "client_id", "car_vin", "start_date", "end_date")
    if miss:
        return jsonify({"error": f"Missing: {miss}"}), 400

    car = query("SELECT company_id FROM cars WHERE vin = %s",
                (data["car_vin"],), one=True)
    if not car:
        return jsonify({"error": "Car not found"}), 404
    if not _can_edit_company(int(car["company_id"])):
        return jsonify({"error": "You can only rent your own company's cars"}), 403

    if str(data["end_date"]) < str(data["start_date"]):
        return jsonify({"error": "End date must be on or after the start date"}), 400

    status, status_err = _validate_status(data.get("status"))
    if status_err:
        return jsonify({"error": status_err, "errors": {"status": status_err}}), 400

    # Which pool plate this booking is on. Omitted → NULL (report falls back to
    # the car's own platenumber). A supplied plate must be in the company's pool.
    plate, plate_err = _resolve_booking_plate(int(car["company_id"]), data.get("plate"))
    if plate_err:
        return jsonify({"error": plate_err, "errors": {"plate": plate_err}}), 400

    from db import get_conn
    from psycopg2.extras import RealDictCursor
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            _lock_cars_for_booking(cur, [data["car_vin"]])
            # A cancelled booking holds no car, so it can't clash with anything.
            if status != "cancelled":
                overlap = _check_car_date_overlap(
                    cur, data["car_vin"], data["start_date"], data["end_date"])
                if overlap:
                    return jsonify({"error": overlap}), 409
            cur.execute(
                """INSERT INTO rentals
                     (client_id, car_vin, start_date, end_date, status, plate)
                   VALUES (%s,%s,%s,%s,%s,%s) RETURNING *""",
                (data["client_id"], data["car_vin"],
                 data["start_date"], data["end_date"], status, plate),
            )
            row = cur.fetchone()
    _log_activity(int(car["company_id"]), "create", "rental",
                  f'{_car_label(data["car_vin"])} · {data["start_date"]}→{data["end_date"]} · {status}',
                  ref=f'car:{data["car_vin"]}')
    return jsonify(_clean(row)), 201


@app.patch("/api/rentals/<int:rental_id>/status")
def update_rental_status(rental_id):
    """Move a booking between pending / active / cancelled. This replaces the
    old reservation "Activate" action (which used to delete the reservation and
    insert a rental); the row now just changes status in place.

    Re-checks overlap when a booking (re)claims a car — going active/pending
    from cancelled can clash with something booked in the meantime."""
    data = request.get_json(force=True) or {}
    status, status_err = _validate_status(data.get("status"), default=None)
    if status is None:
        return jsonify({"error": status_err or "Status is required",
                        "errors": {"status": status_err or "Status is required"}}), 400

    row = query(
        """SELECT r.id, r.car_vin, r.status, r.start_date, r.end_date, r.returned_at,
                  c.company_id
             FROM rentals r JOIN cars c ON c.vin = r.car_vin
            WHERE r.id = %s""",
        (rental_id,), one=True)
    if not row:
        return jsonify({"error": "Rental not found"}), 404
    if not _can_edit_company(int(row["company_id"])):
        return jsonify({"error": "You can only change your own company's bookings"}), 403
    if row["returned_at"] is not None:
        return jsonify({"error": "This car has already been returned"}), 409
    if row["status"] == status:
        return jsonify(_clean(row)), 200

    from db import get_conn
    from psycopg2.extras import RealDictCursor
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            _lock_cars_for_booking(cur, [row["car_vin"]])
            if status != "cancelled":
                overlap = _check_car_date_overlap(
                    cur, row["car_vin"], row["start_date"], row["end_date"],
                    exclude_rental_id=rental_id)
                if overlap:
                    return jsonify({"error": overlap}), 409
            cur.execute(
                "UPDATE rentals SET status = %s WHERE id = %s RETURNING *",
                (status, rental_id))
            updated = cur.fetchone()
    _log_activity(int(row["company_id"]), "update", "rental",
                  f'{_car_label(row["car_vin"])} · {row["status"]}→{status}',
                  ref=f'car:{row["car_vin"]}')
    return jsonify(_clean(updated)), 200


def _prepare_booking_rows(rows, company_id, with_notes=False):
    """Shared validation for the rental & reservation batch imports — both book
    one of the company's cars for one of its clients over a date range. Returns
    ``(ok, errors)``: ``ok`` is a list of validated dicts
    (index, client_id, car_vin, start, end [, notes]); ``errors`` is the usual
    ``[{index, errors}]`` list. Runs entirely READ-ONLY — field checks, car
    ownership, client-link, date order, and WITHIN-BATCH per-car date overlap.
    The overlap against ALREADY-COMMITTED bookings is enforced at insert time
    under `_lock_cars_for_booking`, so two concurrent imports of the same car
    can't both slip a clashing row past this check."""
    parsed, errors = [], []
    for i, raw in enumerate(rows):
        if not isinstance(raw, dict):
            errors.append({"index": i, "errors": {"_": "Row must be a JSON object"}}); continue
        row_errs = {}
        try:
            client_id = int(raw.get("client_id"))
        except (TypeError, ValueError):
            client_id = None
            row_errs["client_id"] = "client_id is required (integer)"
        car_vin = (raw.get("car_vin") or "").strip().upper()
        if not car_vin:
            row_errs["car_vin"] = "car_vin is required"
        start = _none_if_blank(raw.get("start_date"))
        end   = _none_if_blank(raw.get("end_date"))
        if not start:
            row_errs["start_date"] = "start_date is required"
        if not end:
            row_errs["end_date"] = "end_date is required"
        if start and end and str(end) < str(start):
            row_errs["end_date"] = "end_date must be on or after start_date"
        if row_errs:
            errors.append({"index": i, "errors": row_errs}); continue
        item = {"index": i, "client_id": client_id, "car_vin": car_vin,
                "start": str(start), "end": str(end)}
        if with_notes:
            item["notes"] = _none_if_blank(raw.get("notes"))
        parsed.append(item)

    # Bulk ownership / link checks — two queries for the whole batch, not 2×N.
    vins = list({p["car_vin"] for p in parsed})
    cids = list({p["client_id"] for p in parsed})
    car_company = {}
    if vins:
        for r in (query("SELECT vin, company_id FROM cars "
                        "WHERE vin = ANY(%s) AND is_active = TRUE", (vins,)) or []):
            car_company[r["vin"]] = r["company_id"]
    linked = set()
    if cids:
        for r in (query("SELECT client_id FROM client_companies "
                        "WHERE company_id = %s AND client_id = ANY(%s)",
                        (company_id, cids)) or []):
            linked.add(r["client_id"])

    # Resolve each row, catching within-batch overlaps on the same car so the
    # DB-level check (which can't see siblings we haven't inserted yet) doesn't
    # have to. `groups[vin]` holds (index, start, end) of accepted rows.
    ok, groups = [], {}
    for p in parsed:
        i, vin = p["index"], p["car_vin"]
        if vin not in car_company:
            errors.append({"index": i, "errors": {
                "car_vin": f"No active car with VIN '{vin}' in your fleet"}}); continue
        if int(car_company[vin]) != int(company_id):
            errors.append({"index": i, "errors": {
                "car_vin": "This car belongs to another company"}}); continue
        if p["client_id"] not in linked:
            errors.append({"index": i, "errors": {
                "client_id": f"Client {p['client_id']} is not one of your clients"}}); continue
        clash = next((j for (j, s, e) in groups.get(vin, [])
                      if s < p["end"] and e > p["start"]), None)
        if clash is not None:
            errors.append({"index": i, "errors": {
                "car_vin": f"Dates overlap another row (index {clash}) for the same car in this batch"}}); continue
        groups.setdefault(vin, []).append((i, p["start"], p["end"]))
        ok.append(p)
    errors.sort(key=lambda e: e["index"])
    return ok, errors


def _booking_overlap_errors(cur, items, **exclude):
    """Under an already-held per-car lock, check each prepared booking against
    committed rentals/reservations. Returns a list of {index, errors} for the
    rows that clash (empty = all clear)."""
    out = []
    for it in items:
        clash = _check_car_date_overlap(cur, it["car_vin"], it["start"], it["end"], **exclude)
        if clash:
            out.append({"index": it["index"], "errors": {"car_vin": clash}})
    return out


@app.post("/api/rentals/batch")
def create_rentals_batch():
    """Bulk-record cars rented to individuals (all-or-nothing). Payload is a
    JSON body OR an uploaded .json file, as a bare array or ``{"rentals": [...]}``.
    Each row books one of YOUR cars for one of YOUR clients over a date range;
    ``company_id`` is never accepted — everything is filed under the caller.

    Every row is validated (car in your fleet, client linked to you, valid
    dates, no within-batch clash) before anything is written. The final
    availability check runs under a per-car lock so simultaneous imports of the
    same car can't double-book it. If ANY row fails, nothing is saved and the
    per-row reasons come back. COMPANY users only (header login or API key)."""
    u = _current_user()
    if not u:
        return jsonify({"error": "Not authenticated"}), 401
    if u.get("role") != "company" or not u.get("company_id"):
        return jsonify({"error": "Only company users can batch-add rentals"}), 403
    company_id = int(u["company_id"])

    rows, err = _batch_rows_from_request("rentals")
    if err:
        return jsonify({"error": err}), 400
    if not rows:
        return jsonify({"error": "No rentals provided"}), 400
    if len(rows) > MAX_BATCH:
        return jsonify({"error": f"Too many rows ({len(rows)}); max {MAX_BATCH} per batch"}), 400

    ok, errors = _prepare_booking_rows(rows, company_id)
    if errors:
        return jsonify({"error": "Batch rejected — fix the listed rows and resubmit.",
                        "inserted": 0, "failed": errors}), 400

    inserted = []
    try:
        with get_conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                _lock_cars_for_booking(cur, [r["car_vin"] for r in ok])
                clashes = _booking_overlap_errors(cur, ok)
                if clashes:
                    return jsonify({
                        "error": "Batch rejected — some cars are already booked for "
                                 "those dates. Nothing was saved.",
                        "inserted": 0, "failed": clashes,
                    }), 409
                inserted = execute_values(
                    cur,
                    """INSERT INTO rentals (client_id, car_vin, start_date, end_date)
                       VALUES %s RETURNING *""",
                    [(r["client_id"], r["car_vin"], r["start"], r["end"]) for r in ok],
                    page_size=len(ok), fetch=True,
                )
    except Exception as e:
        return jsonify({"error": "Insert failed mid-batch — nothing was saved.",
                        "inserted": 0,
                        "failed": [{"index": "?", "errors": {"_": str(e)}}]}), 409

    for row in inserted:
        _log_activity(company_id, "create", "rental",
                      f'{_car_label(row.get("car_vin"))} · {row.get("start_date")}→{row.get("end_date")}',
                      ref=(f'car:{row.get("car_vin")}' if row.get("car_vin") else None))
    return jsonify({"inserted": len(inserted), "rentals": _clean(inserted), "failed": []}), 201


@app.post("/api/rentals/<int:rental_id>/return")
def mark_rental_returned(rental_id):
    """Company received the car back. Stamps returned_at so the car becomes
    available to rent again (the overlap check skips returned rentals) and the
    row drops off the Returns Due tab. The company also picks WHICH branch the
    car came back to (optional ``return_branch_id`` in the body; NULL = the
    head office / Main) — the car is moved to that branch so it's available
    there for the next rental. Only the owning company (or an admin) may do
    this."""
    if not _can_attach_to_rental(rental_id):
        return jsonify({"error": "Not authorized"}), 403
    company_id = _rental_company_id(rental_id)
    # Body is optional (older callers send none); validate the branch belongs
    # to this rental's company, else it resolves to NULL (Main).
    data = request.get_json(silent=True) or {}
    branch_id = _resolve_branch_id(data.get("return_branch_id"), company_id) if company_id else None
    row = execute(
        """UPDATE rentals SET returned_at = NOW(), return_branch_id = %s
            WHERE id = %s AND returned_at IS NULL
        RETURNING *""",
        (branch_id, rental_id), returning=True,
    )
    if not row:
        return jsonify({"error": "Rental not found or already returned"}), 404
    # Move the car to the branch it was returned to (NULL = Main / head office).
    execute("UPDATE cars SET branch_id = %s WHERE vin = %s",
            (branch_id, row["car_vin"]))
    _log_activity(company_id, "update", "rental",
                  f'{_car_label(row["car_vin"])} returned to {_branch_label(branch_id)}',
                  ref=(f'branch:{branch_id}' if branch_id else f'car:{row["car_vin"]}'))
    return jsonify(_clean(row))


@app.post("/api/rentals/<int:rental_id>/extend")
def extend_rental(rental_id):
    """Client keeps the car longer: push the rental's end_date out. Only the
    owning company (or an admin) may do this, the car must still be out
    (returned_at IS NULL), the new date can't move before the start, and it
    must not collide with another booking of the same car (overlap check
    excludes this rental)."""
    if not _can_attach_to_rental(rental_id):
        return jsonify({"error": "Not authorized"}), 403
    data = request.get_json(force=True) or {}
    new_end = _none_if_blank(data.get("end_date"))
    if not new_end:
        return jsonify({"error": "Missing: end_date"}), 400

    existing = query(
        "SELECT car_vin, start_date, end_date, returned_at FROM rentals WHERE id = %s",
        (rental_id,), one=True,
    )
    if not existing:
        return jsonify({"error": "Rental not found"}), 404
    if existing["returned_at"] is not None:
        return jsonify({"error": "This car has already been returned"}), 409
    if str(new_end) < str(existing["start_date"]):
        return jsonify({"error": "New return date must be on or after the start date"}), 400

    company_id = _rental_company_id(rental_id)
    from db import get_conn
    from psycopg2.extras import RealDictCursor
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            _lock_cars_for_booking(cur, [existing["car_vin"]])
            overlap = _check_car_date_overlap(
                cur, existing["car_vin"], str(existing["start_date"]), str(new_end),
                exclude_rental_id=rental_id)
            if overlap:
                return jsonify({"error": overlap}), 409
            cur.execute(
                "UPDATE rentals SET end_date = %s WHERE id = %s RETURNING *",
                (new_end, rental_id),
            )
            row = cur.fetchone()
    _log_activity(company_id, "update", "rental",
                  f'{_car_label(existing["car_vin"])} rental extended {existing["end_date"]}→{new_end}',
                  ref=f'car:{existing["car_vin"]}')
    return jsonify(_clean(row))


# ----------------------- RESERVATIONS (retired — see migration 040) --------
# A reservation was only ever a rental that hadn't started yet, so it is now a
# rental with status 'pending'. The internal list/create/update/delete
# endpoints retired along with the Reservations panel: create a pending booking
# with POST /api/rentals {"status": "pending"} and move it on with
# PATCH /api/rentals/<id>/status.
#
# The two PUBLIC (API-key / Swagger) endpoints kept below stay on their original
# paths and response shapes so existing integrations keep working — they read
# and write pending rentals.
@app.post("/api/reservations/batch")
def create_reservations_batch():
    """Bulk-record reservations — future bookings for your cars (all-or-nothing).
    Payload is a JSON body OR an uploaded .json file, as a bare array or
    ``{"reservations": [...]}``. Each row reserves one of YOUR cars for one of
    YOUR clients over a date range (optional ``notes``); ``company_id`` is never
    accepted.

    Same guarantees as the rentals batch: full validation up front, a per-car
    lock so concurrent imports can't double-book, and nothing saved if any row
    clashes with an existing booking. COMPANY users only.

    Since migration 040 a "reservation" is simply a rental with status
    'pending', so this writes to `rentals`. The endpoint, its payload and its
    response shape are unchanged, so existing integrations keep working."""
    u = _current_user()
    if not u:
        return jsonify({"error": "Not authenticated"}), 401
    if u.get("role") != "company" or not u.get("company_id"):
        return jsonify({"error": "Only company users can batch-add reservations"}), 403
    company_id = int(u["company_id"])

    rows, err = _batch_rows_from_request("reservations")
    if err:
        return jsonify({"error": err}), 400
    if not rows:
        return jsonify({"error": "No reservations provided"}), 400
    if len(rows) > MAX_BATCH:
        return jsonify({"error": f"Too many rows ({len(rows)}); max {MAX_BATCH} per batch"}), 400

    ok, errors = _prepare_booking_rows(rows, company_id, with_notes=True)
    if errors:
        return jsonify({"error": "Batch rejected — fix the listed rows and resubmit.",
                        "inserted": 0, "failed": errors}), 400

    inserted = []
    try:
        with get_conn() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                _lock_cars_for_booking(cur, [r["car_vin"] for r in ok])
                clashes = _booking_overlap_errors(cur, ok)
                if clashes:
                    return jsonify({
                        "error": "Batch rejected — some cars already have a booking "
                                 "for those dates. Nothing was saved.",
                        "inserted": 0, "failed": clashes,
                    }), 409
                inserted = execute_values(
                    cur,
                    """INSERT INTO rentals
                         (car_vin, client_id, start_date, end_date, status)
                       VALUES %s RETURNING *""",
                    [(r["car_vin"], r["client_id"], r["start"], r["end"], "pending")
                     for r in ok],
                    page_size=len(ok), fetch=True,
                )
    except Exception as e:
        return jsonify({"error": "Insert failed mid-batch — nothing was saved.",
                        "inserted": 0,
                        "failed": [{"index": "?", "errors": {"_": str(e)}}]}), 409

    for row in inserted:
        _log_activity(company_id, "create", "reservation",
                      f'{_car_label(row.get("car_vin"))} · {row.get("start_date")}→{row.get("end_date")}',
                      ref=(f'car:{row.get("car_vin")}' if row.get("car_vin") else None))
    return jsonify({"inserted": len(inserted), "reservations": _clean(inserted), "failed": []}), 201


# ----------------------- ADMIN DASHBOARD ---------------------------------
# "Active" = the company logged in OR added data within the last 24h.
# A company is flagged inactive once BOTH login and data go quiet for 72h+.
ACTIVE_WINDOW_HOURS = 24
INACTIVE_THRESHOLD_HOURS = 72


def _dashboard_company_rows():
    """One row per active company with its login + activity timestamps and
    24h create-counts. Shared by the activity feed and the inactive list."""
    return query(
        """
        SELECT co.id, co.companyname, co.phonenumber, co.location,
               co.owner_name,
               u.username, u.last_login, u.created_at AS registered_at,
               (SELECT MAX(a.created_at) FROM activity_log a
                 WHERE a.company_id = co.id) AS last_activity,
               (SELECT COUNT(*) FROM activity_log a
                 WHERE a.company_id = co.id AND a.entity = 'rental'
                   AND a.created_at > NOW() - INTERVAL '24 hours') AS rentals_24h,
               (SELECT COUNT(*) FROM activity_log a
                 WHERE a.company_id = co.id AND a.entity = 'reservation'
                   AND a.created_at > NOW() - INTERVAL '24 hours') AS reservations_24h,
               (SELECT COUNT(*) FROM activity_log a
                 WHERE a.company_id = co.id AND a.entity = 'car'
                   AND a.created_at > NOW() - INTERVAL '24 hours') AS cars_24h,
               (SELECT COUNT(*) FROM activity_log a
                 WHERE a.company_id = co.id AND a.entity = 'client'
                   AND a.created_at > NOW() - INTERVAL '24 hours') AS clients_24h,
               EXISTS(SELECT 1 FROM activity_log a
                       WHERE a.company_id = co.id) AS has_activity
          FROM companies co
          LEFT JOIN users u ON u.company_id = co.id
         WHERE co.is_active = TRUE
         ORDER BY co.companyname
        """
    ) or []


def _last_seen(row):
    """Most recent sign of life: latest of last_login / last_activity."""
    stamps = [d for d in (row.get("last_login"), row.get("last_activity")) if d]
    return max(stamps) if stamps else None


def _hours_since(dt):
    if not dt:
        return None
    return (datetime.now() - dt).total_seconds() / 3600.0


@app.get("/api/dashboard-activity")
def dashboard_activity():
    if not _is_admin_request():
        return jsonify({"error": "Not authorized"}), 403
    out = []
    for r in _dashboard_company_rows():
        seen = _last_seen(r)
        hrs = _hours_since(seen)
        out.append({
            "id": r["id"],
            "companyname": r["companyname"],
            "phonenumber": r["phonenumber"],
            "location": r["location"],
            "owner_name": r["owner_name"],
            "username": r["username"],
            "last_login": r["last_login"].isoformat() if r.get("last_login") else None,
            "last_activity": r["last_activity"].isoformat() if r.get("last_activity") else None,
            "has_activity": bool(r.get("has_activity")),
            "rentals_24h": int(r.get("rentals_24h") or 0),
            "reservations_24h": int(r.get("reservations_24h") or 0),
            "cars_24h": int(r.get("cars_24h") or 0),
            "clients_24h": int(r.get("clients_24h") or 0),
            "active_24h": hrs is not None and hrs <= ACTIVE_WINDOW_HOURS,
        })
    return jsonify(out)


@app.get("/api/inactive-companies")
def inactive_companies():
    if not _is_admin_request():
        return jsonify({"error": "Not authorized"}), 403
    out = []
    for r in _dashboard_company_rows():
        seen = _last_seen(r)
        # Never logged in and never added data → count from registration, so
        # brand-new dormant accounts still surface (and keep counting up).
        idle_since = seen or r.get("registered_at")
        hrs = _hours_since(idle_since)
        if hrs is None or hrs < INACTIVE_THRESHOLD_HOURS:
            continue
        out.append({
            "id": r["id"],
            "companyname": r["companyname"],
            "phonenumber": r["phonenumber"],
            "location": r["location"],
            "owner_name": r["owner_name"],
            "username": r["username"],
            "last_login": r["last_login"].isoformat() if r.get("last_login") else None,
            "has_activity": bool(r.get("has_activity")),
            "hours_inactive": int(hrs),
            "days_inactive": int(hrs // 24),
        })
    out.sort(key=lambda c: c["hours_inactive"], reverse=True)
    return jsonify(out)


@app.get("/api/company-activity/<int:company_id>")
def company_activity(company_id):
    """The timeline of what a single company has been doing — drives the
    click-to-expand view in the admin dashboard."""
    if not _is_admin_request():
        return jsonify({"error": "Not authorized"}), 403
    rows = query(
        """SELECT action, entity, detail, entity_ref, username, created_at
             FROM activity_log
            WHERE company_id = %s
            ORDER BY created_at DESC
            LIMIT 200""",
        (company_id,),
    ) or []
    return jsonify([{
        "action": r["action"],
        "entity": r["entity"],
        "detail": r["detail"],
        "ref": r.get("entity_ref"),
        "username": r["username"],
        "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
    } for r in rows])


def _int_or_none(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


@app.get("/api/admin/audit-log")
def admin_audit_log():
    """The enterprise audit stream — every action every company performs
    (login, logout, create, update, delete of any entity) across the whole
    platform, newest first. Filterable by company / action / entity / free
    text, and keyset-paginated on id so it stays fast at millions of rows.
    Admin-only."""
    if not _is_admin_request():
        return jsonify({"error": "Not authorized"}), 403

    a = request.args
    limit = _int_or_none(a.get("limit")) or 40
    limit = max(1, min(limit, 200))

    where = ["TRUE"]
    params = []
    before_id = _int_or_none(a.get("before_id"))
    if before_id is not None:
        where.append("al.id < %s"); params.append(before_id)
    company_id = _int_or_none(a.get("company_id"))
    if company_id is not None:
        where.append("al.company_id = %s"); params.append(company_id)
    action = (a.get("action") or "").strip()
    if action:
        where.append("al.action = %s"); params.append(action)
    entity = (a.get("entity") or "").strip()
    if entity:
        where.append("al.entity = %s"); params.append(entity)
    q = (a.get("q") or "").strip()
    if q:
        like = f"%{q}%"
        where.append("(al.detail ILIKE %s OR al.username ILIKE %s OR co.companyname ILIKE %s)")
        params += [like, like, like]
    params.append(limit)

    rows = query(
        f"""SELECT al.id, al.company_id, co.companyname, al.username,
                   al.action, al.entity, al.detail, al.entity_ref, al.created_at
              FROM activity_log al
         LEFT JOIN companies co ON co.id = al.company_id
             WHERE {' AND '.join(where)}
          ORDER BY al.id DESC
             LIMIT %s""",
        tuple(params),
    ) or []

    items = [{
        "id": r["id"],
        "company_id": r["company_id"],
        "companyname": r["companyname"],
        "username": r["username"],
        "action": r["action"],
        "entity": r["entity"],
        "detail": r["detail"],
        "ref": r.get("entity_ref"),
        "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
    } for r in rows]
    next_cursor = items[-1]["id"] if len(items) == limit else None
    return jsonify({"items": items, "next_cursor": next_cursor})


@app.get("/api/admin/audit-stats")
def admin_audit_stats():
    """Rolling 24-hour KPIs for the audit dashboard header: how many events,
    logins, records created / edited / deleted, and how many distinct
    companies were active. Admin-only."""
    if not _is_admin_request():
        return jsonify({"error": "Not authorized"}), 403
    row = query(
        """SELECT
             COUNT(*)                                         AS events,
             COUNT(*) FILTER (WHERE action = 'login')         AS logins,
             COUNT(*) FILTER (WHERE action = 'logout')        AS logouts,
             COUNT(*) FILTER (WHERE action = 'create')        AS created,
             COUNT(*) FILTER (WHERE action = 'update')        AS edits,
             COUNT(*) FILTER (WHERE action = 'delete')        AS deletes,
             COUNT(DISTINCT company_id)                       AS companies
           FROM activity_log
          WHERE created_at > NOW() - INTERVAL '24 hours'""",
        one=True,
    ) or {}
    return jsonify({
        "events":    int(row.get("events") or 0),
        "logins":    int(row.get("logins") or 0),
        "logouts":   int(row.get("logouts") or 0),
        "created":   int(row.get("created") or 0),
        "edits":     int(row.get("edits") or 0),
        "deletes":   int(row.get("deletes") or 0),
        "companies": int(row.get("companies") or 0),
    })


@app.get("/api/admin/active-rentals")
def admin_active_rentals():
    """Cars currently rented out to individual clients (not yet returned) —
    the admin's "Cars rented by individuals" view. Columns intentionally mirror
    the B2B "rented by companies" table so the two render identically.
    Admin-only. Bounded so it never loads the whole rentals history.

    `status` is the BOOKING state (pending / active / cancelled) and rides along
    because that table's status column is a picker, not a read-out — without it
    every row would render as the 'active' fallback and flipping one would look
    like a no-op. It stays orthogonal to the returned_at filter above: a booking
    that was never handed over is still un-returned, so pending and cancelled
    rows belong in this list."""
    if not _is_admin_request():
        return jsonify({"error": "Not authorized"}), 403
    rows = query(
        """SELECT rental_id, client_id, client_name, client_father, client_mother,
                  client_personid, client_nationality, client_dob, client_phone,
                  client_licenseid, client_photo,
                  company_id, company_name, company_code, company_phone,
                  company_location, company_x, company_y,
                  car_vin, car_model, car_type, car_color, car_plate, car_has_gps,
                  start_date, end_date, status
             FROM v_client_rentals
            WHERE returned_at IS NULL
            ORDER BY start_date DESC
            LIMIT 1000""",
    ) or []
    return jsonify(_clean(rows))


# ----------------------- CONTACT SUPPORT ---------------------------------
@app.post("/api/support")
def contact_support():
    """Receive a support message (text + optional screenshot). In a real
    deployment this would send an email; here we just acknowledge it."""
    text = (request.form.get("message") or "").strip()
    email = (request.form.get("email") or "").strip()
    if not text:
        return jsonify({"error": "Message is required"}), 400
    # In production: send an email to imadhawara36@gmail.com with the
    # text and any attached screenshots. For now, validate, log and acknowledge.
    MAX_BYTES = 50 * 1024 * 1024  # 50 MB per image
    shots = [f for f in request.files.getlist("screenshot") if f and f.filename]
    for f in shots:
        ctype = (f.mimetype or "")
        if not ctype.startswith("image/"):
            return jsonify({"error": "Only image files are allowed"}), 400
        # Measure size without loading the whole file into memory.
        f.stream.seek(0, os.SEEK_END)
        size = f.stream.tell()
        f.stream.seek(0)
        if size > MAX_BYTES:
            return jsonify({"error": "Each image must be 50 MB or smaller"}), 400
    app.logger.info("Support request from=%s screenshots=%s message=%s",
                    email, [f.filename for f in shots], text[:200])
    return jsonify({"ok": True, "message": "Support request received. We will get back to you soon."})


# THE main reporting query: every client + their rented cars + the company
@app.get("/api/rentals/report")
def rentals_report():
    # Data isolation: a company user only ever sees their own rentals; an
    # admin sees everything. An unauthenticated caller sees nothing.
    u = _current_user()
    if not u:
        return jsonify({"error": "Not authenticated"}), 401
    is_company = u.get("role") == "company" and u.get("company_id")
    scope_sql = " AND company_id = %s" if is_company else ""
    scope_val = (u["company_id"],) if is_company else ()

    client_id = request.args.get("client_id")
    if client_id:
        rows = query(
            "SELECT * FROM v_client_rentals WHERE client_id = %s" + scope_sql +
            " ORDER BY start_date DESC",
            (client_id,) + scope_val,
        )
    else:
        rows = query(
            "SELECT * FROM v_client_rentals WHERE TRUE" + scope_sql +
            " ORDER BY client_name, start_date DESC",
            scope_val,
        )
    return jsonify(_clean(rows))


# ----------------------- EXTERNAL REPORTS (API-key read access) -------
def _report_company(require_data=True):
    """Resolve the company a report request is scoped to and enforce the
    external-API gate. Returns (company_id, error_response). Company users
    (header or API key) read their own data; admins may pass ``company_id``."""
    u = _current_user()
    if not u:
        return None, (jsonify({"error": "Not authenticated"}), 401)
    if u.get("role") == "company" and u.get("company_id"):
        company_id = u["company_id"]
    elif u.get("role") == "admin":
        company_id = request.args.get("company_id")
        if not company_id:
            return None, (jsonify({"error": "company_id required"}), 400)
    else:
        return None, (jsonify({"error": "Not authorized"}), 403)
    if require_data and not _company_has_data(company_id):
        return None, (jsonify({
            "error": "No data for this company yet — add cars, clients, or "
                     "branches before requesting reports.",
        }), 403)
    return company_id, None


@app.get("/api/reports/reservations")
def reservations_report():
    """Reservation report for the calling company — every reservation with its
    client, car, dates, status and the branch the car belongs to. Read-only;
    usable with an API key.

    Since migration 040 a reservation is a rental with status 'pending', so this
    reads `rentals` and returns the bookings that haven't started yet. The row
    shape is unchanged for existing integrations. Note `status` is now the
    booking status ('pending'), where it used to be the reservation status —
    the old 'inactive' value is 'cancelled' now and no longer appears here."""
    company_id, err = _report_company()
    if err:
        return err
    rows = query(
        """SELECT r.id, r.car_vin, r.client_id, r.start_date, r.end_date,
                  r.status, r.notes, r.created_at,
                  c.name  AS client_name, c.phonenumber AS client_phone,
                  ca.model AS car_model,
                  COALESCE(r.plate, ca.platenumber) AS car_plate,
                  ca.branch_id AS car_branch_id,
                  COALESCE(b.branchname, 'Main') AS car_branch_name
             FROM rentals r
             JOIN clients c  ON c.id = r.client_id
             JOIN cars    ca ON ca.vin = r.car_vin
             LEFT JOIN branches b ON b.id = ca.branch_id
            WHERE ca.company_id = %s AND r.status = 'pending'
            ORDER BY r.created_at DESC""",
        (company_id,),
    )
    return jsonify(_clean(rows))


@app.get("/api/reports/cars")
def cars_report():
    """Fleet report for the calling company — every car with the branch it
    currently belongs to (branch_id NULL = the head office, shown as "Main")
    and its last known GPS point. Read-only; usable with an API key.
    Optional ``branch_id`` filters to one branch (``main`` / ``0`` = cars at
    the head office)."""
    company_id, err = _report_company()
    if err:
        return err
    branch_arg = request.args.get("branch_id")
    where = "c.company_id = %s AND c.is_active = TRUE"
    params = [company_id]
    if branch_arg is not None:
        if str(branch_arg).lower() in ("main", "0", ""):
            where += " AND c.branch_id IS NULL"
        else:
            where += " AND c.branch_id = %s"
            params.append(branch_arg)
    rows = query(
        f"""SELECT c.vin, c.type, c.model, c.color, c.platenumber, c.has_gps,
                   c.gps_lat, c.gps_lng, c.gps_updated_at,
                   c.branch_id,
                   COALESCE(b.branchname, 'Main') AS branch_name,
                   b.location AS branch_location
              FROM cars c
              LEFT JOIN branches b ON b.id = c.branch_id
             WHERE {where}
             ORDER BY branch_name, c.model""",
        tuple(params),
    )
    return jsonify(_clean(rows))


@app.get("/api/reports/company-rentals")
def company_rentals_report():
    """B2B report for the calling company — every car it has rented OUT to
    another company ("Cars Rented by Companies"), with the car's detail, the
    rental period, whether it's been returned and to which branch. Read-only;
    usable with an API key."""
    company_id, err = _report_company()
    if err:
        return err
    rows = query(
        """SELECT s.id, s.company_name, s.owner_name, s.location,
                  s.phones, s.branches, s.start_date, s.end_date, s.notes,
                  s.car_vin, s.returned_at, s.return_branch_id,
                  rb.branchname AS return_branch_name,
                  c.model AS car_model, c.type AS car_type, c.color AS car_color,
                  COALESCE(s.plate, c.platenumber) AS car_plate, c.has_gps AS car_has_gps,
                  c.branch_id AS car_branch_id,
                  COALESCE(cb.branchname, 'Main') AS car_branch_name
             FROM special_company_rentals s
             LEFT JOIN cars c      ON c.vin = s.car_vin AND c.company_id = s.company_id
             LEFT JOIN branches rb ON rb.id = s.return_branch_id
             LEFT JOIN branches cb ON cb.id = c.branch_id
            WHERE s.company_id = %s
            ORDER BY s.created_at DESC""",
        (company_id,),
    )
    return jsonify(_clean(rows))


@app.get("/api/reports/rentals")
def external_rentals_report():
    """Rental report for the calling company — every rental with its client,
    car and dates. Read-only; usable with an API key. Optional ``client_id``
    filters to one client."""
    company_id, err = _report_company()
    if err:
        return err
    client_id = request.args.get("client_id")
    if client_id:
        rows = query(
            "SELECT * FROM v_client_rentals WHERE company_id = %s AND client_id = %s "
            "ORDER BY start_date DESC",
            (company_id, client_id),
        )
    else:
        rows = query(
            "SELECT * FROM v_client_rentals WHERE company_id = %s "
            "ORDER BY client_name, start_date DESC",
            (company_id,),
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


def _remove_media_file(rental_id, filename):
    """Best-effort delete of one media file from disk. Missing files and
    permission errors are ignored so a stale file never blocks the DB row
    from being removed."""
    path = os.path.join(MEDIA_ROOT, str(rental_id), filename)
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        pass


def _delete_media_rows(rows):
    """Delete the given rental_media rows (list of dicts with id/rental_id/
    filename) from both disk and the DB."""
    if not rows:
        return
    for r in rows:
        _remove_media_file(r["rental_id"], r["filename"])
    execute("DELETE FROM rental_media WHERE id = ANY(%s)",
            ([r["id"] for r in rows],))


def _purge_expired_media():
    """Retention rule: a car's photos/videos live only until the car is back
    with the company — rental end_date + 24h, i.e. any calendar day after
    end_date. Past that they're removed from disk and the DB. Run lazily when
    media is listed/uploaded, so expired files drop out of the report the next
    time it's opened (the app has no background scheduler)."""
    rows = query(
        """SELECT m.id, m.rental_id, m.filename
             FROM rental_media m
             JOIN rentals r ON r.id = m.rental_id
            WHERE r.end_date < CURRENT_DATE""",
    ) or []
    _delete_media_rows(rows)


def _purge_other_media_for_vin(rental_id, keep_media_id):
    """Keep only the newest media file per car: after a new upload, delete
    every other photo/video tied to the same car VIN (across all of that
    car's rentals), leaving just the file that was just uploaded."""
    rows = query(
        """SELECT m.id, m.rental_id, m.filename
             FROM rental_media m
             JOIN rentals r   ON r.id = m.rental_id
             JOIN rentals cur ON cur.id = %s
            WHERE r.car_vin = cur.car_vin
              AND m.id <> %s""",
        (rental_id, keep_media_id),
    ) or []
    _delete_media_rows(rows)


@app.get("/api/rentals/<int:rental_id>/media")
def list_rental_media(rental_id):
    if not _can_attach_to_rental(rental_id):
        return jsonify({"error": "Not authorized"}), 403
    # Lazy retention sweep: clear any media whose car has been returned.
    _purge_expired_media()
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
    # Retention rules: keep only this newest file for the car's VIN, and
    # sweep out any media whose car has already been returned.
    _purge_other_media_for_vin(rental_id, row["id"])
    _purge_expired_media()
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
    _remove_media_file(rental_id, row["filename"])
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


# ---------- SPECIAL-RENTAL MEDIA (B2B car photos + videos) ------------
def _can_attach_to_special(special_id: int) -> bool:
    """True when the current user owns the B2B record's company."""
    row = query(
        "SELECT company_id FROM special_company_rentals WHERE id = %s",
        (special_id,), one=True,
    )
    if not row:
        return False
    return _can_edit_company(row["company_id"])


@app.get("/api/special-rentals/<int:special_id>/media")
def list_special_media(special_id):
    if not _can_attach_to_special(special_id):
        return jsonify({"error": "Not authorized"}), 403
    rows = query(
        "SELECT id, kind, filename, original_name, mime, uploaded_at, uploaded_by "
        "FROM special_rental_media WHERE special_rental_id = %s "
        "ORDER BY uploaded_at DESC",
        (special_id,),
    ) or []
    for r in rows:
        r["url"] = f"/uploads/special_rental_media/{special_id}/{r['filename']}"
    return jsonify(_clean(rows))


@app.post("/api/special-rentals/<int:special_id>/media")
def upload_special_media(special_id):
    if not _can_attach_to_special(special_id):
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
    rec_dir = os.path.join(SPECIAL_MEDIA_ROOT, str(special_id))
    os.makedirs(rec_dir, exist_ok=True)
    f.save(os.path.join(rec_dir, fname))

    user = _current_user() or {}
    row = execute(
        """INSERT INTO special_rental_media
             (special_rental_id, kind, filename, original_name, mime, uploaded_by)
           VALUES (%s,%s,%s,%s,%s,%s) RETURNING *""",
        (special_id, kind, fname, f.filename, mime, user.get("username")),
        returning=True,
    )
    row["url"] = f"/uploads/special_rental_media/{special_id}/{fname}"
    return jsonify(_clean(row)), 201


@app.delete("/api/special-rentals/<int:special_id>/media/<int:media_id>")
def delete_special_media(special_id, media_id):
    if not _can_attach_to_special(special_id):
        return jsonify({"error": "Not authorized"}), 403
    row = query(
        "SELECT filename FROM special_rental_media "
        "WHERE id = %s AND special_rental_id = %s",
        (media_id, special_id), one=True,
    )
    if not row:
        return jsonify({"error": "Not found"}), 404
    path = os.path.join(SPECIAL_MEDIA_ROOT, str(special_id), row["filename"])
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        pass
    execute("DELETE FROM special_rental_media WHERE id = %s", (media_id,))
    return ("", 204)


@app.get("/uploads/special_rental_media/<int:special_id>/<path:filename>")
def serve_special_media(special_id, filename):
    """Static-serve a B2B record's photo/video (see serve_rental_media)."""
    return send_from_directory(
        os.path.join(SPECIAL_MEDIA_ROOT, str(special_id)),
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

    # Data isolation: company users may only export their own rentals.
    u = _current_user()
    if not u:
        return jsonify({"error": "Not authenticated"}), 401
    is_company = u.get("role") == "company" and u.get("company_id")
    scope_sql = " AND company_id = %s" if is_company else ""
    scope_val = (u["company_id"],) if is_company else ()

    if rental_id:
        row = query(
            "SELECT * FROM v_client_rentals WHERE rental_id = %s" + scope_sql,
            (rental_id,) + scope_val,
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
            "SELECT * FROM v_client_rentals WHERE TRUE" + scope_sql +
            " ORDER BY client_name, start_date DESC",
            scope_val,
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
