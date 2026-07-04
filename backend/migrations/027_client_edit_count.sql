-- Track how many times a client record has been corrected. Company users
-- may edit a client they added at most twice (typo fixes); after that the
-- record is locked. Admin edits are unlimited and ignore this counter.
ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS edit_count INTEGER NOT NULL DEFAULT 0;
