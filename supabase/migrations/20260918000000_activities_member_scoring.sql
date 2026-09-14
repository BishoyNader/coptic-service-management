-- ---------------------------------------------------------------------------
-- Activity-based member scoring.
--
-- Two additions for the activity grading feature:
--   1. `activities` gains a scoring range (min_score / max_score) so the
--      Super Admin can define how many points an activity is worth. The
--      existing `for_role` column determines whether the activity is a
--      SERVANT participation record, a SERVED_MEMBER graded activity, or
--      both.
--   2. New `member_activity_scores` table stores, per SERVED_MEMBER per
--      activity per day, how many points the servant/admin awarded. Points
--      must stay within [0, max_score].
--
-- Writes are role-gated: SERVANT may manage scores (the unified scoring
-- board), ADMIN / SUPER_ADMIN may too. A SERVED_MEMBER may only read their
-- own rows. The service layer validates the target profile is a
-- SERVED_MEMBER before persisting (RLS here is row-level, not data-level).
-- ---------------------------------------------------------------------------

alter table public.activities
  add column min_score numeric(6, 2) not null default 0,
  add column max_score numeric(6, 2) not null default 10;

alter table public.activities
  add constraint activities_score_range_check
  check (min_score >= 0 and max_score >= min_score);

-- Reasonable defaults for the seeded SERVANT activities; the Super Admin can
-- tune each activity from the new activities settings page.
update public.activities set max_score = 10, min_score = 0;

-- ---------------------------------------------------------------------------
-- Per-member per-activity daily score.
-- ---------------------------------------------------------------------------
create table public.member_activity_scores (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  activity_id uuid not null references public.activities (id) on delete cascade,
  score_date  date not null default current_date,
  points      numeric(6, 2) not null default 0,
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (profile_id, activity_id, score_date)
);

create index if not exists member_activity_scores_profile_date_idx
  on public.member_activity_scores (profile_id, score_date desc);

create index if not exists member_activity_scores_date_idx
  on public.member_activity_scores (score_date desc);

alter table public.member_activity_scores
  add constraint member_activity_scores_points_non_negative
  check (points >= 0);

alter table public.member_activity_scores
  add constraint member_activity_scores_no_future
  check (score_date <= current_date);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.member_activity_scores enable row level security;

-- A SERVANT can manage scores for all served members (they grade the whole
-- board); ADMIN / SUPER_ADMIN keep full access. A SERVED_MEMBER may only read
-- their own rows.
create policy "member_activity_scores_staff_manage" on public.member_activity_scores
  for all using (public.current_role() in ('SERVANT', 'ADMIN', 'SUPER_ADMIN'))
    with check (public.current_role() in ('SERVANT', 'ADMIN', 'SUPER_ADMIN'));

create policy "member_activity_scores_member_read" on public.member_activity_scores
  for select using (auth.uid() = profile_id);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.member_activity_scores
  to service_role;
grant select, insert, update, delete on public.member_activity_scores
  to authenticated;