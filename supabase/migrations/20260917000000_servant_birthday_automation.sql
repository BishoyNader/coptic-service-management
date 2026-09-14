-- ---------------------------------------------------------------------------
-- Servant birthday automation
-- ---------------------------------------------------------------------------
-- Bug fix: an ACTIVE SERVANT whose birthday falls on the automation date never
-- received a birthday reminder/notification because `birthdays_for_today()`
-- only selected `role = 'SERVED_MEMBER'`.
--
-- Fix is additive + non-destructive:
--   1. Widen the SQL eligibility filter to `SERVANT` + `SERVED_MEMBER`.
--      The RETURNS TABLE signature is UNCHANGED (profile_id, full_name, phone)
--      because PostgreSQL forbids CREATE OR REPLACE from altering a function's
--      return type (that would require DROP FUNCTION — not allowed here).
--      The consumer (`runBirthdayAutomation`) resolves each subject's role for
--      the notification `audience`.
--   2. Re-assert the service-role-only EXECUTE grant (phase 10) so the
--      recreated definition keeps the same security posture. The function is
--      SECURITY DEFINER and returns phone PII, so anon/authenticated stay
--      denied.
-- ---------------------------------------------------------------------------

create or replace function public.birthdays_for_today(target_date date)
returns table(profile_id uuid, full_name text, phone text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.id, p.full_name, p.phone
  from public.profiles p
  where p.role in ('SERVANT', 'SERVED_MEMBER')
    and p.status = 'ACTIVE'
    and p.date_of_birth is not null
    and (
      -- Direct match: birthday month/day equals target month/day
      to_char(p.date_of_birth, 'MM-DD') = to_char(target_date, 'MM-DD')
      or
      -- Feb 29 birthday in non-leap year: maps to Feb 28
      (to_char(p.date_of_birth, 'MM-DD') = '02-29'
       and to_char(target_date, 'MM-DD') = '02-28'
       and not public.is_leap_year(extract(year from target_date)::int))
    )
$function$;

-- Re-assert the service-role-only EXECUTE granted in phase 10 (phone PII).
revoke all on function public.birthdays_for_today(date)
  from public, anon, authenticated;
grant execute on function public.birthdays_for_today(date)
  to service_role;