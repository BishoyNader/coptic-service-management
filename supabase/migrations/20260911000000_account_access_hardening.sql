-- Phase 6 — Account & access hardening.
--
-- Prevents a logged-in user from changing their OWN role or status through
-- the direct PostgREST API.
--
-- The previous guard only blocked non-admins, so an ADMIN could escalate
-- their own role to SUPER_ADMIN (they pass is_admin()) and deactivate their
-- own account. This adds a strict self check that applies to every
-- browser-authenticated session while leaving the two legitimate paths
-- untouched:
--
--   * browser self-updates of role or status      → blocked always
--   * service-role writes (auth.uid() IS NULL)    → unaffected
--   * admins editing OTHER users' role/status     → unaffected

create or replace function public.guard_protected_profile_fields()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Never allow a logged-in user to change their own role or status,
  -- including an ADMIN upgrading themselves via the SQL API.
  if (
    old.role is distinct from new.role
    or old.status is distinct from new.status
  ) and auth.uid() = old.id then
    raise exception using
      errcode = '42501',
      message = 'not allowed to change own role or status';
  end if;

  -- Non-admins may not change any protected field at all.
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