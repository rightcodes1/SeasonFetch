create table if not exists public.admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin')),
  created_at timestamptz not null default now()
);

alter table public.admin_roles enable row level security;

drop policy if exists "Admins can read their own role" on public.admin_roles;
create policy "Admins can read their own role"
  on public.admin_roles for select
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_roles
    where user_id = (select auth.uid())
      and role = 'admin'
  );
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- Bootstrap the explicitly authorized account if it already exists.
insert into public.admin_roles (user_id, role)
select id, 'admin'
from auth.users
where lower(email) = lower('rightcodes1@gmail.com')
on conflict (user_id) do update set role = excluded.role;

-- If the account is created after this migration, assign the same role automatically.
create or replace function public.handle_new_admin_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(new.email) = lower('rightcodes1@gmail.com') then
    insert into public.admin_roles (user_id, role)
    values (new.id, 'admin')
    on conflict (user_id) do update set role = excluded.role;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_admin on auth.users;
create trigger on_auth_user_created_admin
  after insert on auth.users
  for each row execute function public.handle_new_admin_user();
