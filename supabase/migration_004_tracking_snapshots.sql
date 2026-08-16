-- ============================================================
-- Inspector — migration 004
--
-- Swiggy hasn't documented what track_order and get_delivery_status return at
-- each stage of a delivery, and those stages only last a few minutes. Rather
-- than sit on the debug page hoping to catch the right moment, each poll
-- records what came back so the shapes can be studied afterwards.
--
-- This is a development aid. Once the response shapes are settled it can be
-- dropped:  drop table public.tracking_snapshots;
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ============================================================

create table if not exists public.tracking_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  swiggy_order_id text not null,
  tool text not null,               -- 'track_order' | 'get_delivery_status'
  status_text text,                 -- the stage this snapshot was taken at
  rider_found boolean default false,
  payload jsonb not null,
  captured_at timestamptz not null default now()
);

create index if not exists tracking_snapshots_order_idx
  on public.tracking_snapshots (swiggy_order_id, captured_at desc);

alter table public.tracking_snapshots enable row level security;
grant select, insert, update, delete on public.tracking_snapshots to service_role;
