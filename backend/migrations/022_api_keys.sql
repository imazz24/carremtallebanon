-- =====================================================
-- 022: Per-company API keys for external batch-import integrations
--
-- External companies push data to the batch API (/api/cars/batch,
-- /api/clients/batch, /api/branches/batch, /api/batch) programmatically.
-- The in-browser app authenticates with an X-Auth-User header (no secret),
-- which is fine on a trusted page but unsafe for outside callers — anyone
-- knowing a company name could write as them. An API key is a real secret:
--
--   * api_key_hash       — SHA-256 hex of the key. We NEVER store the raw
--                          key; it's shown once at creation. Lookup hashes
--                          the presented key and matches this column.
--   * api_key_prefix     — first few chars of the raw key (e.g. "crk_AbC12"),
--                          safe to display so a company can recognise which
--                          key is active without revealing the secret.
--   * api_key_created_at — when it was (re)generated; rotating overwrites the
--                          hash, instantly invalidating the previous key.
--
-- The key is attached to the company's user row, so resolving a key yields
-- the same {id, username, role, company_id} a header login would — every
-- existing per-company isolation and role check keeps working unchanged.
-- =====================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_hash       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_prefix     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS api_key_created_at TIMESTAMP NULL;

-- Unique so a hash can't collide; partial so the many NULLs (users without a
-- key) don't fight over a single NULL slot. This index is also the lookup
-- path used on every API-key-authenticated request.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_key_hash
    ON users (api_key_hash) WHERE api_key_hash IS NOT NULL;
