-- ============================================================================
-- Profile Images — Storage RLS Policies
--
-- Run this in the Supabase Dashboard → SQL Editor (not via supabase db push).
-- storage.objects is owned by supabase_storage_admin, so the migration runner
-- cannot ALTER it. These policies are safe to re-apply (DROP IF EXISTS).
-- ============================================================================

-- Enable RLS on storage.objects (no-op if already enabled).
alter table storage.objects enable row level security;

-- Any authenticated user can read profile images (private bucket, signed URLs).
drop policy if exists "profile_images_read_authenticated" on storage.objects;
create policy "profile_images_read_authenticated" on storage.objects
  for select using (
    bucket_id = 'profile-images' and auth.uid() is not null
  );

-- Owner uploads new images into their own folder: profiles/<own-id>/<file>.
drop policy if exists "profile_images_insert_owner" on storage.objects;
create policy "profile_images_insert_owner" on storage.objects
  for insert with check (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = 'profiles'
    and auth.uid()::text = (storage.foldername(name))[2]
  );

-- Owner can update their own images.
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

-- Owner can delete their own images.
drop policy if exists "profile_images_delete_owner" on storage.objects;
create policy "profile_images_delete_owner" on storage.objects
  for delete using (
    bucket_id = 'profile-images'
    and auth.uid()::text = (storage.foldername(name))[2]
  );

-- SUPER_ADMIN can manage any object in the bucket.
drop policy if exists "profile_images_admin_all" on storage.objects;
create policy "profile_images_admin_all" on storage.objects
  for all using (
    bucket_id = 'profile-images' and public.current_role() = 'SUPER_ADMIN'
  )
  with check (
    bucket_id = 'profile-images' and public.current_role() = 'SUPER_ADMIN'
  );
