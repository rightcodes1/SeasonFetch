-- Milestone 1: Core Personal Library & Minimal Retention Foundation
-- Prerequisite: Migrations 0004_enforce_suspensions.sql and
-- 0005_admin_private_profile_reads.sql MUST be applied before this migration
-- so public.is_account_active() and public.is_admin() exist with suspension
-- enforcement enabled. Do not run 0006 out of order in production.

do $$
begin
  if to_regprocedure('public.is_account_active()') is null then
    raise exception 'Prerequisite migration 0004_enforce_suspensions.sql must be applied before 0006_personal_library_and_retention.sql (missing public.is_account_active()).';
  end if;
end
$$;

-- Shared updated_at trigger helper (SECURITY INVOKER, pinned search_path).
create or replace function public.set_library_item_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_library_item_updated_at() from public;

-- 1. Personal Library (user intent & organization, decoupled from progress/history)
create table if not exists public.user_library_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  media_type text not null check (media_type in ('movie', 'series')),
  imdb_id text not null check (imdb_id ~ '^tt[0-9]+$'),
  status text not null default 'want_to_watch'
    check (status in ('want_to_watch', 'watching', 'completed', 'dropped')),
  is_favorite boolean not null default false,
  -- Denormalized metadata snapshot so My Library renders without per-item Cinemeta fan-out
  title text not null check (char_length(trim(title)) between 1 and 240),
  release_year text check (release_year is null or char_length(release_year) <= 16),
  poster_url text check (poster_url is null or (char_length(poster_url) <= 1000 and poster_url ~ '^https?://')),
  rating text check (rating is null or char_length(rating) <= 16),
  genres text[] not null default '{}' check (cardinality(genres) <= 12),
  synopsis text not null default '' check (char_length(synopsis) <= 2000),
  season_count integer check (season_count is null or (season_count >= 0 and season_count <= 200)),
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_library_items_user_media_unique unique (user_id, media_type, imdb_id)
);

create index if not exists idx_user_library_items_user_updated
  on public.user_library_items (user_id, updated_at desc);

create index if not exists idx_user_library_items_user_status_updated
  on public.user_library_items (user_id, status, updated_at desc);

create index if not exists idx_user_library_items_user_favorites
  on public.user_library_items (user_id, updated_at desc)
  where is_favorite = true;

drop trigger if exists user_library_items_updated_at on public.user_library_items;
create trigger user_library_items_updated_at
  before update on public.user_library_items
  for each row execute function public.set_library_item_updated_at();

alter table public.user_library_items enable row level security;

revoke all on public.user_library_items from anon;
grant select, insert, update, delete on public.user_library_items to authenticated;

drop policy if exists "Users can read own library items" on public.user_library_items;
create policy "Users can read own library items"
  on public.user_library_items for select
  to authenticated
  using ((select auth.uid()) = user_id and public.is_account_active());

drop policy if exists "Users can insert own library items" on public.user_library_items;
create policy "Users can insert own library items"
  on public.user_library_items for insert
  to authenticated
  with check ((select auth.uid()) = user_id and public.is_account_active());

drop policy if exists "Users can update own library items" on public.user_library_items;
create policy "Users can update own library items"
  on public.user_library_items for update
  to authenticated
  using ((select auth.uid()) = user_id and public.is_account_active())
  with check ((select auth.uid()) = user_id and public.is_account_active());

drop policy if exists "Users can delete own library items" on public.user_library_items;
create policy "Users can delete own library items"
  on public.user_library_items for delete
  to authenticated
  using ((select auth.uid()) = user_id and public.is_account_active());

-- 2. Returning Active Days (privacy-minimal D7/D30 retention foundation; 1 row/user/UTC day)
create table if not exists public.user_active_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  active_date date not null default (timezone('utc', now()))::date,
  first_seen_at timestamptz not null default now(),
  primary key (user_id, active_date)
);

create index if not exists idx_user_active_days_active_date
  on public.user_active_days (active_date desc);

alter table public.user_active_days enable row level security;

revoke all on public.user_active_days from anon;
grant select, insert on public.user_active_days to authenticated;

drop policy if exists "Users and admins can read active days" on public.user_active_days;
create policy "Users and admins can read active days"
  on public.user_active_days for select
  to authenticated
  using (
    ((select auth.uid()) = user_id and public.is_account_active())
    or public.is_admin()
  );

drop policy if exists "Users can record own active day" on public.user_active_days;
create policy "Users can record own active day"
  on public.user_active_days for insert
  to authenticated
  with check ((select auth.uid()) = user_id and public.is_account_active());

-- 3. Minimal First-Party Retention Events (append-only, no IP/UA/PII)
create table if not exists public.product_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null check (
    event_name in (
      'first_library_save',
      'library_item_saved',
      'library_status_changed',
      'library_favorite_toggled',
      'library_item_removed'
    )
  ),
  media_type text check (media_type is null or media_type in ('movie', 'series')),
  imdb_id text check (imdb_id is null or imdb_id ~ '^tt[0-9]+$'),
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) <= 4096),
  occurred_at timestamptz not null default now()
);

create index if not exists idx_product_events_user_name_time
  on public.product_events (user_id, event_name, occurred_at desc);

create index if not exists idx_product_events_name_time
  on public.product_events (event_name, occurred_at desc);

alter table public.product_events enable row level security;

revoke all on public.product_events from anon;
grant select, insert on public.product_events to authenticated;

drop policy if exists "Users and admins can read product events" on public.product_events;
create policy "Users and admins can read product events"
  on public.product_events for select
  to authenticated
  using (
    ((select auth.uid()) = user_id and public.is_account_active())
    or public.is_admin()
  );

drop policy if exists "Users can record own product events" on public.product_events;
create policy "Users can record own product events"
  on public.product_events for insert
  to authenticated
  with check ((select auth.uid()) = user_id and public.is_account_active());
