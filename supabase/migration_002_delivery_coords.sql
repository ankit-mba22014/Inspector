-- ============================================================
-- Inspector — migration 002
--
-- track_order requires the delivery coordinates. They're only available from
-- get_cart's selectedAddressDetails, and the cart is empty once the order is
-- placed — so capture them at checkout and keep them with the order.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================

alter table public.order_history
  add column if not exists delivery_lat double precision,
  add column if not exists delivery_lng double precision,
  add column if not exists delivery_address_id text;
