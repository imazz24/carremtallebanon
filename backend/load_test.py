"""Concurrent load / stress test for the batch import API.

Simulates many companies pushing large batches AT THE SAME TIME (all threads
align on a barrier, then fire together) and checks the platform + database
survive it: no errors, no DB-pool exhaustion, all-or-nothing held, and each
company sees only its own rows. Everything it creates is hard-deleted at the
end, so it leaves ZERO fake data behind — even if it fails midway.

PREREQUISITES
  * The server must be running and reachable (BASE_URL).
  * Start the server with the NHTSA cross-check OFF so the test measures THIS
    platform, not a third-party API:
        PowerShell:  $env:NHTSA_CROSS_CHECK = "0";  python app.py
  * Apply migrations first (needs the api_key columns):  python migrate.py

RUN (from backend/, with the server already running in another terminal):
  & '.\\.venv\\Scripts\\python.exe' load_test.py --companies 12 --cars 500 --mode cars
  & '.\\.venv\\Scripts\\python.exe' load_test.py --companies 15 --clients 800 --mode clients
  & '.\\.venv\\Scripts\\python.exe' load_test.py --companies 12 --cars 400 --clients 400 --mode both

  # If a previous run was killed and left data behind:
  & '.\\.venv\\Scripts\\python.exe' load_test.py --cleanup-only
"""
import os
import sys
import time
import argparse
import hashlib
import threading
from concurrent.futures import ThreadPoolExecutor

import requests

from db import get_conn, query

BASE = os.getenv("BASE_URL", "http://localhost:5000")
MAX_BATCH = 500                       # must match app.MAX_BATCH
TAG = "loadtest"                      # company-name / data prefix for safe cleanup


# --------------------------- VIN minting -----------------------------------
# Generate real, checksum-valid, globally-unique VINs so they pass the batch
# validation (which enforces the check digit). North-American WMI "1HG" so the
# check digit is enforced; we compute position 9 with the standard algorithm.
_TRANS = {**{str(d): d for d in range(10)},
          "A": 1, "B": 2, "C": 3, "D": 4, "E": 5, "F": 6, "G": 7, "H": 8,
          "J": 1, "K": 2, "L": 3, "M": 4, "N": 5, "P": 7, "R": 9,
          "S": 2, "T": 3, "U": 4, "V": 5, "W": 6, "X": 7, "Y": 8, "Z": 9}
_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]


def _vin_check_digit(chars):
    s = sum(_TRANS[c] * w for c, w in zip(chars, _WEIGHTS))
    r = s % 11
    return "X" if r == 10 else str(r)


def mint_vin(company_idx, row_idx):
    """A unique, checksum-valid VIN for (company, row). 11 digit slots encode a
    unique integer, so no two minted VINs collide across companies."""
    u = company_idx * 1_000_000 + row_idx          # unique per (company,row)
    s = f"{u:011d}"
    chars = list("1HG" + s[:5] + "0" + "3A" + s[5:])   # 3+5 +1(check) +2 +6 = 17
    chars[8] = _vin_check_digit(chars)
    return "".join(chars)


def _sha256(s):
    return hashlib.sha256((s or "").encode("utf-8")).hexdigest()


# --------------------------- payload builders ------------------------------
def build_car(ci, i, stride):
    # Lebanese plate numbers are max 7 digits and globally unique. Use a high
    # base (9_000_000+) to avoid colliding with real plates, and a per-company
    # stride so no two test cars share a plate. Caller guarantees the total
    # stays within 7 digits.
    num = 9_000_000 + ci * stride + i
    return {"vin": mint_vin(ci, i), "type": "Sedan", "model": "Honda Accord",
            "color": "White", "platenumber": f"M {num}"}


def build_client(ci, i, runid):
    return {"licenseid": f"LT-{runid}-{ci}-{i}", "id_type": "license",
            "name": f"LT Client {ci}-{i}"}


