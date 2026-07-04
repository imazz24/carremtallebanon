-- =====================================================
-- Migration 025 — Special-company rentals: multi phones / branches
--
-- The B2B "cars rented to companies" form now allows MANY phones and MANY
-- branches (each with a "+ Add" button), not just one + one "extra". Store
-- them as comma-joined CSV strings, the same convention companies.phonenumber
-- already uses. Backfill from the old single/extra columns; those columns are
-- left in place (nullable) for safety but are no longer written.
-- =====================================================

ALTER TABLE special_company_rentals
    ADD COLUMN IF NOT EXISTS phones   TEXT,
    ADD COLUMN IF NOT EXISTS branches TEXT;

-- Backfill: fold phone + extra_phone (and branch + extra_branch) into the new
-- CSV columns, skipping blanks. NULLIF turns empty strings into NULL so
-- concat_ws drops them cleanly.
UPDATE special_company_rentals
   SET phones = NULLIF(
         concat_ws(', ', NULLIF(phone, ''), NULLIF(extra_phone, '')), '')
 WHERE phones IS NULL
   AND (COALESCE(phone, '') <> '' OR COALESCE(extra_phone, '') <> '');

UPDATE special_company_rentals
   SET branches = NULLIF(
         concat_ws(', ', NULLIF(branch, ''), NULLIF(extra_branch, '')), '')
 WHERE branches IS NULL
   AND (COALESCE(branch, '') <> '' OR COALESCE(extra_branch, '') <> '');
