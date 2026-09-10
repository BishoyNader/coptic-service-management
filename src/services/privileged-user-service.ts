import type { SupabaseAdminClient } from "@/lib/supabase/admin"
import { logAudit } from "./auth-service"
import { normalizePhone } from "@/lib/validation"
import { ROLES, type AppRole } from "@/lib/roles"

/**
 * Privileged roles that can only be granted by a SUPER_ADMIN.
 * These accounts never receive a personal code/QR — they are staff, not
 * served members, and their check-in presence is not scored.
 */
export const PRIVILEGED_ROLES = [ROLES.ADMIN, ROLES.SUPER_ADMIN] as const

export type PrivilegedRole = (typeof PRIVILEGED_ROLES)[number]

export function isPrivilegedRole(role: AppRole | null | undefined): role is PrivilegedRole {
  return role === ROLES.ADMIN || role === ROLES.SUPER_ADMIN
}

export type AdminCreatePrivilegedInput = {
  role: PrivilegedRole
  fullName: string
  phone: string
  email?: string
  password: string
}

export type AdminCreatePrivilegedResult =
  | { ok: true; userId: string }
  | { ok: false; field?: string; message: string }

/**
 * Creates an ADMIN / SUPER_ADMIN account on behalf of a SUPER_ADMIN.
 *
 * Runs entirely server-side using the service-role client because it must
 * create an auth user (password hashing handled by Supabase Auth), the
 * profile row, and the `admin_profiles` detail row — then audit the action.
 *
 * Security notes:
 *  - The actor must already be verified as SUPER_ADMIN by the caller before
 *    this function is reached; the server action performs that check.
 *  - The initial password is only set inside Supabase Auth and is never
 *    stored in `profiles` nor returned in the response body.
 *  - Privileged accounts are intentionally created WITHOUT a personal code
 *    or QR token: they are staff who never check in as served members.
 *  - `auth_email` is captured (optional) so email recovery works for staff
 *    accounts that log in with an email.
 */
export async function createPrivilegedUser(
  admin: SupabaseAdminClient,
  actorId: string,
  input: AdminCreatePrivilegedInput
): Promise<AdminCreatePrivilegedResult> {
  const { role, fullName, phone, password } = input
  const normalizedPhone = normalizePhone(phone)
  const normalizedEmail = input.email?.trim().toLowerCase() || null

  const { data: existingPhone } = await admin
    .from("profiles")
    .select("id")
    .eq("phone", normalizedPhone)
    .maybeSingle()
  if (existingPhone) {
    return { ok: false, field: "phone", message: "رقم الموبايل مسجّل بالفعل" }
  }

  if (normalizedEmail) {
    const { data: existingEmail } = await admin
      .from("profiles")
      .select("id")
      .eq("auth_email", normalizedEmail)
      .maybeSingle()
    if (existingEmail) {
      return { ok: false, field: "email", message: "الإيميل مسجّل بالفعل" }
    }
  }

  const { data: authResult, error: authError } = await admin.auth.admin.createUser({
    phone: normalizedPhone,
    ...(normalizedEmail ? { email: normalizedEmail } : {}),
    password,
    phone_confirm: true,
    email_confirm: true,
    user_metadata: {
      full_name: fullName.trim(),
      role,
    },
  })

  if (authError) {
    if (authError.code === "user_already_exists" || /already registered/i.test(authError.message)) {
      return { ok: false, field: "phone", message: "رقم الموبايل مسجّل بالفعل" }
    }
    return { ok: false, message: "تعذر إنشاء الحساب، حاول مرة أخرى" }
  }

  const userId = authResult.user.id

  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    role,
    full_name: fullName.trim(),
    phone: normalizedPhone,
    auth_email: normalizedEmail,
  })

  if (profileError) {
    await admin.auth.admin.deleteUser(userId)
    return { ok: false, message: "تعذر حفظ البيانات، حاول مرة أخرى" }
  }

  const { error: adminProfileError } = await admin.from("admin_profiles").insert({
    profile_id: userId,
  })

  if (adminProfileError) {
    await admin.auth.admin.deleteUser(userId)
    return { ok: false, message: "تعذر حفظ البيانات، حاول مرة أخرى" }
  }

  await logAudit(admin, {
    actorId,
    action: "PRIVILEGED_USER_CREATED",
    entity: "PROFILE",
    entityId: userId,
    metadata: { role, createdBy: actorId },
    next: { full_name: fullName.trim(), phone: normalizedPhone, has_email: !!normalizedEmail },
  })

  return { ok: true, userId }
}

export type AdminResetPasswordResult = {
  ok: boolean
  message: string
  field?: string
}

/**
 * Super-admin initiated password reset for any account.
 *
 * Sets a new password directly through the Supabase admin API (handles the
 * phone-only accounts that cannot self-recover by email) and records an
 * audit entry. The new password is never stored in the profiles table and
 * never written to the audit log.
 */
export async function adminResetUserPassword(
  admin: SupabaseAdminClient,
  actorId: string,
  targetId: string,
  newPassword: string
): Promise<AdminResetPasswordResult> {
  if (newPassword.length < 8) {
    return { ok: false, field: "newPassword", message: "كلمة المرور 8 أحرف على الأقل" }
  }

  const { data: target } = await admin
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", targetId)
    .maybeSingle()

  if (!target) {
    return { ok: false, message: "الحساب غير موجود" }
  }

  const { error } = await admin.auth.admin.updateUserById(targetId, { password: newPassword })
  if (error) {
    return { ok: false, message: "تعذر تحديث كلمة المرور، حاول مرة أخرى" }
  }

  await logAudit(admin, {
    actorId,
    action: "PASSWORD_RESET",
    entity: "PROFILE",
    entityId: targetId,
    metadata: {
      full_name: target.full_name,
      role: target.role,
      reset_by: actorId,
    },
  })

  return { ok: true, message: "تم تحديث كلمة المرور ✓" }
}