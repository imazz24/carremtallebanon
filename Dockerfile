# =====================================================
# Car Rental — single-image Python + Flask container.
#
# Base image is pulled from the corp mirror (the runner and the
# target host both lack direct Docker Hub egress). If you ever need
# to build outside the rnd.com network, swap to `python:3.12-slim`.
# =====================================================
FROM registry.rnd.com/library/python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# psycopg2-binary ships its own libpq, but reportlab + arabic-reshaper
# need a few system bits. libpq5 is added in case anyone swaps the
# binary wheel for source-built psycopg2.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        libpq5 \
        curl \
        ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Install Python deps first so the layer caches whenever app code
# changes but requirements.txt doesn't. gunicorn is added as the
# WSGI server — the dev `flask run` server isn't appropriate for
# anything that survives past `Ctrl+C`.
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt gunicorn==23.0.0

# Application source. backend/ is the Flask app, frontend/ is the
# static UI it serves from the same container.
COPY backend/  /app/backend/
COPY frontend/ /app/frontend/

# Flask listens on this port; docker-compose maps it to the host.
EXPOSE 5000

WORKDIR /app/backend

# Worker/thread counts, timeout, and a Postgres-safe DB pool size are all
# computed in gunicorn.conf.py from the box's CPUs and env overrides
# (GUNICORN_WORKERS, GUNICORN_THREADS, PG_MAX_CONNECTIONS, DB_POOL_MAX, …).
# This scales to many concurrent companies without exhausting DB connections.
#
# entrypoint.sh applies pending DB migrations (idempotent) before launching
# gunicorn, so a fresh volume or a redeploy always gets a current schema
# without a manual `python migrate.py` step.
CMD ["sh", "entrypoint.sh"]
