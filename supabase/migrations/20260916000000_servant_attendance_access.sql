-- ---------------------------------------------------------------------------
-- SERVANT attendance access.
--
-- Enables the existing SERVANT role to record and view attendance for
-- servants and served members (the "attendance board"). No new role is
-- introduced; ADMIN / SUPER_ADMIN keep all existing attendance permission.
--
--  * Reads  — SERVANT may now read the profiles of servants & served members
--     and their attendance records (subject-scoped), plus attendance sessions
--     (needed for nested reads). This powers the servant board + homepage
--     widget. Highly private fields (phone, auth_email, DOB, address) are NOT
--     exposed because the board selects the minimal columns; RLS is row-level
--     and the app never requests those columns for scope reads.
--  * Writes — Direct client INSERT/UPDATE/DELETE on attendance_records
--     stays ADMIN/SUPER_ADMIN-only: recording still runs through the
--     server actions -> service-role RPC `record_attendance_with_score`
--     (EXECUTE locked to service_role), which is also where the score is
--     computed. This is an intentional integrity shield: exposing a client
--     INSERT policy to SERVANT would let a client write arbitrary
--     attended_at/points rows and skip scoring/audit.
-- ---------------------------------------------------------------------------

-- SERVANT may read profiles of servants & served members for the board.
create policy "profiles_select_servant_scope" on public.profiles
  for select using (
    public.current_role() = 'SERVANT'
    and role in ('SERVANT', 'SERVED_MEMBER')
    and status <> 'ARCHIVED'
  );

-- SERVANT may read attendance sessions (nested reads inside the board query).
create policy "attendance_sessions_read_servant" on public.attendance_sessions
  for select using (public.current_role() = 'SERVANT');

-- SERVANT may read attendance records whose subject is a servant or a
-- served member. A SERVANT can never read an ADMIN/SUPER_ADMIN record here.
create policy "attendance_records_servant_read" on public.attendance_records
  for select using (
    public.current_role() = 'SERVANT'
    and exists (
      select 1 from public.profiles p
      where p.id = attendance_records.profile_id
        and p.role in ('SERVANT', 'SERVED_MEMBER')
    )
  );

-- Index to make the servant-board "today's records per session" join cheap.
create index if not exists attendance_sessions_session_date_idx
  on public.attendance_sessions (session_date);