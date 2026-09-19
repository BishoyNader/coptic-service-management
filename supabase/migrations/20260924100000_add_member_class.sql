-- Add 'class' column to served_members so members can be grouped by class.
-- Nullable: existing rows and SERVANT/ADMIN accounts have no class.

alter table public.served_members
  add column if not exists class text;
