import type { SupabaseAdminClient } from "@/lib/supabase/admin"
import type { SupabaseServerClient } from "@/lib/supabase/server"
import type { Profile } from "@/lib/types"

/**
 * Fetches the current user's profile from a server Supabase client.
 * RLS ensures a user can only ever read their own profile.
 */
export async function getProfile(
  supabase: SupabaseServerClient
): Promise<Profile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle()

  return data
}

/** Fetches a profile by id (admins can target any profile via RLS). */
export async function getProfileById(
  supabase: SupabaseServerClient | SupabaseAdminClient,
  id: string
): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle()

  return data
}