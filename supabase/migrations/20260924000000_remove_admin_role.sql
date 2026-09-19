-- Migration: Remove the ADMIN role.
--
-- The SERVANT role now carries all administrative access that ADMIN had.
-- Existing ADMIN accounts are converted to SERVANT; a servants detail row
-- is ensured for each converted account.
--
-- The Postgres enum value 'ADMIN' is intentionally kept in app_role because
-- removing an enum value requires dropping and recreating all dependent
-- policies, functions, and columns — a high-risk operation for zero
-- functional benefit. No policy, function, or application code references
-- 'ADMIN' after this migration, making the orphaned enum value inert.

-- 1. Ensure every former ADMIN has a servants detail row.
insert into public.servants (profile_id)
select id from public.profiles where role = 'ADMIN'
on conflict (profile_id) do nothing;

-- 2. Convert all ADMIN profiles to SERVANT.
update public.profiles set role = 'SERVANT' where role = 'ADMIN';

-- 3. Rewrite is_admin() — the central "staff access" predicate.
--    It now covers SERVANT (the staff role) and SUPER_ADMIN.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.current_role() in ('SERVANT', 'SUPER_ADMIN')
$$;

-- 4. Literal-list policies that mentioned 'ADMIN'.

-- admin_profiles: only SUPER_ADMIN may read.
drop policy if exists "admin_profiles_select" on public.admin_profiles;
create policy "admin_profiles_select" on public.admin_profiles
  for select using (public.current_role() = 'SUPER_ADMIN');

-- audit log: only SUPER_ADMIN may read.
drop policy if exists "audit_logs_select_admin" on public.audit_logs;
create policy "audit_logs_select_admin" on public.audit_logs
  for select using (public.current_role() = 'SUPER_ADMIN');

-- notification deliveries: staff may manage.
drop policy if exists "deliveries_select_admin" on public.notification_deliveries;
create policy "deliveries_select_admin" on public.notification_deliveries
  for select using (public.current_role() in ('SERVANT', 'SUPER_ADMIN'));

drop policy if exists "deliveries_update_admin" on public.notification_deliveries;
create policy "deliveries_update_admin" on public.notification_deliveries
  for update using (public.current_role() in ('SERVANT', 'SUPER_ADMIN'))
  with check (public.current_role() in ('SERVANT', 'SUPER_ADMIN'));

-- member activity scores: staff may manage.
drop policy if exists "member_activity_scores_staff_manage" on public.member_activity_scores;
create policy "member_activity_scores_staff_manage" on public.member_activity_scores
  for all using (public.current_role() in ('SERVANT', 'SUPER_ADMIN'))
  with check (public.current_role() in ('SERVANT', 'SUPER_ADMIN'));

-- 5. Servant notification audience — servants can now broadcast.
-- (The RLS insert policy on notifications uses is_admin(), which now
-- includes SERVANT, so no policy change needed.)

-- 6. Add an index on profiles.role if not already present (speeds up
-- role-based queries).
create index if not exists idx_profiles_role on public.profiles (role);
