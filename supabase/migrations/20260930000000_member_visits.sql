-- ---------------------------------------------------------------------------
-- Member visitation tracking (الافتقاد)
--
-- Records each pastoral visitation of an active served member: which date
-- (Cairo) the member was checked on and which servant recorded it. One row
-- per member per day — the UNIQUE constraint makes repeat clicks a no-op
-- instead of spam.
-- ---------------------------------------------------------------------------

create table public.member_visits (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.profiles (id) on delete cascade,
  recorded_by uuid references public.profiles (id) on delete set null,
  visit_date  date not null,
  created_at  timestamptz not null default now(),
  unique (member_id, visit_date)
);

comment on table public.member_visits is
  'Pastoral visitation log (الافتقاد): one row per served member per visited day.';

create index idx_member_visits_member_date
  on public.member_visits (member_id, visit_date desc);

create index idx_member_visits_date
  on public.member_visits (visit_date);

-- ---------------------------------------------------------------------------
-- RLS: staff record + read; a served member may only read their own visits.
-- The log is immutable after insert (no update/delete policies).
-- ---------------------------------------------------------------------------
alter table public.member_visits enable row level security;

create policy "member_visits_select_staff_or_own"
  on public.member_visits
  for select
  to authenticated
  using (
    public.current_role() in ('SERVANT', 'SUPER_ADMIN')
    or member_id = auth.uid()
  );

create policy "member_visits_insert_staff"
  on public.member_visits
  for insert
  to authenticated
  with check (public.current_role() in ('SERVANT', 'SUPER_ADMIN'));

grant select, insert on public.member_visits to authenticated;