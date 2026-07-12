"""Gunicorn configuration — tuned for many companies hitting the batch API at
once. Everything is env-overridable so you can size it to the box without
editing the image.

Key risk this guards against: each worker process keeps its OWN PostgreSQL
connection pool, so total connections = workers × DB_POOL_MAX. If that exceeds
Postgres' max_connections you get "too many connections" under load. When
DB_POOL_MAX isn't pinned explicitly, we derive a safe per-worker pool from the
server's max_connections below.
"""
import os
import multiprocessing

_cpu = multiprocessing.cpu_count()

# More workers = more requests served truly in parallel (separate processes,
# no GIL contention). Default to the common 2×CPU+1; override with GUNICORN_WORKERS.
workers = int(os.getenv("GUNICORN_WORKERS", str(_cpu * 2 + 1)))

# Threads per worker absorb I/O waits (DB, NHTSA) within a worker so one slow
# batch doesn't block the others sharing that process.
threads = int(os.getenv("GUNICORN_THREADS", "4"))

# A big all-cold-VIN batch can take tens of seconds; give it room.
timeout = int(os.getenv("GUNICORN_TIMEOUT", "120"))

bind = os.getenv("GUNICORN_BIND", "0.0.0.0:5000")
accesslog = "-"            # request log to stdout (docker compose logs)
errorlog = "-"

# Recycle each worker after this many requests (with jitter so they don't all
# recycle at once). Guards a long-running process against slow memory growth
# from per-worker caches (e.g. the NHTSA decode cache). 0 = never recycle.
max_requests = int(os.getenv("GUNICORN_MAX_REQUESTS", "1000"))
max_requests_jitter = int(os.getenv("GUNICORN_MAX_REQUESTS_JITTER", "100"))

# --- Auto-size the DB pool so workers × DB_POOL_MAX stays under Postgres' cap.
# Only kicks in when DB_POOL_MAX isn't already set, so an explicit value wins.
if not os.getenv("DB_POOL_MAX"):
    pg_max   = int(os.getenv("PG_MAX_CONNECTIONS", "100"))      # Postgres max_connections
    reserve  = int(os.getenv("PG_RESERVE_CONNECTIONS", "20"))   # leave room for admin/other clients
    per_worker = max(2, (pg_max - reserve) // max(1, workers))
    os.environ["DB_POOL_MAX"] = str(per_worker)
    if int(os.getenv("DB_POOL_MIN", "5")) > per_worker:
        os.environ["DB_POOL_MIN"] = str(per_worker)
