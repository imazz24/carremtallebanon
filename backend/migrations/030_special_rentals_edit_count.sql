-- Track how many times a company has corrected a B2B "cars rented to
-- companies" record. Company users may edit a record they added at most
-- twice (typo fixes on the other company's details / dates); after that the
-- record is locked. Admin edits (if any) are unlimited and ignore this.
ALTER TABLE special_company_rentals
    ADD COLUMN IF NOT EXISTS edit_count INTEGER NOT NULL DEFAULT 0;