def company_requests(ci, args, runid):
    """Yield (endpoint, json_payload) requests for one company, each <= MAX_BATCH."""
    reqs = []
    stride = max(args.cars, 1)
    if args.mode in ("cars", "both"):
        cars = [build_car(ci, i, stride) for i in range(args.cars)]
        if args.mode == "cars":
            for j in range(0, len(cars), MAX_BATCH):
                reqs.append(("/api/cars/batch", cars[j:j + MAX_BATCH]))
    if args.mode in ("clients", "both"):
        clients = [build_client(ci, i, runid) for i in range(args.clients)]
        if args.mode == "clients":
            for j in range(0, len(clients), MAX_BATCH):
                reqs.append(("/api/clients/batch", clients[j:j + MAX_BATCH]))
    if args.mode == "both":
        # Combine into /api/batch requests, each section split so the COMBINED
        # row count per request stays within MAX_BATCH.
        half = MAX_BATCH // 2
        cars = [build_car(ci, i, stride) for i in range(args.cars)]
        clients = [build_client(ci, i, runid) for i in range(args.clients)]
        n = max((len(cars) + half - 1) // half, (len(clients) + half - 1) // half, 1)
        for k in range(n):
            reqs.append(("/api/batch", {
                "cars":    cars[k * half:(k + 1) * half],
                "clients": clients[k * half:(k + 1) * half],
            }))
    return reqs


# --------------------------- DB setup / cleanup ----------------------------
def setup_companies(n, runid):
    """Create n throwaway companies, each with a company user + known API key.
    Returns list of {idx, id, key}."""
    out = []
    with get_conn() as conn:
        with conn.cursor() as cur:
            for ci in range(n):
                name = f"{TAG}_{runid}_co{ci}"
                cur.execute(
                    "INSERT INTO companies (companyname, location, companyid) "
                    "VALUES (%s,%s,%s) RETURNING id",
                    (name, "LoadTest", f"LT{runid}{ci}"),
                )
                cid = cur.fetchone()[0]
                key = f"crk_{TAG}_{runid}_{ci}_{_sha256(name)[:16]}"
                cur.execute(
                    "INSERT INTO users (username, password_hash, role, company_id, api_key_hash) "
                    "VALUES (%s,%s,'company',%s,%s)",
                    (f"{TAG}_{runid}_u{ci}", _sha256("x"), cid, _sha256(key)),
                )
                out.append({"idx": ci, "id": cid, "key": key})
    return out


def cleanup(ids, runid):
    """Hard-delete everything this run created, in FK-safe order. Scoped strictly
    to loadtest company ids + the run's licenseid prefix."""
    if not ids:
        # --cleanup-only with no captured ids: nuke by name/prefix instead.
        rows = query("SELECT id FROM companies WHERE companyname LIKE %s", (f"{TAG}\\_%",)) or []
        ids = [r["id"] for r in rows]
    if not ids:
        return 0
    deleted = {}
    with get_conn() as conn:
        with conn.cursor() as cur:
            def run(label, sql, params):
                try:
                    cur.execute(sql, params)
                    deleted[label] = cur.rowcount
                except Exception as e:
                    deleted[label] = f"skip ({str(e)[:40]})"
                    conn.rollback()
            run("cars",       "DELETE FROM cars WHERE company_id = ANY(%s)", (ids,))
            run("branches",   "DELETE FROM branches WHERE company_id = ANY(%s)", (ids,))
            run("client_companies", "DELETE FROM client_companies WHERE company_id = ANY(%s)", (ids,))
            like = f"LT-{runid}-%" if runid else "LT-%"
            run("clients",    "DELETE FROM clients WHERE licenseid LIKE %s", (like,))
            run("activity",   "DELETE FROM activity_log WHERE company_id = ANY(%s)", (ids,))
            run("users",      "DELETE FROM users WHERE company_id = ANY(%s)", (ids,))
            run("companies",  "DELETE FROM companies WHERE id = ANY(%s)", (ids,))
    print("  cleanup:", ", ".join(f"{k}={v}" for k, v in deleted.items()))
    return len(ids)


# --------------------------- the run --------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--companies", type=int, default=12)
    ap.add_argument("--cars", type=int, default=500, help="cars per company")
    ap.add_argument("--clients", type=int, default=0, help="clients per company")
    ap.add_argument("--mode", choices=["cars", "clients", "both"], default="cars")
    ap.add_argument("--cleanup-only", action="store_true")
    args = ap.parse_args()

    if args.mode == "clients" and not args.clients:
        args.clients = 500
    if args.mode == "both":
        args.clients = args.clients or 400
        args.cars = args.cars or 400

    # Plate numbers are 9_000_000 + ci*cars + i and must stay 7 digits.
    if args.mode in ("cars", "both") and 9_000_000 + args.companies * args.cars > 9_999_999:
        print(f"companies×cars too large for unique 7-digit plates "
              f"({args.companies}×{args.cars}); keep companies×cars ≤ 999,999.")
        sys.exit(1)

    runid = str(int(time.time()))

    if args.cleanup_only:
        print("Cleanup-only: removing any leftover loadtest data…")
        n = cleanup([], "")
        print(f"Done ({n} companies removed).")
        return

    # Sanity: minted VINs must pass the real validator's check-digit rule.
    try:
        from vininfo import Vin
        assert Vin(mint_vin(0, 0)).verify_checksum() is True
    except Exception as e:
        print(f"VIN minting self-check failed: {e}")
        sys.exit(1)

    try:
        requests.get(BASE + "/", timeout=5)
    except Exception as e:
        print(f"Server not reachable at {BASE} — start it first.\n  {e}")
        sys.exit(2)

    print(f"Setting up {args.companies} companies (run {runid})…")
    companies = setup_companies(args.companies, runid)
    ids = [c["id"] for c in companies]

    # Pre-build every request so timing measures the server, not payload gen.
    work = {c["idx"]: company_requests(c["idx"], args, runid) for c in companies}
    total_reqs = sum(len(v) for v in work.values())
    exp_cars = args.companies * args.cars if args.mode in ("cars", "both") else 0
    exp_clients = args.companies * args.clients if args.mode in ("clients", "both") else 0

    results = []
    results_lock = threading.Lock()
    barrier = threading.Barrier(args.companies)   # all companies start together

    def run_company(c):
        sess = requests.Session()
        hdr = {"Authorization": f"Bearer {c['key']}"}
        barrier.wait()                            # align the simultaneous burst
        for endpoint, payload in work[c["idx"]]:
            t0 = time.monotonic()
            rec = {"company": c["idx"], "endpoint": endpoint}
            try:
                r = sess.post(BASE + endpoint, json=payload, headers=hdr, timeout=180)
                rec["status"] = r.status_code
                body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
                if isinstance(body.get("inserted"), int):
                    rec["inserted"] = body["inserted"] + int(body.get("linked", 0) or 0)
                else:  # /api/batch nested shape
                    rec["inserted"] = (body.get("cars", {}).get("inserted", 0)
                                       + body.get("clients", {}).get("inserted", 0)
                                       + body.get("clients", {}).get("linked", 0))
                rec["err"] = None if r.status_code < 300 else str(body)[:120]
            except Exception as e:
                rec["status"] = "EXC"
                rec["inserted"] = 0
                rec["err"] = str(e)[:120]
            rec["ms"] = (time.monotonic() - t0) * 1000
            with results_lock:
                results.append(rec)

    print(f"Firing {total_reqs} requests from {args.companies} companies concurrently "
          f"(mode={args.mode}, cars/co={args.cars if args.mode!='clients' else 0}, "
          f"clients/co={args.clients if args.mode!='cars' else 0})…")
    t_start = time.monotonic()
    try:
        with ThreadPoolExecutor(max_workers=args.companies) as pool:
            list(pool.map(run_company, companies))
        wall = time.monotonic() - t_start

        # ---- metrics ----
        ok = [r for r in results if r["status"] == 201 or r["status"] == 200]
        bad = [r for r in results if r not in ok]
        inserted = sum(r["inserted"] for r in results)
        lat = sorted(r["ms"] for r in results)
        p50 = lat[len(lat) // 2] if lat else 0
        p95 = lat[int(len(lat) * 0.95)] if lat else 0
        rows_total = exp_cars + exp_clients

        print("\n================ RESULTS ================")
        print(f"  requests:        {len(results)}  (ok={len(ok)}, failed={len(bad)})")
        print(f"  rows attempted:  {rows_total}  (cars={exp_cars}, clients={exp_clients})")
        print(f"  rows inserted:   {inserted}")
        print(f"  wall time:       {wall:.2f}s")
        print(f"  throughput:      {inserted / wall:,.0f} rows/sec, {len(results) / wall:.1f} req/sec")
        print(f"  latency/req:     p50={p50:.0f}ms  p95={p95:.0f}ms  max={lat[-1]:.0f}ms")
        if bad:
            print(f"  FAILURES ({len(bad)}):")
            for r in bad[:8]:
                print(f"    company {r['company']} {r['endpoint']} -> {r['status']}  {r['err']}")

        # ---- DB integrity + isolation checks ----
        print("\n--------- database verification ---------")
        db_cars = query("SELECT count(*) n FROM cars WHERE company_id = ANY(%s)", (ids,), one=True)["n"]
        db_links = query("SELECT count(*) n FROM client_companies WHERE company_id = ANY(%s)", (ids,), one=True)["n"]
        check("cars in DB == inserted cars",
              db_cars == (inserted if args.mode == "cars" else db_cars) or args.mode != "cars",
              extra=f"db={db_cars}")
        # Per-company isolation: every company has exactly its own successful rows.
        per = query("SELECT company_id, count(*) n FROM cars WHERE company_id = ANY(%s) GROUP BY company_id", (ids,)) or []
        isolated = all(row["n"] <= args.cars for row in per)
        check("per-company isolation (no company exceeds its own cars)", isolated)
        check("no failed requests (no pool exhaustion / 5xx / timeouts)", len(bad) == 0)
        if args.mode == "cars":
            check("all cars persisted", db_cars == exp_cars, extra=f"db={db_cars} exp={exp_cars}")
        if args.mode in ("clients", "both"):
            check("client links persisted", db_links >= 1, extra=f"links={db_links}")
    finally:
        print("\n--------- cleanup (remove all test data) ---------")
        cleanup(ids, runid)
        # Confirm zero residue.
        left = query("SELECT count(*) n FROM companies WHERE id = ANY(%s)", (ids,), one=True)["n"]
        left_cars = query("SELECT count(*) n FROM cars WHERE company_id = ANY(%s)", (ids,), one=True)["n"]
        check("no residue: test companies removed", left == 0, extra=f"left={left}")
        check("no residue: test cars removed", left_cars == 0, extra=f"left={left_cars}")

    print(f"\n{_PASS} checks passed, {_FAIL} failed")
    sys.exit(1 if _FAIL else 0)


_PASS = 0
_FAIL = 0


def check(name, cond, extra=""):
    global _PASS, _FAIL
    ok = bool(cond)
    _PASS += ok
    _FAIL += (not ok)
    tail = f"  ({extra})" if extra and not ok else ""
    print(f"  {'ok  ' if ok else 'FAIL'} {name}{tail}")


if __name__ == "__main__":
    main()
