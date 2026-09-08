-- ---------------------------------------------------------------------------
-- Phase 4 — Centralized scoring engine: scoring periods + scoring RLS.
--
-- score_records gains a `period_key` that pins a manual score to a defined
-- scoring period (e.g. "WEEKLY:2026-09-12" or "MONTHLY:2026-09-01"). Attendance
-- records (CHURCH_ATTENDANCE / SERVICE_ATTENDANCE) leave it NULL — they are
-- already de-duplicated by the partial attendance unique index. A partial
-- unique index prevents a member from ever holding two conflicting manual
-- scores for the same category + period.
-- ---------------------------------------------------------------------------

alter table public.score_records
  add column if not exists period_key text;

comment on column public.score_records.period_key is
  'Defined scoring period this record belongs to, e.g. "WEEKLY:2026-09-12" or "MONTHLY:2026-09-01". NULL for attendance-derived records.';

-- One manual score per (member, category, period). Archived (voided) rows do
-- not block a new entry — the partial predicate mirrors is_voided soft-delete.
create unique index if not exists score_records_profile_category_period_key
  on public.score_records (profile_id, category, period_key)
  where is_voided = false and period_key is not null;

-- ---------------------------------------------------------------------------
-- Scoring RLS — strict, role-aware.
--   * Members: read their own score records only, and only in their own
--     SERVED_MEMBER role (servants must never observe scoring rows).
--   * Admins / Super Admins: may read any member's score records (the entry
--     UI + the member score list run through the same RLS-bound server client).
--   * Writes remain admin-only via the existing score_records_admin_write
--     policy (FOR ALL using is_admin()).
-- ---------------------------------------------------------------------------
drop policy if exists score_records_own_read on public.score_records;
create policy score_records_own_read
  on public.score_records for select
  using (
    (auth.uid() = profile_id and public.current_role() = 'SERVED_MEMBER')
    or public.is_admin()
  );