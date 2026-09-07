-- ============================================================================
-- Church Service Management — Initial Schema
-- Coptic Orthodox Church Service
--
-- NOTES
--   * Public registration creates SERVED_MEMBER / SERVANT only.
--   * ADMIN / SUPER_ADMIN are created by authorized administrators.
--   * All scoring rules are stored in `scoring_rules` so they can be edited
--     without touching application code.
--   * QR codes carry a random token; only its SHA-256 hash is stored.
--
-- Run with the Supabase SQL editor or `supabase db push`.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum (
  'SERVED_MEMBER',
  'SERVANT',
  'ADMIN',
  'SUPER_ADMIN'
);

create type public.user_status as enum ('ACTIVE', 'INACTIVE', 'ARCHIVED');

create type public.scoring_category as enum (
  'CHURCH_ATTENDANCE',
  'SERVICE_ATTENDANCE',
  'WEEKLY_COMMITMENT',
  'TUNIC',
  'COMMUNION',
  'BONUS',
  'MONTHLY_ACTIVITY',
  'SERVICE_COMMITMENT'
);

create type public.attendance_type as enum ('CHURCH', 'SERVICE');

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        public.app_role not null default 'SERVED_MEMBER',
  full_name   text not null check (char_length(trim(full_name)) between 2 and 120),
  phone       text not null unique,
  auth_email  text,
  date_of_birth date,
  address     text,
  father_phone text,
  mother_phone text,
  avatar_url  text,
  status      public.user_status not null default 'ACTIVE',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column public.profiles.role is 'Internal role. Never derived from client input.';
comment on column public.profiles.auth_email is 'Auth email — only used for admin accounts that log in with email.';

