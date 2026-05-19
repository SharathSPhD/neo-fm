-- 0045_developer_tier_enum.sql
--
-- Adds `developer` to tier_enum. Must be committed before any function
-- bodies reference the new value (PostgreSQL restriction on enum values).
-- Migration 0046 adds the updated quota/storage functions and promotes
-- the operator account.

ALTER TYPE public.tier_enum ADD VALUE IF NOT EXISTS 'developer';
