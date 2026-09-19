"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ROLES } from "@/lib/roles"
import { isUuid } from "@/lib/validation"
import {
  deleteProfileImageForUser,
  uploadProfileImageForUser,
  PROFILE_IMAGE_MAX_BYTES,
} from "@/services/profile-image-service"

const PROFILE_IMAGE_ROLES = [
  ROLES.SERVED_MEMBER,
  ROLES.SERVANT,
  ROLES.SUPER_ADMIN,
]

type ProfileImageActionResult = {
  ok: boolean
  message: string
  avatarUrl?: string
}

/**
 * Session-scoped role guard — mirrors the local `requireRoles` helper used by
 * the other action modules. Returns `{ actorId, role }` or null.
 */
async function requireRoles(
  allowed: string[],
): Promise<{ actorId: string; role: string } | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile || !allowed.includes(profile.role as string)) return null
  return { actorId: user.id, role: profile.role as string }
}

/**
 * Resolves the target profile id. Members/servants/admins always act on their
 * own id (a client-supplied target is rejected); SUPER_ADMIN may pass a
 * `targetProfileId` to manage any member's avatar.
 */
function resolveTargetId(
  formData: FormData,
  actor: { actorId: string; role: string },
): { id: string } | { error: string } {
  const raw = formData.get("targetProfileId")
  if (raw === null || typeof raw !== "string" || raw.trim().length === 0) {
    return { id: actor.actorId }
  }
  if (actor.role !== ROLES.SUPER_ADMIN) {
    return { error: "غير مصرح" }
  }
  if (!isUuid(raw.trim())) {
    return { error: "بيانات غير صحيحة" }
  }
  return { id: raw.trim() }
}

/**
 * Uploads the profile avatar. The browser sends the raw `avatar` file; the
 * real image type is sniffed from magic bytes (never the file name) and the
 * signed URL is derived server-side before being written to profiles.
 */
export async function uploadProfileImage(
  formData: FormData,
): Promise<ProfileImageActionResult> {
  const actor = await requireRoles(PROFILE_IMAGE_ROLES)
  if (!actor) return { ok: false, message: "غير مصرح" }

  const target = resolveTargetId(formData, actor)
  if ("error" in target) return { ok: false, message: target.error }

  const avatar = formData.get("avatar")
  if (avatar === null) {
    return { ok: false, message: "ارفع صورة أولاً" }
  }
  if (!(avatar instanceof File)) {
    return { ok: false, message: "بيانات غير صحيحة" }
  }
  if (avatar.size > PROFILE_IMAGE_MAX_BYTES) {
    return { ok: false, message: "حجم الصورة يجب أن يكون أقل من 3 ميجابايت" }
  }

  return uploadProfileImageForUser(
    createAdminClient(),
    formData,
    target.id,
    actor.actorId,
  )
}

/** Removes the avatar object and clears `profiles.avatar_url`. */
export async function deleteProfileImage(
  formData: FormData,
): Promise<ProfileImageActionResult> {
  const actor = await requireRoles(PROFILE_IMAGE_ROLES)
  if (!actor) return { ok: false, message: "غير مصرح" }

  const target = resolveTargetId(formData, actor)
  if ("error" in target) return { ok: false, message: target.error }

  const result = await deleteProfileImageForUser(
    createAdminClient(),
    target.id,
    actor.actorId,
  )
  return result
}
