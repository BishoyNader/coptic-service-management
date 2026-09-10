-- Phase 7 — Notification delivery channels & birthday automation.
--
--  1. notification_deliveries: per-recipient per-channel delivery tracking.
--  2. Channels are IN_APP, SMS, WHATSAPP.
--  3. RLS: admin-only read/write, users cannot forge delivery status.
--  4. Indexes for efficient delivery log queries and birthday automation.
--  5. is_leap_year() SQL helper for birthday Feb-29 detection.
--  6. birthdays_for_today() function for scheduled birthday automation.

-- ---------------------------------------------------------------------------
-- Leap year helper (SQL equivalent of lib/dates.ts isLeapYear)
-- ---------------------------------------------------------------------------
create or replace function public.is_leap_year(y integer)
returns boolean
language sql immutable
as $$
  select (y % 4 = 0 and y % 100 <> 0) or (y % 400 = 0)
$$;

-- ---------------------------------------------------------------------------
-- Delivery channel enum
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'delivery_channel') then
    create type public.delivery_channel as enum ('IN_APP', 'SMS', 'WHATSAPP');
  end if;
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Delivery status enum
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'delivery_status') then
    create type public.delivery_status as enum (
      'QUEUED',
      'SENT',
      'DELIVERED',
      'FAILED',
      'PROVIDER_NOT_CONFIGURED'
    );
  end if;
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Notification deliveries table
-- ---------------------------------------------------------------------------
create table if not exists public.notification_deliveries (
  id                    uuid primary key default gen_random_uuid(),
  notification_id       uuid not null references public.notifications (id) on delete cascade,
  recipient_profile_id  uuid not null references public.profiles (id) on delete cascade,
  channel               public.delivery_channel not null,
  status                public.delivery_status not null default 'QUEUED',
  provider              text,
  provider_message_id   text,
  error_code            text,
  error_message         text,
  attempted_at          timestamptz not null default now(),
  delivered_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Indexes
create index if not exists deliveries_notification_idx
  on public.notification_deliveries (notification_id);

create index if not exists deliveries_recipient_idx
  on public.notification_deliveries (recipient_profile_id, created_at desc);

create index if not exists deliveries_channel_status_idx
  on public.notification_deliveries (channel, status);

create index if not exists deliveries_attempted_idx
  on public.notification_deliveries (attempted_at desc);

-- Unique constraint: one delivery per notification+recipient+channel
create unique index if not exists deliveries_unique_per_channel
  on public.notification_deliveries (notification_id, recipient_profile_id, channel);

-- updated_at trigger
create trigger trg_deliveries_updated before update on public.notification_deliveries
  for each row execute function public.handle_profile_updated();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.notification_deliveries to service_role;
grant select, insert, update on public.notification_deliveries to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.notification_deliveries enable row level security;

-- Admin/super-admin can read all delivery records
create policy "deliveries_select_admin" on public.notification_deliveries
  for select using (public.current_role() in ('ADMIN', 'SUPER_ADMIN'));

-- Admin/super-admin can insert delivery records (server-side only via service role)
create policy "deliveries_insert_admin" on public.notification_deliveries
  for insert with check (public.is_admin());

-- Admin/super-admin can update delivery records (for status transitions)
create policy "deliveries_update_admin" on public.notification_deliveries
  for update using (public.current_role() in ('ADMIN', 'SUPER_ADMIN'))
  with check (public.current_role() in ('ADMIN', 'SUPER_ADMIN'));

-- Members/servants can read their own delivery records (for transparency)
create policy "deliveries_own_read" on public.notification_deliveries
  for select using (auth.uid() = recipient_profile_id);

-- ---------------------------------------------------------------------------
-- Birthday automation: the birthdays_for_today() function.
-- Returns all ACTIVE served members whose birthday falls on the given date
-- (or whose Feb-29 birthday maps to Feb-28 in non-leap years).
-- ---------------------------------------------------------------------------
create or replace function public.birthdays_for_today(target_date date)
returns table (
  profile_id    uuid,
  full_name     text,
  phone         text
)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name, p.phone
  from public.profiles p
  where p.role = 'SERVED_MEMBER'
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
$$;
