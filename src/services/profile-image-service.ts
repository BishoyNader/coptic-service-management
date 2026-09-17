/**
 * Profile Image domain service.
 *
 * Writes go through the service-role client AFTER the calling server action has
 * verified the actor's role (mirroring e.g. `profile_image_path` / the storage
 * RLS policies). The bucket is PRIVATE, so `profiles.avatar_url` stores a
 * 1-year SIGNED URL — images render for authenticated users without ever
 * exposing the bucket.
 *
 * Validation is content-based: a real magic-byte sniff (jpeg/png/webp/avif)
 * rejects renamed files and any non-image payload before it can reach storage.
 */
import type { SupabaseAdminClient } from "@/lib/supabase/admin"
import { logAudit } from "@/services/auth-service"

export const PROFILE_IMAGE_BUCKET = "profile-images"
export const PROFILE_IMAGE_MAX_BYTES = 3 * 1024 * 1024
export const PROFILE_IMAGE_SIGNED_URL_TTL = 365 * 24 * 60 * 60 // 1 year

const MIME_BY_TYPE: Record<MagicImageType, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
}

export type MagicImageType = "jpeg" | "png" | "webp" | "avif"

const MAGIC: Record<MagicImageType, (b: Uint8Array) => boolean> = {
  // FF D8 FF
  jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  // 89 50 4E 47 0D 0A 1A 0A
  png: (b) =>
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a,
  // "RIFF" <size> "WEBP"
  webp: (b) =>
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50,
  // ISO BMFF container: <size> "ftyp" <brand> where brand is avif/avis
  avif: (b) => {
    if (b.length < 12) return false
    if (b[4] !== 0x66 || b[5] !== 0x74 || b[6] !== 0x79 || b[7] !== 0x70)
      return false
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11])
    return brand === "avif" || brand === "avis"
  },
}

/** Sniffs the real image container type of a buffer; null when not an image. */
export function sniffImageType(buffer: Uint8Array): MagicImageType | null {
  if (buffer.length < 8) return null
  const types = Object.keys(MAGIC) as MagicImageType[]
  for (const type of types) {
    if (MAGIC[type](buffer)) return type
  }
  return null
}

/** The stored (signed) avatar URL of a profile, or null when none. */
export async function getProfileImageUrl(
  admin: SupabaseAdminClient,
  profileId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("profiles")
    .select("avatar_url")
    .eq("id", profileId)
    .maybeSingle()
  const url = (data as { avatar_url?: string | null } | null)?.avatar_url
  return url && url.trim().length > 0 ? url : null
}

export type ProfileImageUploadResult =
  | { ok: true; avatarUrl: string; message: string }
  | { ok: false; message: string }

/**
 * Validates + stores the `avatar` File from `files` at
 * `profiles/<profileId>/avatar.<ext>` and records a 1-year signed URL on
 * `profiles.avatar_url`. `actorId` is the verified caller (audit only).
 */
export async function uploadProfileImageForUser(
  admin: SupabaseAdminClient,
  files: FormData,
  profileId: string,
  actorId: string,
): Promise<ProfileImageUploadResult> {
  const avatar = files.get("avatar")
  if (!(avatar instanceof File)) {
    return { ok: false, message: "ارفع صورة أولاً" }
  }
  if (avatar.size === 0) {
    return { ok: false, message: "الملف المرفوع فارغ" }
  }
  if (avatar.size > PROFILE_IMAGE_MAX_BYTES) {
    return { ok: false, message: "حجم الصورة يجب أن يكون أقل من 3 ميجابايت" }
  }

  const buffer = new Uint8Array(await avatar.arrayBuffer())
  const type = sniffImageType(buffer)
  if (!type) {
    return {
      ok: false,
      message: "الملف ليس صورة — يُسمح فقط بـ JPG أو PNG أو WEBP أو AVIF",
    }
  }

  const path = `profiles/${profileId}/avatar.${type}`
  const { error: uploadError } = await admin.storage
    .from(PROFILE_IMAGE_BUCKET)
    .upload(path, buffer, {
      contentType: MIME_BY_TYPE[type],
      upsert: true,
    })
  if (uploadError) {
    return { ok: false, message: "تعذر رفع الصورة" }
  }

  const { data: signed, error: signedError } = await admin.storage
    .from(PROFILE_IMAGE_BUCKET)
    .createSignedUrl(path, PROFILE_IMAGE_SIGNED_URL_TTL)
  if (signedError || !signed?.signedUrl) {
    return { ok: false, message: "تعذر رفع الصورة" }
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update({
      avatar_url: signed.signedUrl,
      profile_image_updated_at: new Date().toISOString(),
    })
    .eq("id", profileId)
  if (updateError) {
    return { ok: false, message: "تعذر حفظ صورة الملف الشخصي" }
  }

  await logAudit(admin, {
    actorId,
    action: "PROFILE_IMAGE_UPDATED",
    entity: "PROFILE",
    entityId: profileId,
  }).catch(() => {})

  return {
    ok: true,
    avatarUrl: signed.signedUrl,
    message: "تم حفظ الصورة الشخصية ✓",
  }
}

/**
 * Removes every object under `profiles/<profileId>/` and nulls `avatar_url`.
 * `actorId` is the verified caller (audit only).
 */
export async function deleteProfileImageForUser(
  admin: SupabaseAdminClient,
  profileId: string,
  actorId: string,
): Promise<{ ok: boolean; message: string }> {
  const folder = `profiles/${profileId}`
  const { data: objects } = await admin.storage
    .from(PROFILE_IMAGE_BUCKET)
    .list(folder)
  const paths = (objects ?? []).map((o) => `${folder}/${o.name}`)
  if (paths.length > 0) {
    const { error: removeError } = await admin.storage
      .from(PROFILE_IMAGE_BUCKET)
      .remove(paths)
    if (removeError) {
      return { ok: false, message: "تعذر حذف الصورة" }
    }
  }

  const { error } = await admin
    .from("profiles")
    .update({
      avatar_url: null,
      profile_image_updated_at: new Date().toISOString(),
    })
    .eq("id", profileId)
  if (error) {
    return { ok: false, message: "تعذر حذف صورة الملف الشخصي" }
  }

  await logAudit(admin, {
    actorId,
    action: "PROFILE_IMAGE_DELETED",
    entity: "PROFILE",
    entityId: profileId,
  }).catch(() => {})

  return { ok: true, message: "تم حذف صورة الملف الشخصي ✓" }
}
