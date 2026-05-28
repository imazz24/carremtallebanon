"""Auto-apply all SQL migrations in order.

Usage:
    python migrate.py          # apply all pending migrations
    python migrate.py --status # show which migrations have been applied

Tracks applied migrations in a `_migrations` table so each file
runs exactly once — safe to re-run after adding new files.
"""
import os
import sys
import glob

from db import get_conn

MIGRATIONS_DIR = os.path.join(os.path.dirname(__file__), "migrations")


def ensure_tracking_table(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS _migrations (
            name    TEXT PRIMARY KEY,
            applied TIMESTAMP DEFAULT NOW()
        )
    """)


def get_applied(cur):
    cur.execute("SELECT name FROM _migrations ORDER BY name")
    return {row[0] for row in cur.fetchall()}


def get_all_files():
    pattern = os.path.join(MIGRATIONS_DIR, "*.sql")
    files = sorted(glob.glob(pattern))
    return [(os.path.basename(f), f) for f in files]


def apply_all():
    with get_conn() as conn:
        with conn.cursor() as cur:
            ensure_tracking_table(cur)
            applied = get_applied(cur)
            all_files = get_all_files()

            pending = [(name, path) for name, path in all_files if name not in applied]

            if not pending:
                print("All migrations already applied.")
                return

            for name, path in pending:
                sql = open(path, encoding="utf-8").read()
                try:
                    cur.execute(sql)
                    cur.execute(
                        "INSERT INTO _migrations (name) VALUES (%s)", (name,)
                    )
                    print(f"  OK  {name}")
                except Exception as e:
                    print(f"  FAIL  {name}: {e}")
                    conn.rollback()
                    sys.exit(1)

            print(f"\n{len(pending)} migration(s) applied.")


def show_status():
    with get_conn() as conn:
        with conn.cursor() as cur:
            ensure_tracking_table(cur)
            applied = get_applied(cur)
            all_files = get_all_files()

            print(f"{'STATUS':<10} {'MIGRATION'}")
            print("-" * 50)
            for name, _ in all_files:
                status = "applied" if name in applied else "PENDING"
                mark = "  " if name in applied else ">>"
                print(f"{mark} {status:<8} {name}")

            pending_count = sum(1 for n, _ in all_files if n not in applied)
            print(f"\n{len(applied)} applied, {pending_count} pending.")


if __name__ == "__main__":
    if "--status" in sys.argv:
        show_status()
    else:
        apply_all()
