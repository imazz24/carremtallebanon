-- =====================================================
-- Migration 024 — Special-company rentals (B2B)
--
-- An enterprise (company user) sometimes rents its own cars OUT to another
-- company. This table records that other company's details plus which of the
-- enterprise's cars it currently holds. One row = one recorded company.
--
-- Owned by the enterprise (company_id). car_vins is a comma-joined list of the
-- enterprise's own car VINs — the report resolves them to full car detail.
-- =====================================================

CREATE TABLE IF NOT EXISTS special_company_rentals (
    id            SERIAL PRIMARY KEY,
    company_id    INTEGER      NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    company_name  VARCHAR(200) NOT NULL,
    location      VARCHAR(200),
    x             NUMERIC(9,6),
    y             NUMERIC(9,6),
    phone         VARCHAR(60),
    extra_phone   VARCHAR(60),
    branch        VARCHAR(200),
    extra_branch  VARCHAR(200),
    car_vins      TEXT,
    notes         TEXT,
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_special_rentals_company
    ON special_company_rentals(company_id);
