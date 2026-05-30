-- =====================================================
-- 020: Company activity / inactivity tracking
--   * users.last_login   — stamped on every successful login
--   * activity_log        — one row per "create" action a company performs,
--                           so the admin dashboard can show what each company
--                           has been doing and how long they've been idle.
-- =====================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_login TIMESTAMP;

CREATE TABLE IF NOT EXISTS activity_log (
    id          SERIAL PRIMARY KEY,
    company_id  INTEGER     REFERENCES companies(id) ON DELETE CASCADE,
    user_id     INTEGER     REFERENCES users(id)     ON DELETE SET NULL,
    username    VARCHAR(60),                 -- denormalised for display/history
    action      VARCHAR(20)  NOT NULL,       -- 'create' | 'update' | 'delete'
    entity      VARCHAR(30)  NOT NULL,       -- 'rental' | 'reservation' | 'car' | 'client'
    detail      TEXT,                        -- human-readable summary
    created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_company_time
    ON activity_log (company_id, created_at DESC);
