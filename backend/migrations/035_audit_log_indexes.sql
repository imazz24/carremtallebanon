-- =====================================================
-- 035: Indexes for the enterprise audit-log dashboard
--   The admin "Audit Log" stream orders every event platform-wide by id DESC
--   (served by the activity_log PK) and filters by action / entity, while the
--   24h KPI header aggregates by created_at. These indexes keep both fast as
--   the log grows into the millions of rows.
-- =====================================================

-- 24h KPI rollup + any time-window scan.
CREATE INDEX IF NOT EXISTS idx_activity_created
    ON activity_log (created_at DESC);

-- Action filter on the audit stream (login / logout / create / update / delete).
CREATE INDEX IF NOT EXISTS idx_activity_action
    ON activity_log (action);

-- Entity filter on the audit stream (auth / car / client / rental / ...).
CREATE INDEX IF NOT EXISTS idx_activity_entity
    ON activity_log (entity);

ANALYZE activity_log;
