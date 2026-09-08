-- Phase 2 — Profile RLS hardening.
--
-- The existing "profiles_update_own_or_admin" policy lets a user update
-- their own row. That is intended for profile details, but it must never
-- allow a regular user to escalate their role, change identity fields,
-- or deactivate/re-activate their own account. Only admins may touch these.

create or replace function public.guard_protected_profile_fields()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (
    old.role is distinct from new.role
    or old.auth_email is distinct from new.auth_email
    or old.status is distinct from new.status
    or old.phone is distinct from new.phone
  ) and not public.is_admin() then
    raise exception using
      errcode = '42501',
      message = 'not allowed to change protected profile fields';
  end if;
  return new;
end
$$;

drop trigger if exists trg_profiles_protect_fields on public.profiles;
create trigger trg_profiles_protect_fields
  before update on public.profiles
  for each row execute function public.guard_protected_profile_fields();