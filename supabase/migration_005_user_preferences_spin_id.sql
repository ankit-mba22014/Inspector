-- ============================================================
-- Inspector — migration 005
-- user_preferences was missing spinId — update_cart needs both spinId and
-- skuId to add an item (see CLAUDE.md), so a learned preference couldn't
-- actually be added to the cart without it.
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================

alter table public.user_preferences
  add column if not exists spin_id text;
