-- Migration 019: Co-renters — multiple clients per rental.
CREATE TABLE IF NOT EXISTS co_renters (
    id         SERIAL PRIMARY KEY,
    rental_id  INTEGER NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
    client_id  INTEGER NOT NULL REFERENCES clients(id),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(rental_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_co_renters_rental ON co_renters(rental_id);
