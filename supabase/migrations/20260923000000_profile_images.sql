-- ============================================================================
-- Profile Images — Part 1: App-level objects (safe for supabase db push)
--
--   * A PRIVATE `profile-images` storage bucket (no public read).
--   * profiles columns: `avatar_url` + `profile_image_updated_at`.
--   * Helper function: profile_image_path().
--
-- Storage RLS policies on storage.objects require supabase_storage_admin
-- ownership and must be applied manually via the Supabase SQL Editor.
-- See: supabase/sql/001_profile_images_storage_rls.sql
--
-- Idempotent: DO blocks / IF NOT EXISTS / CREATE OR REPLACE make it safe
-- to re-apply.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Private storage bucket (idempotent). 3 MB cap matches the app's client cap.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'profile-images') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'profile-images',
      'profile-images',
      false,
      3145728,
      array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- profiles columns
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists avatar_url text;
alter table public.profiles
  add column if not exists profile_image_updated_at timestamptz;

comment on column public.profiles.avatar_url is
  '1-year signed URL of the profile image inside the private profile-images bucket.';
comment on column public.profiles.profile_image_updated_at is
  'Last time the profile image was uploaded or removed.';

-- ---------------------------------------------------------------------------
-- Helper: storage folder base for a profile's images (profiles/<id>/)
-- ---------------------------------------------------------------------------
create or replace function public.profile_image_path(profile_id uuid)
returns text
language sql stable set search_path = public
as $$
  select 'profiles/' || profile_id::text;
$$;