-- ============================================================================
-- Profile Images
--
--   * A PRIVATE `profile-images` storage bucket (no public read).
--     `profiles.avatar_url` stores a 1-year SIGNED URL so images render for
--     authenticated users without ever exposing the bucket or its objects.
--   * profiles columns: `avatar_url` (ensure it exists) + `profile_image_updated_at`.
--   * Storage RLS scoped exactly to this bucket:
--       - any authenticated user can READ avatars,
--       - the owner (the member the profile belongs to) uploads/updates/deletes
--         objects at `profiles/<own-id>/<file>`,
--       - SUPER_ADMIN can manage any object in the bucket.
--
-- Idempotent: DO blocks / IF NOT EXISTS / DROP POLICY IF EXISTS make it safe
-- to re-apply (e.g. `supabase db reset` + push, or ad-hoc SQL editor runs).
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

-- ---------------------------------------------------------------------------
-- Storage RLS — scoped to bucket_id = 'profile-images' only.
-- ---------------------------------------------------------------------------
alter table storage.objects enable row level security;

-- Owner id of an object path like profiles/<profile-id>/<file>.
-- storage.foldername('profiles/abc/avatar.png') => {profiles, abc}, so [1] is
-- the fixed "profiles" prefix and [2] is the owning profile's uuid.
drop policy if exists "profile_images_read_authenticated" on storage.objects;
create policy "profile_images_read_authenticated" on storage.objects
  for select using (
    bucket_id = 'profile-images' and auth.uid() is not null
  );

drop policy if exists "profile_images_insert_owner" on storage.objects;
create policy "profile_images_insert_owner" on storage.objects
  for insert with check (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = 'profiles'
    and auth.uid()::text = (storage.foldername(name))[2]
  );

drop policy if exists "profile_images_update_owner" on storage.objects;
create policy "profile_images_update_owner" on storage.objects
  for update using (
    bucket_id = 'profile-images'
    and auth.uid()::text = (storage.foldername(name))[2]
  )
  with check (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = 'profiles'
    and auth.uid()::text = (storage.foldername(name))[2]
  );

drop policy if exists "profile_images_delete_owner" on storage.objects;
create policy "profile_images_delete_owner" on storage.objects
  for delete using (
    bucket_id = 'profile-images'
    and auth.uid()::text = (storage.foldername(name))[2]
  );

drop policy if exists "profile_images_admin_all" on storage.objects;
create policy "profile_images_admin_all" on storage.objects
  for all using (
    bucket_id = 'profile-images' and public.current_role() = 'SUPER_ADMIN'
  )
  with check (
    bucket_id = 'profile-images' and public.current_role() = 'SUPER_ADMIN'
  );