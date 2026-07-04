-- Track how many times a car record has been corrected. Company users may
-- edit a car they added at most twice (typo fixes on the plate number / details);
-- the VIN itself is never editable. Admin edits are unlimited and ignore this.
ALTER TABLE cars
    ADD COLUMN IF NOT EXISTS edit_count INTEGER NOT NULL DEFAULT 0;
