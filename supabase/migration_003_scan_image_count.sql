-- ============================================================
-- Inspector — migration 003
-- A scan can now cover up to two photos of the same kitchen.
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================

alter table public.scans
  add column if not exists image_count smallint not null default 1;
