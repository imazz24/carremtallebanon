-- Migration 015: Add owner_name column to companies table
ALTER TABLE companies ADD COLUMN IF NOT EXISTS owner_name TEXT;
