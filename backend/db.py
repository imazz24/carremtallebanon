"""PostgreSQL connection helper for the carrental DB.

Tuned to stay healthy when hundreds of companies hit the API at once and push
millions of rows:

  * Each gunicorn worker keeps its own ThreadedConnectionPool (see
    gunicorn.conf.py, which auto-sizes DB_POOL_MAX so workers × pool never
    exceeds Postgres' max_connections).
  * get_conn() QUEUES on a momentarily-exhausted pool instead of failing the
    request. psycopg2's ThreadedConnectionPool.getconn() raises PoolError the
    instant every connection is checked out; under a burst that would turn into
    a wall of 500s. We retry for a short bounded window so a spike drains
    smoothly, and only surface an error if the pool stays saturated.
  * Every connection is opened with a server-side statement_timeout and
    idle_in_transaction_session_timeout, plus TCP keepalives. A single stuck
    query or a client that dies mid-transaction can therefore never pin a
    pooled connection forever and starve everyone else — the backstop reaps it.
"""
import os
import time
import threading
from psycopg2.pool import ThreadedConnectionPool, PoolError
from psycopg2.extras import RealDictCursor
from contextlib import contextmanager
from dotenv import load_dotenv

load_dotenv()

# Server-side safety backstops, sent as libpq `options` at connect time so they
# apply to every session drawn from the pool. Both are generous (well under
# gunicorn's request timeout) — they exist to reap a genuinely stuck query or a
# transaction abandoned by a dead worker, not to cap normal work. The batch
# endpoints validate BEFORE opening a transaction and then run a handful of
# back-to-back statements, so neither limit trips during healthy operation.
_STATEMENT_TIMEOUT_MS = int(os.getenv("DB_STATEMENT_TIMEOUT_MS", "60000"))       # 60s
_IDLE_TX_TIMEOUT_MS   = int(os.getenv("DB_IDLE_TX_TIMEOUT_MS", "60000"))         # 60s

_pg_options = (
    f"-c statement_timeout={_STATEMENT_TIMEOUT_MS} "
    f"-c idle_in_transaction_session_timeout={_IDLE_TX_TIMEOUT_MS}"
)

DB_CONFIG = {
    "host":     os.getenv("DB_HOST", "localhost"),
    "port":     int(os.getenv("DB_PORT", "5432")),
    "dbname":   os.getenv("DB_NAME", "carrental"),
    "user":     os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", ""),
    # Fail fast if Postgres is unreachable rather than hanging a worker thread.
    "connect_timeout": int(os.getenv("DB_CONNECT_TIMEOUT", "10")),
    # Detect and drop half-open TCP connections (network blip, PG restart) so a
    # dead socket isn't handed back out of the pool.
    "keepalives": 1,
    "keepalives_idle": int(os.getenv("DB_KEEPALIVES_IDLE", "30")),
    "keepalives_interval": int(os.getenv("DB_KEEPALIVES_INTERVAL", "10")),
    "keepalives_count": int(os.getenv("DB_KEEPALIVES_COUNT", "5")),
    # Names each session in pg_stat_activity so a DBA can see the app's load.
    "application_name": os.getenv("DB_APP_NAME", "carrental-api"),
    "options": _pg_options,
}

DB_POOL_MIN = int(os.getenv("DB_POOL_MIN", "5"))
DB_POOL_MAX = int(os.getenv("DB_POOL_MAX", "50"))

# How long get_conn() will keep retrying a momentarily-exhausted pool before it
# gives up and raises. Under a burst, connections free within milliseconds as
# in-flight requests commit, so a short queue absorbs the spike; a pool that
# stays full for this long is genuine overload worth surfacing.
_POOL_ACQUIRE_TIMEOUT = float(os.getenv("DB_POOL_ACQUIRE_TIMEOUT", "10"))
_POOL_ACQUIRE_INTERVAL = float(os.getenv("DB_POOL_ACQUIRE_INTERVAL", "0.05"))

_pool = None
_pool_lock = threading.Lock()


def _get_pool():
    """Return the shared connection pool, creating it lazily on first use."""
    global _pool
    if _pool is None:
        with _pool_lock:
            # Double-check after acquiring the lock
            if _pool is None:
                _pool = ThreadedConnectionPool(
                    DB_POOL_MIN, DB_POOL_MAX, **DB_CONFIG
                )
    return _pool


def _acquire(pool):
    """Check out a connection, QUEUEING briefly if the pool is momentarily
    exhausted instead of failing immediately. psycopg2's getconn() raises
    PoolError as soon as every slot is checked out; under a concurrency spike we
    would rather wait a few milliseconds for an in-flight request to return its
    connection than 500 the caller. Retries until _POOL_ACQUIRE_TIMEOUT, then
    re-raises so sustained overload is still visible."""
    deadline = time.monotonic() + _POOL_ACQUIRE_TIMEOUT
    while True:
        try:
            return pool.getconn()
        except PoolError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(_POOL_ACQUIRE_INTERVAL)


@contextmanager
def get_conn():
    pool = _get_pool()
    conn = _acquire(pool)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


def query(sql, params=None, one=False):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params or ())
            if cur.description is None:
                return None
            rows = cur.fetchall()
            return (rows[0] if rows else None) if one else rows


def execute(sql, params=None, returning=False):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params or ())
            if returning:
                return cur.fetchone()
            return None


def ping():
    """Cheap liveness probe for the /api/health endpoint: round-trips a trivial
    query through the pool. Returns True on success; raises on any failure so
    the caller can report the reason."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
    return True


def close_pool():
    """Close all connections in the pool. Call during application shutdown."""
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.closeall()
            _pool = None
