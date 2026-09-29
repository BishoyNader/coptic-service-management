-- Church settings table — editable by SUPER_ADMIN only.
-- Stores church name, tagline, description, contact info, and service times
-- as editable content rather than hardcoded constants.
create table if not exists church_settings (
  id         text primary key default 'default',
  name       text not null default 'خدمتي',
  tagline    text not null default 'كنيسة السيدة العذراء - وادي حوف',
  description text,
  phone      text,
  email      text,
  address    text,
  service_times jsonb default '[]',
  updated_at timestamptz default now()
);

insert into church_settings (id, name, tagline, description) values
  ('default', 'خدمتي', 'كنيسة السيدة العذراء - وادي حوف',
   'نظام إدارة الخدمة للكنيسة، يدعم تسجيل الحضور، إدارة الدرجات، والأنشطة الكنسية بين أبناء الخدمة.')
on conflict (id) do nothing;

-- RLS: settings are readable by any authenticated user (church info is public),
-- writable by SUPER_ADMIN only.
alter table church_settings enable row level security;

create policy "church_settings_readable_by_all"
  on church_settings for select to authenticated
  using (true);

create policy "church_settings_writable_by_super_admin"
  on church_settings for all
  to authenticated
  using (auth.uid() in (select id from profiles where role = 'SUPER_ADMIN'))
  with check (auth.uid() in (select id from profiles where role = 'SUPER_ADMIN'));
