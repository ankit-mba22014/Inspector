-- ============================================================
-- Inspector — schema
--
-- Sign-in is Swiggy OAuth only. Supabase is used purely as a database,
-- reached exclusively from the server with the service_role key — the
-- browser never talks to it directly.
--
-- Safe to re-run.
-- ============================================================

-- One row per Swiggy user
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  swiggy_user_id text unique,
  phone text,
  display_name text,
  created_at timestamptz not null default now()
);

-- Encrypted Swiggy access token (AES-256-GCM, key in TOKEN_ENCRYPTION_KEY)
create table if not exists public.swiggy_tokens (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  access_token text not null,
  refresh_token text default '',
  expires_at timestamptz not null,
  swiggy_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Cached Dynamic Client Registration result
create table if not exists public.swiggy_client (
  id text primary key default 'default',
  client_id text not null,
  client_secret text,
  registered_at timestamptz not null default now(),
  raw_response jsonb
);

create table if not exists public.scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  image_path text,
  -- A scan can cover more than one photo of the same kitchen
  image_count smallint not null default 1,
  detected_items jsonb not null,
  summary text,
  created_at timestamptz not null default now()
);

create table if not exists public.order_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  scan_id uuid references public.scans(id) on delete set null,
  swiggy_order_id text,
  items jsonb not null,
  total_amount numeric(10,2),
  status text not null default 'placed',
  -- track_order needs coordinates, and the cart that carries them is cleared
  -- once the order is placed, so they're captured at checkout.
  delivery_lat double precision,
  delivery_lng double precision,
  delivery_address_id text,
  placed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Learned corrections: when automatic matching can't find something and the
-- user resolves it via manual search, we remember the pick so the same
-- spoken/scanned word matches directly next time instead of failing again.
-- Both spinId and skuId are required — update_cart needs both to add an item.
create table if not exists public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_query text not null,
  sku_id text not null,
  spin_id text,
  brand text,
  product_name text,
  last_synced_at timestamptz not null default now(),
  unique (user_id, item_query)
);

-- Development aid: records what the tracking tools return at each stage of a
-- delivery, since those stages are short-lived and the shapes aren't
-- documented. Safe to drop once tracking is settled.
create table if not exists public.tracking_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  swiggy_order_id text not null,
  tool text not null,
  status_text text,
  rider_found boolean default false,
  payload jsonb not null,
  captured_at timestamptz not null default now()
);

create index if not exists tracking_snapshots_order_idx
  on public.tracking_snapshots (swiggy_order_id, captured_at desc);

-- ============================================================
-- Access control
--
-- RLS is enabled with no permissive policies: nothing is readable through
-- the public API. Every query goes through our own server routes, which
-- check the session cookie first and then use service_role (which bypasses
-- RLS by design).
-- ============================================================

alter table public.profiles          enable row level security;
alter table public.swiggy_tokens     enable row level security;
alter table public.swiggy_client     enable row level security;
alter table public.scans             enable row level security;
alter table public.order_history     enable row level security;
alter table public.user_preferences  enable row level security;
alter table public.tracking_snapshots enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.profiles         to service_role;
grant select, insert, update, delete on public.swiggy_tokens    to service_role;
grant select, insert, update, delete on public.swiggy_client    to service_role;
grant select, insert, update, delete on public.scans            to service_role;
grant select, insert, update, delete on public.order_history    to service_role;
grant select, insert, update, delete on public.user_preferences to service_role;
grant select, insert, update, delete on public.tracking_snapshots to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

-- ============================================================
-- Migrating from the earlier Supabase-Auth version
--
-- The old profiles.id referenced auth.users. If you have that schema,
-- run these once to move across (this discards old demo-account data):
--
--   drop table if exists public.user_preferences, public.order_history,
--     public.scans, public.saved_addresses, public.swiggy_tokens,
--     public.profiles cascade;
--   drop function if exists public.handle_new_user() cascade;
--
-- then run this file.
-- ============================================================
