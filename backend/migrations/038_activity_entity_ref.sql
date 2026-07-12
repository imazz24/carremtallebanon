-- =====================================================
-- Migration 038 — Drill-able audit entries
--
-- The admin activity/audit feed stored only a free-text `detail`, so a car
-- showed as a bare VIN the admin couldn't recognise and nothing was clickable.
-- This adds a lightweight reference so each logged action can point at the
-- record it touched:
--   * entity_ref — "kind:key" (e.g. "car:JT...VIN", "client:42", "branch:7").
--                  The admin UI parses it to open the car / client / branch
--                  detail (with a map pin for branches). NULL for actions with
--                  nothing to drill into (login/logout, deletes of soft-removed
--                  rows). Only new events carry it — old rows stay NULL.
--
-- Apply:
--   psql -U postgres -d carrental -f migrations/038_activity_entity_ref.sql
-- =====================================================

ALTER TABLE activity_log
    ADD COLUMN IF NOT EXISTS entity_ref TEXT NULL;
