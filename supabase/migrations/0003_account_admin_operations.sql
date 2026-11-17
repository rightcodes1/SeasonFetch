-- Public profile avatars are readable by profile visitors; writes remain owner-only.
update storage.buckets
set public = true
where id = 'avatars';

drop policy if exists "Users can read their own avatars" on storage.objects;
create policy "Anyone can read public avatars"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');

-- Replace the case-sensitive table constraint with a case-insensitive unique index.
alter table public.profiles drop constraint if exists profiles_username_key;
drop index if exists public.profiles_username_lower_key;
create unique index profiles_username_lower_key
  on public.profiles (lower(username))
  where username is not null;

create table if not exists public.account_suspensions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  suspended boolean not null default true,
  reason text not null default '',
  suspended_by uuid references auth.users(id) on delete set null,
  suspended_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.account_suspensions enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "Users can read their own suspension" on public.account_suspensions;
create policy "Users can read their own suspension"
  on public.account_suspensions for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Admins can manage suspensions" on public.account_suspensions;
create policy "Admins can manage suspensions"
  on public.account_suspensions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can read audit logs" on public.audit_logs;
create policy "Admins can read audit logs"
  on public.audit_logs for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Admins can create audit logs" on public.audit_logs;
create policy "Admins can create audit logs"
  on public.audit_logs for insert
  to authenticated
  with check (public.is_admin() and actor_id = (select auth.uid()));

create or replace function public.admin_set_user_suspension(
  target_user_id uuid,
  should_suspend boolean,
  suspension_reason text default ''
)
returns public.account_suspensions
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.account_suspensions;
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if target_user_id = (select auth.uid()) then
    raise exception 'Administrators cannot suspend themselves' using errcode = '22023';
  end if;

  insert into public.account_suspensions (user_id, suspended, reason, suspended_by)
  values (target_user_id, should_suspend, left(coalesce(suspension_reason, ''), 500), (select auth.uid()))
  on conflict (user_id) do update set
    suspended = excluded.suspended,
    reason = excluded.reason,
    suspended_by = excluded.suspended_by,
    suspended_at = case when excluded.suspended then now() else account_suspensions.suspended_at end,
    updated_at = now()
  returning * into result;

  insert into public.audit_logs (actor_id, action, target_user_id, metadata)
  values ((select auth.uid()), case when should_suspend then 'user.suspended' else 'user.unsuspended' end, target_user_id,
          jsonb_build_object('reason', left(coalesce(suspension_reason, ''), 500)));
  return result;
end;
$$;

grant execute on function public.admin_set_user_suspension(uuid, boolean, text) to authenticated;
