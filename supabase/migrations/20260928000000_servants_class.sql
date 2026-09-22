-- Give servants a class (group) via the same classes table that groups
-- served members. The class desk on the super-admin side and the class-scoped
-- scoring board on the servant homepage group people by this FK.

alter table public.servants
  add column if not exists class_id uuid references public.classes(id) on delete set null;

create index if not exists idx_servants_class_id
  on public.servants (class_id);

comment on column public.servants.class_id is 'Servant''s assigned class — the canonical class linkage for servants.';