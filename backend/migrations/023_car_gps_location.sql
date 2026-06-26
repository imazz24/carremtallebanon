-- =====================================================
-- 023: Live GPS position for cars
--
-- A GPS-equipped car carries a tracker that periodically reports where
-- the car physically is. We store the latest fix on the car row:
--   gps_lat / gps_lng  — last known coordinates (NULL until first fix)
--   gps_updated_at      — when that fix arrived (so the UI can show
--                         "updated 4 min ago" and flag stale signals)
--
-- The fleet/admin map reads these to plot a rented car's real location,
-- falling back to the owning company's registered coordinates when a car
-- has no live fix. The ingest endpoint POST /api/cars/<vin>/gps is what a
-- real in-car device (or a company integration) calls to push a fix.
--
-- /api/cars selects c.* so these columns surface automatically.
-- =====================================================

ALTER TABLE cars
  ADD COLUMN IF NOT EXISTS gps_lat        NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS gps_lng        NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS gps_updated_at TIMESTAMP NULL;
