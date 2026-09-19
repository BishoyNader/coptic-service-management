-- Classes table: predefined class/grade names managed by Super Admin.
-- served_members.class becomes a FK referencing this table instead of free text.

create table if not exists public.classes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.classes is 'Predefined class/grade names for grouping served members.';

-- RLS: only super_admin can manage; staff can read.
alter table public.classes enable row level security;

create policy "classes_super_admin_all"
  on public.classes for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "classes_staff_read"
  on public.classes for select
  using (public.is_staff());

-- Now migrate existing free-text class values into the classes table.
-- Insert distinct non-empty class values that don't already exist.
insert into public.classes (name, sort_order)
  select distinct sm.class,
    row_number() over (order by sm.class)
  from public.served_members sm
  where sm.class is not null
    and trim(sm.class) <> ''
    and not exists (select 1 from public.classes c where c.name = sm.class)
on conflict (name) do nothing;

-- Add class_id FK column to served_members.
alter table public.served_members
  add column if not exists class_id uuid references public.classes(id) on delete set null;

-- Backfill class_id from the free-text class column.
update public.served_members sm
  set class_id = c.id
  from public.classes c
  where sm.class = c.name
    and sm.class_id is null;

-- Create an index for fast lookups.
create index if not exists idx_served_members_class_id
  on public.served_members (class_id);

-- Add updated_at trigger for classes.
create or replace function public.handle_classes_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists classes_updated_at on public.classes;
create trigger classes_updated_at
  before update on public.classes
  for each row execute function public.handle_classes_updated_at();
