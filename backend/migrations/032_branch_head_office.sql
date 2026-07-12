-- =====================================================
-- Migration 032 — Head-office branch per company
--
-- A company's branches now include exactly one designated "head office".
-- The first branch a company adds becomes its head office automatically;
-- once a company has more than one branch the user can pick which branch
-- is the head office (enforced app-side + the partial unique index below).
--
-- Apply:
--   psql -U postgres -d carrental -f migrations/032_branch_head_office.sql
-- =====================================================

ALTER TABLE branches
    ADD COLUMN IF NOT EXISTS is_head_office BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: for every company that has active branches but none flagged yet,
-- promote its earliest (lowest id) active branch to head office.
UPDATE branches b
   SET is_head_office = TRUE
 WHERE b.is_active = TRUE
   AND b.id = (
        SELECT MIN(b2.id) FROM branches b2
         WHERE b2.company_id = b.company_id AND b2.is_active = TRUE
   )
   AND NOT EXISTS (
        SELECT 1 FROM branches b3
         WHERE b3.company_id = b.company_id
           AND b3.is_active = TRUE
           AND b3.is_head_office = TRUE
   );

-- At most one head office per company (among active branches).
CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_head_office
    ON branches(company_id)
    WHERE is_head_office AND is_active;

ANALYZE branches;
