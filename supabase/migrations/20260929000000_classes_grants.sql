-- Grant access on the `classes` table created by 20260925000000.
--
-- The service role bypasses RLS but still needs table grants for server-side
-- reads/writes; staff reads go through the authenticated RLS policies.
-- GRANT is idempotent, so this migration is safe for environments that already
-- have the grants in place.

grant select, insert, update, delete on table public.classes to service_role;
grant select on table public.classes to authenticated;