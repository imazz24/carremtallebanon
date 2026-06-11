#!/bin/sh
# Container startup: bring the database schema up to date, then launch the
# WSGI server. Postgres is already "healthy" before this runs (compose
# depends_on: service_healthy), and migrate.py tracks applied files in a
# _migrations table — so this is idempotent: a no-op on an up-to-date DB,
# and the one place a fresh volume or a redeploy gets its pending migrations.
set -e

echo "[entrypoint] applying database migrations…"
python migrate.py

echo "[entrypoint] starting gunicorn…"
exec gunicorn -c gunicorn.conf.py app:app