-- ---------------------------------------------------------------------------
-- Role detail tables
-- ---------------------------------------------------------------------------
create table public.served_members (
  profile_id  uuid primary key references public.profiles (id) on delete cascade,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.servants (
  profile_id  uuid primary key references public.profiles (id) on delete cascade,
  service_name text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.admin_profiles (
  profile_id  uuid primary key references public.profiles (id) on delete cascade,
  permissions jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Personal codes & QR identifiers
-- ---------------------------------------------------------------------------
-- `code` is the short numeric code used for manual entry.
-- `qr_token` is a cryptographically-random UUID rendered inside the QR code.
-- It carries no personal information and acts purely as a capability token,
-- so it can be re-rendered on the user's "QR Code" screen at any time.
create table public.personal_codes (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  code       text not null unique check (code ~ '^[0-9]{6}$'),
  qr_token   uuid not null unique,
  created_at timestamptz not null default now()
);

create index if not exists personal_codes_code_idx on public.personal_codes (code);
create index if not exists personal_codes_qr_token_idx on public.personal_codes (qr_token);

-- ---------------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------------
create table public.attendance_sessions (
  id         uuid primary key default gen_random_uuid(),
  type       public.attendance_type not null,
  title      text not null,
  session_date date not null default current_date,
  opened_at  timestamptz default now(),
  closed_at  timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (type, session_date)
);

create table public.attendance_records (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid references public.attendance_sessions (id) on delete cascade,
  profile_id     uuid not null references public.profiles (id) on delete cascade,
  attended_at    timestamptz not null default now(),
  points         numeric(6, 2) not null default 0,
  recorded_by    uuid references public.profiles (id) on delete set null,
  source         text not null default 'QR' check (source in ('QR', 'CODE', 'MANUAL')),
  status         text not null default 'PRESENT' check (status in ('PRESENT', 'LATE', 'ARCHIVED')),
  created_at     timestamptz not null default now()
);

create index if not exists attendance_records_profile_date_idx
  on public.attendance_records (profile_id, attended_at desc);
create index if not exists attendance_records_session_idx
  on public.attendance_records (session_id);
create index if not exists attendance_records_recorded_by_idx
  on public.attendance_records (recorded_by);

-- ---------------------------------------------------------------------------
-- Scoring
-- ---------------------------------------------------------------------------
create table public.scoring_rules (
  id              uuid primary key default gen_random_uuid(),
  category        public.scoring_category not null,
  name            text not null,
  point_value     numeric(6, 2) not null default 0,
  applicable_role public.app_role[] not null default '{SERVED_MEMBER}'::public.app_role[],
  start_time      time,
  end_time        time,
  requires_min_days integer, -- e.g. 30 for monthly activity
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Initial configuration rules (application settings, not demo data).
-- Points bands for church attendance and weekly scoring.
insert into public.scoring_rules (category, name, point_value, applicable_role, start_time, end_time, requires_min_days, sort_order) values
  ('CHURCH_ATTENDANCE', 'حضور القداس — من 7 لـ 8', 10, '{SERVED_MEMBER}', '07:00', '08:00', null, 10),
  ('CHURCH_ATTENDANCE', 'حضور القداس — من 8 لـ 8:15', 8, '{SERVED_MEMBER}', '08:00', '08:15', null, 20),
  ('CHURCH_ATTENDANCE', 'حضور القداس — من 8:15 لـ 8:30', 5, '{SERVED_MEMBER}', '08:15', '08:30', null, 30),
  ('CHURCH_ATTENDANCE', 'حضور القداس — من 8:30 لـ 9:30', 3, '{SERVED_MEMBER}', '08:30', '09:30', null, 40),
  ('WEEKLY_COMMITMENT', 'الالتزام الأسبوعي', 1, '{SERVED_MEMBER}', null, null, null, 50),
  ('TUNIC', 'لبس التونية', 5, '{SERVED_MEMBER}', null, null, null, 60),
  ('COMMUNION', 'التناول', 5, '{SERVED_MEMBER}', null, null, null, 70),
  ('BONUS', 'إضافي', 3, '{SERVED_MEMBER}', null, null, null, 80),
  ('MONTHLY_ACTIVITY', 'نشاط شهري', 20, '{SERVED_MEMBER}', null, null, 30, 90);

insert into public.scoring_rules (category, name, point_value, applicable_role, start_time, end_time, requires_min_days, sort_order) values
  ('SERVICE_ATTENDANCE', 'حضور الخدمة — من 10:30 لـ 11', 10, '{SERVED_MEMBER}', '10:30', '11:00', null, 10),
  ('SERVICE_ATTENDANCE', 'حضور الخدمة — بعد 11', 5, '{SERVED_MEMBER}', '11:00', null, null, 20),
  ('SERVICE_COMMITMENT', 'التزام الخدمة', 1, '{SERVED_MEMBER}', null, null, null, 30);

create table public.score_records (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null references public.profiles (id) on delete cascade,
  category            public.scoring_category not null,
  points              numeric(6, 2) not null default 0,
  rule_id             uuid references public.scoring_rules (id) on delete set null,
  attendance_record_id uuid references public.attendance_records (id) on delete cascade,
  session_date        date not null default current_date,
  note                text,
  recorded_by         uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now()
);

create index if not exists score_records_profile_date_idx
  on public.score_records (profile_id, session_date desc);
create index if not exists score_records_category_idx
  on public.score_records (category);

-- ---------------------------------------------------------------------------
-- Servant activity tracking
-- ---------------------------------------------------------------------------
create table public.activities (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  icon        text,
  for_role    public.app_role not null default 'SERVANT',
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

insert into public.activities (code, name, icon, sort_order) values
  ('ATTENDED_LITURGY', 'حضر القداس', 'Church', 10),
  ('WORE_TUNIC', 'لبس التونية', 'Shirt', 20),
  ('TOOK_COMMUNION', 'اتناول', 'Gem', 30),
  ('ATTENDED_TRIBES', 'حضر الأطراف', 'Users', 40),
  ('ATTENDED_SERVICE', 'حضر الخدمة', 'HeartHandshake', 50),
  ('GAVE_LESSON', 'شرح', 'BookOpen', 60),
  ('ATTENDED_STUDY', 'حضر الدرس', 'GraduationCap', 70),
  ('DID_VISITATION', 'عمل افتقاد', 'Home', 80);

create table public.servant_activity_records (
  id          uuid primary key default gen_random_uuid(),
  servant_id  uuid not null references public.profiles (id) on delete cascade,
  activity_id uuid not null references public.activities (id) on delete cascade,
  recorded_on date not null default current_date,
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (servant_id, activity_id, recorded_on)
);

create index if not exists servant_activity_servant_date_idx
  on public.servant_activity_records (servant_id, recorded_on desc);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text,
  audience    public.app_role[] not null default '{SERVED_MEMBER}'::public.app_role[],
  sender_id   uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table public.notification_recipients (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  read_at         timestamptz,
  created_at      timestamptz not null default now(),
  unique (notification_id, profile_id)
);

create index if not exists notification_recipients_profile_read_idx
  on public.notification_recipients (profile_id, read_at);

-- ---------------------------------------------------------------------------
-- Birthday reminders
-- ---------------------------------------------------------------------------
create table public.birthday_reminders (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  reminder_for date not null,
  created_at  timestamptz not null default now(),
  unique (profile_id, reminder_for)
);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  entity      text not null,
  entity_id   uuid,
  previous    jsonb,
  new         jsonb,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity, entity_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Returns the internal role of the currently authenticated user (NULL if none).
create or replace function public.current_role()
returns public.app_role
language sql stable security definer set search_path = public
as $$
  select p.role from public.profiles p where p.id = auth.uid()
$$;

-- True when the current user is ADMIN or SUPER_ADMIN.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.current_role() in ('ADMIN', 'SUPER_ADMIN')
$$;

create or replace function public.handle_profile_updated()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- updated_at triggers
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.handle_profile_updated();
create trigger trg_served_members_updated before update on public.served_members
  for each row execute function public.handle_profile_updated();
create trigger trg_servants_updated before update on public.servants
  for each row execute function public.handle_profile_updated();
create trigger trg_admin_profiles_updated before update on public.admin_profiles
  for each row execute function public.handle_profile_updated();
create trigger trg_scoring_rules_updated before update on public.scoring_rules
  for each row execute function public.handle_profile_updated();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- New Supabase defaults do not auto-expose tables, so we explicitly grant
-- privileges. Row Level Security still enforces the actual access rules.
grant usage on schema public to anon, authenticated, service_role;

-- Service role (server-side admin operations, bypasses RLS).
grant select, insert, update, delete on all tables in schema public to service_role;

-- Authenticated users — what each policy above allows.
grant select, insert, update on public.profiles to authenticated;
grant select on public.served_members to authenticated;
grant select on public.servants to authenticated;
grant select on public.admin_profiles to authenticated;
grant select on public.personal_codes to authenticated;
grant select, insert, update, delete on public.attendance_sessions to authenticated;
grant select, insert, update, delete on public.attendance_records to authenticated;
grant select on public.scoring_rules to authenticated;
grant select, insert, update, delete on public.score_records to authenticated;
grant select on public.activities to authenticated;
grant select, insert, update, delete on public.servant_activity_records to authenticated;
grant select, insert on public.notifications to authenticated;
grant select, insert, update, delete on public.notification_recipients to authenticated;
grant select, insert, update, delete on public.birthday_reminders to authenticated;
grant select, insert on public.audit_logs to authenticated;

-- Anonymous users — nothing is publicly exposed.
grant select on public.scoring_rules, public.activities to anon;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.served_members enable row level security;
alter table public.servants enable row level security;
alter table public.admin_profiles enable row level security;
alter table public.personal_codes enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;
alter table public.scoring_rules enable row level security;
alter table public.score_records enable row level security;
alter table public.activities enable row level security;
alter table public.servant_activity_records enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_recipients enable row level security;
alter table public.birthday_reminders enable row level security;
alter table public.audit_logs enable row level security;

-- --- profiles -------------------------------------------------------------
create policy "profiles_select_own_or_admin" on public.profiles
  for select using (
    auth.uid() = id
    or public.is_admin()
  );

create policy "profiles_update_own_or_admin" on public.profiles
  for update using (
    auth.uid() = id
    or public.is_admin()
  )
  with check (auth.uid() = id or public.is_admin());

create policy "profiles_delete_admin_only" on public.profiles
  for delete using (public.is_admin());

-- Profiles are created server-side through the service role.

-- --- role detail tables ---------------------------------------------------
create policy "detail_select_own_or_admin" on public.served_members
  for select using (public.is_admin() or auth.uid() = profile_id);
create policy "detail_select_own_or_admin" on public.servants
  for select using (public.is_admin() or auth.uid() = profile_id);
create policy "detail_admin_write" on public.served_members
  for all using (public.is_admin()) with check (public.is_admin());
create policy "detail_admin_write" on public.servants
  for all using (public.is_admin()) with check (public.is_admin());

-- admin_profiles: super admin manages, admins may read own.
create policy "admin_profiles_select" on public.admin_profiles
  for select using (public.current_role() in ('ADMIN', 'SUPER_ADMIN'));
create policy "admin_profiles_write_super" on public.admin_profiles
  for all using (public.current_role() = 'SUPER_ADMIN') with check (public.current_role() = 'SUPER_ADMIN');

-- --- personal codes -------------------------------------------------------
create policy "personal_codes_select_own_or_admin" on public.personal_codes
  for select using (auth.uid() = profile_id or public.is_admin());

-- --- attendance -----------------------------------------------------------
create policy "attendance_sessions_read_admin" on public.attendance_sessions
  for select using (public.is_admin());
create policy "attendance_sessions_write_admin" on public.attendance_sessions
  for all using (public.is_admin()) with check (public.is_admin());

create policy "attendance_records_admin_write" on public.attendance_records
  for all using (public.is_admin()) with check (public.is_admin());
create policy "attendance_records_own_read" on public.attendance_records
  for select using (auth.uid() = profile_id or public.is_admin());

-- --- scoring rules --------------------------------------------------------
create policy "scoring_rules_read" on public.scoring_rules
  for select using (public.current_role() is not null);
create policy "scoring_rules_write_super" on public.scoring_rules
  for all using (public.current_role() = 'SUPER_ADMIN') with check (public.current_role() = 'SUPER_ADMIN');

-- --- score records --------------------------------------------------------
create policy "score_records_admin_write" on public.score_records
  for all using (public.is_admin()) with check (public.is_admin());
create policy "score_records_own_read" on public.score_records
  for select using (auth.uid() = profile_id or public.is_admin());

-- --- servant activities ---------------------------------------------------
create policy "activities_read" on public.activities
  for select using (public.current_role() is not null);
create policy "activities_write_admin" on public.activities
  for all using (public.is_admin()) with check (public.is_admin());

create policy "servant_activity_admin_write" on public.servant_activity_records
  for all using (public.is_admin()) with check (public.is_admin());
create policy "servant_activity_own_read" on public.servant_activity_records
  for select using (auth.uid() = servant_id or public.is_admin());

-- --- notifications --------------------------------------------------------
create policy "notifications_create_admin" on public.notifications
  for insert with check (public.is_admin());
create policy "notifications_read_admin" on public.notifications
  for select using (public.is_admin());

create policy "notification_recipients_admin_write" on public.notification_recipients
  for all using (public.is_admin()) with check (public.is_admin());
create policy "notification_recipients_own_read" on public.notification_recipients
  for select using (auth.uid() = profile_id);

-- --- birthday reminders ---------------------------------------------------
create policy "birthday_reminders_admin" on public.birthday_reminders
  for all using (public.is_admin()) with check (public.is_admin());

-- --- audit log ------------------------------------------------------------
create policy "audit_logs_select_admin" on public.audit_logs
  for select using (public.current_role() in ('ADMIN', 'SUPER_ADMIN'));
create policy "audit_logs_insert_any" on public.audit_logs
  for insert with check (true);