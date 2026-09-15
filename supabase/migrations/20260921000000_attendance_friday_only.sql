-- Phase 17 — Friday-only attendance rule.
--
-- Attendance sessions only ever take place on Fridays. This migration:
--
--   1. Scrubs any legacy sessions whose Cairo date is a non-Friday (the
--      session records cascade-delete their attendance_records, and each
--      attendance_record cascades to its derived score_records row).
--   2. Removes any orphaned attendance-category score rows that reference a
--      non-Friday session_date (safety net for rows written without a linked
--      attendance_record_id).
--   3. Adds a DB-level CHECK that makes a non-Friday session impossible to
--      insert going forward. The service guard in executeCheckIn /
--      correctAttendance already enforces this; the constraint backstops any
--      future write path that forgets the rule.

delete from public.attendance_sessions
where extract(isodow from session_date) <> 5;

delete from public.score_records
where category in ('CHURCH_ATTENDANCE', 'SERVICE_ATTENDANCE')
  and extract(isodow from session_date) <> 5;

alter table public.attendance_sessions
  add constraint attendance_sessions_friday_only
  check (extract(isodow from session_date) = 5);