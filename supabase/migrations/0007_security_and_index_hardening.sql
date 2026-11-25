-- 0007: Database Security & Index Hardening
-- Fixes Supabase security & performance advisor findings:
-- - Revokes anon/public EXECUTE on all SECURITY DEFINER functions
-- - Revokes client EXECUTE on trigger-only functions (handle_new_user, handle_new_admin_user)
-- - Splits anon public-profile SELECT policy so anon never calls is_account_active()
-- - Converts is_admin() to SECURITY INVOKER (reads caller's own row via admin_roles RLS)
-- - Enforces least-privilege table grants alongside RLS
-- - Adds covering indexes for unindexed foreign keys on account_suspensions and audit_logs

-- 1. Pin search_path and revoke client EXECUTE on trigger-only SECURITY DEFINER functions.
alter function public.handle_new_user() set search_path = public, pg_temp;
revoke all on function public.handle_new_user() from public, anon, authenticated;

alter function public.handle_new_admin_user() set search_path = public, pg_temp;
revoke all on function public.handle_new_admin_user() from public, anon, authenticated;

-- 2. Split anon public-profile reads from authenticated reads so anon never touches is_account_active().
alter policy "Read public profiles or own profile"
  on public.profiles
  to authenticated
  using (is_public = true or ((select auth.uid()) = id and public.is_account_active()));

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'Anon can read public profiles'
  ) then
    create policy "Anon can read public profiles"
      on public.profiles for select
      to anon
      using (is_public = true);
  end if;
end
$$;

revoke all on function public.is_account_active() from public, anon;
grant execute on function public.is_account_active() to authenticated;

-- 3. Convert public.is_admin() to SECURITY INVOKER and restrict EXECUTE to authenticated.
create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select public.is_account_active() and exists (
    select 1
    from public.admin_roles
    where user_id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

revoke all on function public.admin_set_user_suspension(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_user_suspension(uuid, boolean, text) to authenticated;

-- 4. Least-privilege table grants (defense in depth alongside RLS).
revoke all on public.account_suspensions from anon;
revoke all on public.admin_roles from anon;
revoke all on public.audit_logs from anon;
revoke insert, update, delete, truncate, references, trigger on public.profiles from anon;
grant select on public.profiles to anon;

revoke insert, update, delete, truncate, references, trigger on public.admin_roles from authenticated;
grant select on public.admin_roles to authenticated;

revoke update, delete, truncate, references, trigger on public.audit_logs from authenticated;
grant select, insert on public.audit_logs to authenticated;

revoke delete, truncate, references, trigger on public.profiles from authenticated;
grant select, insert, update on public.profiles to authenticated;

revoke truncate, references, trigger on public.account_suspensions from authenticated;
grant select, insert, update, delete on public.account_suspensions to authenticated;

revoke truncate, references, trigger on public.user_library_items from authenticated;
grant select, insert, update, delete on public.user_library_items to authenticated;

revoke update, delete, truncate, references, trigger on public.user_active_days from authenticated;
grant select, insert on public.user_active_days to authenticated;

revoke update, delete, truncate, references, trigger on public.product_events from authenticated;
grant select, insert on public.product_events to authenticated;

-- 5. Covering indexes for unindexed foreign keys.
create index if not exists idx_account_suspensions_suspended_by
  on public.account_suspensions (suspended_by);

create index if not exists idx_audit_logs_actor_id
  on public.audit_logs (actor_id);

create index if not exists idx_audit_logs_target_user_id
  on public.audit_logs (target_user_id);
