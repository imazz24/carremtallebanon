"""Dependency-free smoke tests for the batch-insert endpoints.

The project has no pytest in its requirements, so this runs as a plain script:

    cd backend && python test_batch.py

It exercises the real Flask handlers through `app.test_client()` but swaps the
database and the NHTSA network call for in-memory fakes, so it needs neither a
Postgres nor internet access. Exits non-zero on the first failed assertion so
it can be wired into CI next to the import smoke check.
"""
import contextlib
import io
import json

import app

# A pair of structurally valid VINs (drawn from the app's own KNOWN_VINS, so
# they pass vininfo). The batch path uses enforce_check_digit=False anyway.
VIN_A = "1HGCM82633A004352"
VIN_B = "1HGBH41JXMN109186"

COMPANY_USER = {"id": 7, "username": "beirut_cars", "role": "company", "company_id": 1}
ADMIN_USER   = {"id": 1, "username": "admin", "role": "admin", "company_id": None}

# Which user the patched _current_user() returns for the next request.
_CURRENT = [COMPANY_USER]


# --------------------------- in-memory fakes --------------------------------
class _FakeCursor:
    def __init__(self, store):
        self.store = store
        self._last = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        s = " ".join(sql.split()).upper()
        params = params or ()
        if s.startswith("INSERT INTO CARS"):
            self.store["id"] += 1
            self._last = {"id": self.store["id"], "company_id": params[6],
                          "model": params[2], "platenumber": params[4]}
            self.store["cars"].append(params)
        elif s.startswith("INSERT INTO CLIENTS"):
            self.store["id"] += 1
            self._last = {"id": self.store["id"], "name": params[1], "licenseid": params[7]}
            self.store["clients"].append(params)
        elif s.startswith("INSERT INTO BRANCHES"):
            self.store["id"] += 1
            self._last = {"id": self.store["id"], "company_id": params[0],
                          "branchname": params[1], "location": params[2]}
            self.store["branches"].append(params)
        else:
            # client_companies link, UPDATE clients, etc. — no return value used.
            self._last = None

    def fetchone(self):
        return self._last


class _FakeConn:
    def __init__(self, store):
        self.store = store

    def cursor(self, *a, **k):
        return _FakeCursor(self.store)


STORE = {"id": 0, "cars": [], "clients": [], "branches": []}


@contextlib.contextmanager
def _fake_get_conn():
    yield _FakeConn(STORE)


# The real _current_user, kept so the API-key auth path can be exercised
# end-to-end (the happy-path tests stub _current_user out for speed).
_REAL_CURRENT_USER = app._current_user
# The real (cached) NHTSA front, kept so the cache behaviour can be tested.
_REAL_DECODE_NHTSA = app._decode_vin_nhtsa


def _install_fakes():
    """Patch the app module's DB + network seams with in-memory fakes."""
    app._current_user = lambda: _CURRENT[0]
    # Every uniqueness / existing-client lookup reports "nothing there".
    app.query = lambda *a, **k: None
    # Insert/log helpers become no-ops; batch paths use get_conn directly.
    app.execute = lambda *a, **k: None
    app.get_conn = _fake_get_conn
    # Skip the real NHTSA round-trip — soft-pass every VIN.
    app._decode_vin_nhtsa = lambda vin: (None, None)


# ------------------------------- harness ------------------------------------
_PASS = 0
_FAIL = 0


def check(name, cond):
    global _PASS, _FAIL
    if cond:
        _PASS += 1
        print(f"  ok   {name}")
    else:
        _FAIL += 1
        print(f"  FAIL {name}")


def post(client, path, body, user=COMPANY_USER):
    _CURRENT[0] = user
    STORE.update({"id": 0, "cars": [], "clients": [], "branches": []})
    r = client.post(path, data=json.dumps(body),
                    content_type="application/json",
                    headers={"X-Auth-User": user["username"] if user else ""})
    payload = r.get_json(silent=True) or {}
    return r.status_code, payload


def post_file(client, path, body, user=COMPANY_USER, filename="data.json"):
    """Upload `body` as a JSON file in the multipart `file` field."""
    _CURRENT[0] = user
    STORE.update({"id": 0, "cars": [], "clients": [], "branches": []})
    data = {"file": (io.BytesIO(json.dumps(body).encode("utf-8")), filename)}
    r = client.post(path, data=data, content_type="multipart/form-data",
                    headers={"X-Auth-User": user["username"] if user else ""})
    return r.status_code, (r.get_json(silent=True) or {})


def car(vin, plate="M 12345", **over):
    row = {"vin": vin, "type": "Sedan", "model": "Honda Accord",
           "color": "White", "platenumber": plate}
    row.update(over)
    return row


