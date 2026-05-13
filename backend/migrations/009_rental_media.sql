-- =====================================================
-- Migration 009 — Photos and videos attached to a rental
--
-- The Report tab's detail sheet lets company users upload pictures of
-- the rented car (different angles) and short videos taken by their
-- employees. Each row is one media file stored on disk under
-- backend/uploads/rental_media/<rental_id>/<filename>.
--
-- Apply:
--   psql -U postgres -d carrental -f migrations/009_rental_media.sql
-- =====================================================

CREATE TABLE IF NOT EXISTS rental_media (
    id            SERIAL PRIMARY KEY,
    rental_id     INTEGER     NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
    kind          VARCHAR(20) NOT NULL,                 -- 'photo' | 'video'
    filename      VARCHAR(200) NOT NULL,                -- on-disk name (uuid-ish)
    original_name VARCHAR(200),
    mime          VARCHAR(100),
    uploaded_at   TIMESTAMP   NOT NULL DEFAULT NOW(),
    uploaded_by   VARCHAR(60)
);

CREATE INDEX IF NOT EXISTS idx_rental_media_rental
    ON rental_media (rental_id);

ANALYZE rental_media;
