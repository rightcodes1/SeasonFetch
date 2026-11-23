create or replace function public.is_account_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
    select 1
    from public.account_suspensions
    where user_id = (select auth.uid())
      and suspended = true
  );
$$;

revoke all on function public.is_account_active() from public;
grant execute on function public.is_account_active() to anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_account_active() and exists (
    select 1
    from public.admin_roles
    where user_id = (select auth.uid())
      and role = 'admin'
  );
$$;

grant execute on function public.is_admin() to anon, authenticated;

drop policy if exists "Read public profiles or own profile" on public.profiles;
create policy "Read public profiles or own profile"
  on public.profiles for select
  to anon, authenticated
  using (is_public = true or ((select auth.uid()) = id and public.is_account_active()));

drop policy if exists "Create own profile" on public.profiles;
create policy "Create own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id and public.is_account_active());

drop policy if exists "Update own profile" on public.profiles;
create policy "Update own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id and public.is_account_active())
  with check ((select auth.uid()) = id and public.is_account_active());

drop policy if exists "Users can upload their own avatars" on storage.objects;
create policy "Users can upload their own avatars"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
    and public.is_account_active()
  );

drop policy if exists "Users can update their own avatars" on storage.objects;
create policy "Users can update their own avatars"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and owner_id = (select auth.uid()::text) and public.is_account_active())
  with check (bucket_id = 'avatars' and owner_id = (select auth.uid()::text) and public.is_account_active());

drop policy if exists "Users can delete their own avatars" on storage.objects;
create policy "Users can delete their own avatars"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and owner_id = (select auth.uid()::text) and public.is_account_active());

drop policy if exists "Admins can manage suspensions" on public.account_suspensions;
create policy "Admins can manage suspensions"
  on public.account_suspensions for all
  to authenticated
  using (public.is_admin() and public.is_account_active())
  with check (public.is_admin() and public.is_account_active());

drop policy if exists "Admins can read audit logs" on public.audit_logs;
create policy "Admins can read audit logs"
  on public.audit_logs for select
  to authenticated
  using (public.is_admin() and public.is_account_active());

drop policy if exists "Admins can create audit logs" on public.audit_logs;
create policy "Admins can create audit logs"
  on public.audit_logs for insert
  to authenticated
  with check (public.is_admin() and public.is_account_active() and actor_id = (select auth.uid()));

create or replace function public.admin_set_user_suspension(
  target_user_id uuid,
  should_suspend boolean,
  suspension_reason text default ''
)
returns public.account_suspensions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result public.account_suspensions;
begin
  if not public.is_admin() or not public.is_account_active() then
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
