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

/**
 * Updates the current user's own profile. RLS ensures only the
 * owning user can write to their row.
 */
export async function updateMyProfile(
  supabase: SupabaseServerClient,
  updates: Pick<
    Profile,
    | "full_name"
    | "phone"
    | "date_of_birth"
    | "address"
    | "father_phone"
    | "mother_phone"
  >
): Promise<{ ok: boolean; message: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: "غير مصرح" }

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: updates.full_name.trim(),
      phone: updates.phone.trim(),
      date_of_birth: updates.date_of_birth || null,
      address: updates.address || null,
      father_phone: updates.father_phone || null,
      mother_phone: updates.mother_phone || null,
    })
    .eq("id", user.id)

  if (error) return { ok: false, message: "حدث خطأ أثناء الحفظ" }
  return { ok: true, message: "تم تحديث البيانات بنجاح ✓" }
}

/**
 * Admin: updates any profile by id.
 */
export async function updateProfileById(
  supabase: SupabaseServerClient | SupabaseAdminClient,
  id: string,
  updates: Pick<
    Profile,
    | "full_name"
    | "phone"
    | "date_of_birth"
    | "address"
    | "father_phone"
    | "mother_phone"
    | "status"
  >
): Promise<{ ok: boolean; message: string }> {
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: updates.full_name.trim(),
      phone: updates.phone.trim(),
      date_of_birth: updates.date_of_birth || null,
      address: updates.address || null,
      father_phone: updates.father_phone || null,
      mother_phone: updates.mother_phone || null,
      ...(updates.status ? { status: updates.status } : {}),
    })
    .eq("id", id)

  if (error) return { ok: false, message: "حدث خطأ أثناء الحفظ" }
  return { ok: true, message: "تم تحديث البيانات بنجاح ✓" }
}