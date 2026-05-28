-- Migration 017: Reservations table.
-- A reservation is a future booking for a car. It can be activated
-- (client picks up the car) or cancelled (client declines).
-- While a reservation is pending, no other rental or reservation can
-- overlap its date range for the same car.
CREATE TABLE IF NOT EXISTS reservations (
    id            SERIAL PRIMARY KEY,
    car_vin       TEXT NOT NULL REFERENCES cars(vin),
    client_id     INTEGER NOT NULL REFERENCES clients(id),
    company_id    INTEGER NOT NULL REFERENCES companies(id),
    start_date    DATE NOT NULL,
    end_date      DATE NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'active', 'inactive')),
    notes         TEXT,
    created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reservations_car_vin   ON reservations(car_vin);
CREATE INDEX IF NOT EXISTS idx_reservations_company   ON reservations(company_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status    ON reservations(status);
