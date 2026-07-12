"""Apply the demo seed data on container startup (best-effort).

Runs AFTER migrate.py (see entrypoint.sh). Every listed seed file is
idempotent — each begins `BEGIN; DELETE <prefix>; INSERT …`, so it only
refreshes its OWN demo rows (CMP-01x / BRC-% / DEMO-% / DMO% and the SEED*
clients/cars). Real data added through the app is never touched, which is
why re-seeding on every boot is safe with "keep data".

Gated by the RUN_SEED env var (entrypoint only calls this when it's truthy),
so production — which shouldn't carry fake companies — simply leaves it off.

This is BEST-EFFORT: a failure in any one file is logged and skipped, and the
script always exits 0, so a bad seed can never stop the app from starting.

Usage:  python seed.py
Order matters: companies/branches must exist before the cars that reference
them, so keep the dependency order below.
"""
import os
import sys

from db import get_conn

HERE = os.path.dirname(__file__)

# Ordered by dependency: branch companies → bulk companies → bulk cars (which
# assign themselves to the bulk companies' branches).
#
# seed_demo.sql is deliberately EXCLUDED: it recreates CMP-010 "Beirut Auto
# Rent", the duplicate that was intentionally deleted, so re-running it every
# boot would resurrect that duplicate. Add it back via SEED_FILES only if you
# also reconcile that collision.
#
# Override the whole list with a comma-separated SEED_FILES env var if needed.
DEFAULT_SEEDS = [
    "seed_branches.sql",    # BRC-% companies, each with several branches
    "seed_bulk.sql",        # DEMO-% companies + branches (scale demo)
    "seed_cars_bulk.sql",   # DMO% cars + random branch assignment
]


def seed_files():
    override = (os.environ.get("SEED_FILES") or "").strip()
    names = [s.strip() for s in override.split(",") if s.strip()] if override else DEFAULT_SEEDS
    return [(n, os.path.join(HERE, n)) for n in names]


def apply_all():
    applied = 0
    for name, path in seed_files():
        if not os.path.exists(path):
            print(f"  skip  {name} (not found)")
            continue
        sql = open(path, encoding="utf-8").read()
        # Each seed file manages its own BEGIN/COMMIT, so use a fresh
        # connection per file and don't wrap it in an outer transaction.
        try:
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(sql)
                conn.commit()
            print(f"  OK    {name}")
            applied += 1
        except Exception as e:
            # Best-effort: log and move on, never abort startup.
            print(f"  WARN  {name}: {e}")
    print(f"[seed] {applied} seed file(s) applied.")


if __name__ == "__main__":
    try:
        apply_all()
    except Exception as e:  # last-resort guard — startup must never break here
        print(f"[seed] skipped (unexpected error): {e}")
    sys.exit(0)
