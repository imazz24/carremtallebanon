-- =====================================================
-- Migration 029 — Special-company rentals: company owner name
--
-- The B2B "cars rented to companies" record now also captures the name of the
-- OTHER company's owner (the person you rent your cars out to), shown next to
-- the company name in the list and detail view. Nullable — old rows have none.
-- =====================================================

ALTER TABLE special_company_rentals
    ADD COLUMN IF NOT EXISTS owner_name VARCHAR(200);
