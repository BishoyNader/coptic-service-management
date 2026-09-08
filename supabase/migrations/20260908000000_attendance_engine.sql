-- Phase 3 — Attendance engine.
--
-- The base tables (attendance_sessions, attendance_records, scoring_rules,
-- score_records, and their RLS policies) already exist. This migration only
-- hardens integrity and adds the machinery the engine relies on:
--
--   1. Every attendance record must belong to a session.
--   2. Duplicate check-ins for the same person + session (attendance type +
--      Cairo calendar date) are impossible at the DB level while the previous
--      record is still active (not voided).
--   3. score_records can be soft-voided so historical attendance rows stay
--      linked without the voided score ever being aggregated again.

alter table public.attendance_records
  alter column session_id set not null;

create unique index attendance_records_profile_session_active_key
  on public.attendance_records (profile_id, session_id)
  where status <> 'ARCHIVED';

create index attendance_records_status_idx
  on public.attendance_records (status);

alter table public.score_records
  add column is_voided boolean not null default false;

create index score_records_attendance_record_idx
  on public.score_records (attendance_record_id);