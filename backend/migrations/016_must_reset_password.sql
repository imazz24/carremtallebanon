-- Migration 016: Add must_reset_password flag to users table.
-- New company accounts must change the admin-assigned password on first login.
-- Existing accounts (including admin) are grandfathered in as FALSE.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN NOT NULL DEFAULT FALSE;

-- All future register-company calls will set this to TRUE so the company
-- user is forced to pick their own password on first sign-in.
