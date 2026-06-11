"""Live end-to-end check of the batch API against a RUNNING local server.

WHAT IT DOES — confirms the whole chain works (server up, API-key generation,
key authentication, validation, all-or-nothing) WITHOUT inserting any cars,
clients, or branches into your database: every batch it sends is intentionally
invalid, so the all-or-nothing rule saves nothing. The only thing it writes is
the test company's API key (which it prints how to revoke at the end).

HOW TO RUN (two terminals):

  1) Start the server:
       & '.\\.venv\\Scripts\\python.exe' app.py
  2) In another terminal, from backend/:
       & '.\\.venv\\Scripts\\python.exe' live_check.py

Optional env overrides: BASE_URL, TEST_COMPANY_ID, ADMIN_USER.
"""
import os
import sys

import requests

BASE       = os.getenv("BASE_URL", "http://localhost:5000")
COMPANY_ID = int(os.getenv("TEST_COMPANY_ID", "12"))
ADMIN      = os.getenv("ADMIN_USER", "admin")

_PASS = 0
_FAIL = 0


def check(name, cond, extra=""):
    global _PASS, _FAIL
    ok = bool(cond)
    _PASS += ok
    _FAIL += (not ok)
    tail = f"  ({extra})" if (extra and not ok) else ""
    print(f"  {'ok  ' if ok else 'FAIL'} {name}{tail}")


def main():
    print(f"Target: {BASE}  (test company_id={COMPANY_ID}, admin='{ADMIN}')\n")

    try:
        requests.get(BASE + "/", timeout=5)
    except Exception as e:
        print(f"Server not reachable at {BASE} — start it first (python app.py).\n  {e}")
        sys.exit(2)

    # 1) No key -> 401
    r = requests.post(BASE + "/api/cars/batch", json=[{"vin": "x"}], timeout=10)
    check("no API key is rejected (401)", r.status_code == 401, f"got {r.status_code}")

    # 2) Wrong key -> 401
    r = requests.post(BASE + "/api/cars/batch", json=[{"vin": "x"}],
                      headers={"Authorization": "Bearer crk_wrong"}, timeout=10)
    check("invalid API key is rejected (401)", r.status_code == 401, f"got {r.status_code}")

    # 3) Admin generates a key for the test company
    r = requests.post(BASE + "/api/api-key", json={"company_id": COMPANY_ID},
                      headers={"X-Auth-User": ADMIN}, timeout=10)
    if r.status_code != 201:
        check("admin can generate a company API key (201)", False,
              f"got {r.status_code}: {r.text[:160]}")
        if "api_key_hash" in r.text or r.status_code == 500:
            print("\n>> Looks like migration 022 isn't applied. Run it once:")
            print("   & '.\\.venv\\Scripts\\python.exe' migrate.py")
        sys.exit(1)
    key = (r.json() or {}).get("api_key")
    check("admin can generate a company API key (201)", bool(key))

    # 4) Valid key authenticates, but an INVALID car row -> 400, nothing saved
    r = requests.post(
        BASE + "/api/cars/batch",
        json=[{"vin": "TOOSHORT", "type": "Sedan", "model": "X",
               "color": "White", "platenumber": "M 1"}],
        headers={"Authorization": f"Bearer {key}"}, timeout=30,
    )
    check("valid key authenticates; bad row -> 400 (nothing saved)",
          r.status_code == 400, f"got {r.status_code}")
    check("rejection lists the bad row", bool((r.json() or {}).get("failed")))

    # 5) Unified endpoint reachable + validating (empty payload -> 400)
    r = requests.post(BASE + "/api/batch", json={"cars": [], "clients": [], "branches": []},
                      headers={"Authorization": f"Bearer {key}"}, timeout=10)
    check("/api/batch reachable, empty payload -> 400", r.status_code == 400, f"got {r.status_code}")

    print(f"\n{_PASS} passed, {_FAIL} failed")
    print("\nNo cars/clients/branches were inserted. To revoke the test key:")
    print(f'  curl -X DELETE {BASE}/api/api-key -H "X-Auth-User: {ADMIN}" '
          f'-H "Content-Type: application/json" -d "{{\\"company_id\\": {COMPANY_ID}}}"')
    sys.exit(1 if _FAIL else 0)


if __name__ == "__main__":
    main()