def main():
    _install_fakes()
    c = app.app.test_client()

    # ---- cars ----
    code, body = post(c, "/api/cars/batch", [car(VIN_A), car(VIN_B, plate="B 67890")])
    check("cars: two valid rows -> 201 inserted 2",
          code == 201 and body.get("inserted") == 2 and len(STORE["cars"]) == 2)

    code, body = post(c, "/api/cars/batch", [car(VIN_A)], user=ADMIN_USER)
    check("cars: admin is rejected with 403",
          code == 403 and STORE["cars"] == [])

    code, body = post(c, "/api/cars/batch", {"cars": [car(VIN_A), car("SHORTVIN")]})
    check("cars: one bad VIN -> 400 all-or-nothing, nothing inserted",
          code == 400 and body.get("inserted") == 0 and STORE["cars"] == []
          and any(e["index"] == 1 for e in body.get("failed", [])))

    # Anti-fake: structurally valid VIN but a wrong check digit (a typo or
    # fabricated VIN) must be rejected, never stored.
    code, body = post(c, "/api/cars/batch", [car("1HGCM82633A004353")])
    check("cars: bad check digit rejected (no fake VINs) -> 400",
          code == 400 and STORE["cars"] == []
          and any("check digit" in str(e["errors"]).lower() for e in body.get("failed", [])))

    code, body = post(c, "/api/cars/batch",
                      [car(VIN_A, plate="M 11111"), car(VIN_A, plate="M 22222")])
    check("cars: duplicate VIN within batch -> 400",
          code == 400 and any("Duplicate VIN" in str(e["errors"]) for e in body.get("failed", [])))

    code, body = post(c, "/api/cars/batch", [])
    check("cars: empty array -> 400", code == 400)

    # ---- clients ----
    code, body = post(c, "/api/clients/batch",
                      {"clients": [{"licenseid": "L1", "name": "Sami", "id_type": "license"},
                                   {"licenseid": "L2", "personid": "P2",
                                    "id_type": "national_id", "name": "Rana"}]})
    check("clients: two valid rows -> 201 inserted 2",
          code == 201 and body.get("inserted") == 2 and len(STORE["clients"]) == 2)

    code, body = post(c, "/api/clients/batch", [{"name": "NoLicense"}])
    check("clients: missing licenseid -> 400",
          code == 400 and STORE["clients"] == [])

    code, body = post(c, "/api/clients/batch",
                      [{"licenseid": "national-only", "id_type": "national_id"}])
    check("clients: national_id without personid -> 400",
          code == 400 and STORE["clients"] == [])

    code, body = post(c, "/api/clients/batch", [{"licenseid": "L1"}], user=ADMIN_USER)
    check("clients: admin is rejected with 403", code == 403)

    # ---- branches ----
    code, body = post(c, "/api/branches/batch",
                      [{"branchname": "Hamra", "location": "Beirut"}])
    check("branches: one valid row -> 201 inserted 1",
          code == 201 and body.get("inserted") == 1 and len(STORE["branches"]) == 1)

    code, body = post(c, "/api/branches/batch", [{"branchname": "NoLocation"}])
    check("branches: missing location -> 400",
          code == 400 and STORE["branches"] == [])

    code, body = post(c, "/api/branches/batch",
                      [{"branchname": "X", "location": "Y"}], user=ADMIN_USER)
    check("branches: admin is rejected with 403", code == 403)

    # ---- JSON file upload (multipart "file" field) ----
    code, body = post_file(c, "/api/cars/batch", [car(VIN_A), car(VIN_B, plate="B 67890")])
    check("cars: JSON file upload -> 201 inserted 2",
          code == 201 and body.get("inserted") == 2 and len(STORE["cars"]) == 2)

    code, body = post_file(c, "/api/clients/batch",
                           {"clients": [{"licenseid": "F1", "id_type": "license"}]})
    check("clients: JSON file upload (wrapped) -> 201 inserted 1",
          code == 201 and body.get("inserted") == 1)

    code, body = post_file(c, "/api/cars/batch", [car(VIN_A)], user=ADMIN_USER)
    check("cars: admin file upload is still rejected with 403", code == 403)

    # A file whose bytes aren't valid JSON is a clean 400, not a crash.
    _CURRENT[0] = COMPANY_USER
    bad = {"file": (io.BytesIO(b"{not json"), "broken.json")}
    r = c.post("/api/cars/batch", data=bad, content_type="multipart/form-data",
               headers={"X-Auth-User": "beirut_cars"})
    check("cars: malformed JSON file -> 400", r.status_code == 400)

    # ---- unified /api/batch (cars + clients + branches in one payload) ----
    code, body = post(c, "/api/batch", {
        "cars":     [car(VIN_A), car(VIN_B, plate="B 67890")],
        "clients":  [{"licenseid": "U1", "id_type": "license"}],
        "branches": [{"branchname": "Hamra", "location": "Beirut"}],
    })
    check("batch: all three sections -> 201",
          code == 201
          and body.get("cars", {}).get("inserted") == 2
          and body.get("clients", {}).get("inserted") == 1
          and body.get("branches", {}).get("inserted") == 1
          and len(STORE["cars"]) == 2 and len(STORE["clients"]) == 1
          and len(STORE["branches"]) == 1)

    code, body = post(c, "/api/batch", {
        "cars":     [car(VIN_A)],
        "branches": [{"branchname": "NoLocation"}],   # invalid → whole import fails
    })
    check("batch: one bad row anywhere -> 400, nothing saved",
          code == 400 and STORE["cars"] == [] and STORE["branches"] == []
          and body.get("failed", {}).get("branches"))

    code, body = post(c, "/api/batch", {"cars": [], "clients": [], "branches": []})
    check("batch: all sections empty -> 400", code == 400)

    code, body = post(c, "/api/batch", [car(VIN_A)])  # array, not object
    check("batch: non-object body -> 400", code == 400)

    code, body = post(c, "/api/batch", {"cars": [car(VIN_A)]}, user=ADMIN_USER)
    check("batch: admin is rejected with 403", code == 403)

    code, body = post_file(c, "/api/batch",
                           {"branches": [{"branchname": "B1", "location": "L1"}]})
    check("batch: JSON file upload -> 201",
          code == 201 and body.get("branches", {}).get("inserted") == 1)

    # ---- API-key generation endpoints (company user via stubbed _current_user) ----
    _CURRENT[0] = COMPANY_USER
    r = c.post("/api/api-key", headers={"X-Auth-User": "beirut_cars"})
    kb = r.get_json(silent=True) or {}
    check("api-key: company can generate -> 201, crk_ key returned once",
          r.status_code == 201 and str(kb.get("api_key", "")).startswith("crk_")
          and kb.get("prefix"))

    r = c.delete("/api/api-key", headers={"X-Auth-User": "beirut_cars"})
    check("api-key: company can revoke -> 204", r.status_code == 204)

    _CURRENT[0] = None
    r = c.post("/api/api-key")
    check("api-key: unauthenticated generate -> 401", r.status_code == 401)

    # ---- API-key AUTH path (real _current_user + key lookup) ----
    app._current_user = _REAL_CURRENT_USER
    raw = "crk_unit_test_key"
    key_hash = app._sha256(raw)

    def smart_query(sql, params=None, one=False):
        s = " ".join((sql or "").split()).upper()
        if "API_KEY_HASH" in s and params and params[0] == key_hash:
            return {"id": 7, "username": "beirut_cars", "role": "company", "company_id": 1}
        return None   # all uniqueness / existing-client lookups: nothing there

    app.query = smart_query
    STORE.update({"id": 0, "cars": [], "clients": [], "branches": []})
    r = c.post("/api/cars/batch", data=json.dumps([car(VIN_A)]),
               content_type="application/json",
               headers={"Authorization": f"Bearer {raw}"})
    check("api-key: valid Bearer key authenticates a batch -> 201",
          r.status_code == 201 and len(STORE["cars"]) == 1)

    STORE.update({"id": 0, "cars": [], "clients": [], "branches": []})
    r = c.post("/api/cars/batch", data=json.dumps([car(VIN_A)]),
               content_type="application/json",
               headers={"X-API-Key": raw})
    check("api-key: X-API-Key header also works -> 201", r.status_code == 201)

    r = c.post("/api/cars/batch", data=json.dumps([car(VIN_A)]),
               content_type="application/json",
               headers={"Authorization": "Bearer crk_wrong"})
    check("api-key: wrong key -> 401", r.status_code == 401)

    # restore the fast stubs in case more tests are appended later
    app._current_user = lambda: _CURRENT[0]
    app.query = lambda *a, **k: None

    # ---- NHTSA cache: a repeat VIN lookup skips the network ----
    app._decode_vin_nhtsa = _REAL_DECODE_NHTSA
    app._nhtsa_cache.clear()
    calls = {"n": 0}

    def counting_net(vin):
        calls["n"] += 1
        return ("Accord", "Sedan")

    app._decode_vin_nhtsa_network = counting_net
    r1 = app._decode_vin_nhtsa("CACHEVIN000000001")
    r2 = app._decode_vin_nhtsa("CACHEVIN000000001")
    check("nhtsa cache: repeat VIN served from cache (1 network call)",
          r1 == ("Accord", "Sedan") and r2 == r1 and calls["n"] == 1)
    app._decode_vin_nhtsa = lambda vin: (None, None)

    print(f"\n{_PASS} passed, {_FAIL} failed")
    raise SystemExit(1 if _FAIL else 0)


if __name__ == "__main__":
    main()
