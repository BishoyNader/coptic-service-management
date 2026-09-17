-- Phase 18 — Study Year architecture.
--
-- The ministry year (الخدمة) is a first-class domain concept. Attendance,
-- scoring and reporting all run on the Friday schedule *derived* from the
-- boundaries of the active Study Year — never from a hardcoded list of dates.
--
-- This migration:
--
--   1. Creates `study_years` (id, name, start_date, end_date, is_active, …)
--      with a GiST no-overlap constraint and a partial unique index that
--      allows at most one active year.
--   2. Seeds the current year 2026/2027 → 2026-09-18 .. 2027-09-24, which
--      yields exactly 54 Fridays (first 2026-09-18, last 2027-09-24).
--   3. Adds a DB-level backstop (BEFORE INSERT/UPDATE trigger) that refuses
--      attendance_sessions whose date falls outside *every* configured Study
--      Year. Existing rows are untouched, so historical records stay valid.
--
-- Every write path enforces Study Year membership in the service layer too
-- (see src/services/study-year-service.ts). The trigger backs up future
-- paths that forget the rule.

create extension if not exists btree_gist;

create table public.study_years (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 80),
  start_date  date not null,
  end_date    date not null,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (start_date < end_date)
);

-- No two Study Years may overlap (inclusive date ranges).
alter table public.study_years
  add constraint study_years_no_overlap
  exclude using gist (daterange(start_date, end_date, '[]') with &&);

-- At most one active year at a time.
create unique index study_years_single_active_idx
  on public.study_years ((true))
  where is_active;

alter table public.study_years enable row level security;

create policy "study_years_read_staff" on public.study_years
  for select using (public.current_role() is not null);

create policy "study_years_write_super" on public.study_years
  for all using (public.current_role() = 'SUPER_ADMIN')
  with check (public.current_role() = 'SUPER_ADMIN');

create trigger trg_study_years_updated before update on public.study_years
  for each row execute function public.handle_profile_updated();

-- Current ministry year: 2026/2027 (54 Fridays: 2026-09-18 .. 2027-09-24).
insert into public.study_years (name, start_date, end_date, is_active)
values ('2026/2027', '2026-09-18', '2027-09-24', true);

-- ---------------------------------------------------------------------------
-- Backstop: attendance sessions must belong to at least one Study Year.
-- Fires on insert/update only; legacy rows outside every year are preserved.
-- ---------------------------------------------------------------------------
create or replace function public.assert_session_in_study_year()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.study_years y
    where new.session_date between y.start_date and y.end_date
  ) then
    raise exception 'attendance session date % is outside every configured study year', new.session_date;
  end if;
  return new;
end
$$;

create trigger trg_attendance_sessions_study_year
  before insert or update on public.attendance_sessions
  for each row execute function public.assert_session_in_study_year();

-- Activates one Study Year atomically and clears every other one, so the
-- partial-unique "single active" index can never be raced.
create or replace function public.set_active_study_year(p_study_year_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.study_years set is_active = false;
  update public.study_years set is_active = true where id = p_study_year_id;
  if not found then
    raise exception 'study year % does not exist', p_study_year_id;
  end if;
end
$$;