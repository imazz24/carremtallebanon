#!/bin/sh
# Container startup: bring the database schema up to date, then launch the
# WSGI server. Postgres is already "healthy" before this runs (compose
# depends_on: service_healthy), and migrate.py tracks applied files in a
# _migrations table — so this is idempotent: a no-op on an up-to-date DB,
# and the one place a fresh volume or a redeploy gets its pending migrations.
set -e

echo "[entrypoint] applying database migrations…"
python migrate.py

# Optional demo seeding. RUN_SEED is on for the local dev stack (see
# docker-compose.override.yml) and off by default elsewhere, so production
# never gets fake companies. seed.py is idempotent and always exits 0, but
# guard with `|| true` anyway so a seed hiccup can't stop the server (set -e).
if [ "${RUN_SEED:-0}" = "1" ] || [ "${RUN_SEED:-0}" = "true" ]; then
  echo "[entrypoint] applying demo seed data (RUN_SEED=${RUN_SEED})…"
  python seed.py || echo "[entrypoint] seeding skipped/failed — continuing."
fi

echo "[entrypoint] starting gunicorn…"
exec gunicorn -c gunicorn.conf.py app:app
