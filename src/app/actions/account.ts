"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  createPrivilegedUser,
  adminResetUserPassword,
  isPrivilegedRole,
  type PrivilegedRole,
} from "@/services/privileged-user-service"
import { logAudit } from "@/services/auth-service"
import { ROLES } from "@/lib/roles"
import { normalizePhone } from "@/lib/validation"

const PHONE_RE = /^\+?[0-9]{10,15}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type AdminCreatePrivilegedPayload = {
  role: PrivilegedRole
  fullName: string
  phone: string
  email?: string
  password: string
  confirmPassword: string
}

export type AdminCreatePrivilegedResult =
  | { ok: true; userId: string }
  | { ok: false; field?: string; message: string }

/**
 * Creates an ADMIN / SUPER_ADMIN account. SUPER_ADMIN only.
 * The actor is verified from the user session (never trusted from the
 * browser body), and the privileged-user service creates the auth user,
 * profile, and admin_profiles row server-side.
 */
export async function adminCreatePrivilegedUserAction(
  payload: AdminCreatePrivilegedPayload
): Promise<AdminCreatePrivilegedResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: "غير مصرح" }

  const { data: actor } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()
  if (!actor || actor.role !== ROLES.SUPER_ADMIN) {
    return { ok: false, message: "غير مصرح" }
  }

  if (!isPrivilegedRole(payload.role)) {
    return { ok: false, message: "نوع الحساب غير مسموح به" }
  }

  const fullName = payload.fullName.trim()
  if (fullName.length < 2) {
    return { ok: false, field: "fullName", message: "اكتب الاسم بالكامل" }
  }
  if (!PHONE_RE.test(payload.phone.trim())) {
    return { ok: false, field: "phone", message: "اكتب رقم موبايل صحيح" }
  }
  const email = payload.email?.trim()
  if (email && !EMAIL_RE.test(email.toLowerCase())) {
    return { ok: false, field: "email", message: "اكتب إيميل صحيح" }
  }
  if (payload.password !== payload.confirmPassword) {
    return { ok: false, field: "confirmPassword", message: "كلمة المرور غير متطابقة" }
  }
  if (payload.password.length < 8) {
    return { ok: false, field: "password", message: "كلمة المرور 8 أحرف على الأقل" }
  }

  const admin = createAdminClient()
  return createPrivilegedUser(admin, user.id, {
    role: payload.role,
    fullName,
    phone: payload.phone,
    email: email || undefined,
    password: payload.password,
  })
}

export type AdminResetPasswordResult = {
  ok: boolean
  message: string
  field?: string
}

/**
 * Super-admin initiated password reset for any account, including
 * phone-only accounts that cannot self-recover by email.
 */
export async function adminResetPasswordAction(
  userId: string,
  newPassword: string
): Promise<AdminResetPasswordResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: "غير مصرح" }

  const { data: actor } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()
  if (!actor || actor.role !== ROLES.SUPER_ADMIN) {
    return { ok: false, message: "غير مصرح" }
  }

  const admin = createAdminClient()
  return adminResetUserPassword(admin, user.id, userId, newPassword)
}

export type ChangeMyPasswordPayload = {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

/**
 * Changes the current user's own password.
 * The current password is verified server-side by re-authenticating with
 * the user's stored sign-in identifier before any change is applied.
 * Audit entry records the actor only — never the password.
 */
export async function changeMyPasswordAction(
  payload: ChangeMyPasswordPayload
): Promise<{ ok: boolean; message: string; field?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: "غير مصرح" }

  const { data: profile } = await supabase
    .from("profiles")
    .select("phone, auth_email")
    .eq("id", user.id)
    .maybeSingle()
  if (!profile) return { ok: false, message: "غير مصرح" }

  if (!payload.currentPassword) {
    return { ok: false, field: "currentPassword", message: "اكتب كلمة المرور الحالية" }
  }
  if (payload.newPassword !== payload.confirmPassword) {
    return { ok: false, field: "confirmPassword", message: "كلمة المرور غير متطابقة" }
  }
  if (payload.newPassword.length < 8) {
    return { ok: false, field: "newPassword", message: "كلمة المرور 8 أحرف على الأقل" }
  }

  const identifiers = [
    normalizePhone(profile.phone),
    ...(profile.auth_email ? [profile.auth_email] : []),
  ]

  let verified = false
  for (const identifier of identifiers) {
    const isEmail = identifier.includes("@")
    const { error } = isEmail
      ? await supabase.auth.signInWithPassword({ email: identifier, password: payload.currentPassword })
      : await supabase.auth.signInWithPassword({ phone: identifier, password: payload.currentPassword })
    if (!error) {
      verified = true
      break
    }
  }

  if (!verified) {
    return { ok: false, field: "currentPassword", message: "كلمة المرور الحالية غير صحيحة" }
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: payload.newPassword })
  if (updateError) {
    return { ok: false, message: "تعذر تحديث كلمة المرور، حاول مرة أخرى" }
  }

  const admin = createAdminClient()
  await logAudit(admin, {
    actorId: user.id,
    action: "PASSWORD_CHANGED",
    entity: "PROFILE",
    entityId: user.id,
    metadata: { initiator: "self" },
  })

  return { ok: true, message: "تم تغيير كلمة المرور ✓" }
}

/**
 * Completes the email recovery flow: the cookie session (persisted by the
 * auth callback page) is used to set a brand-new password, then the session
 * is signed out so the user re-signs-in with the new credentials.
 */
export async function resetPasswordAction(
  newPassword: string,
  confirmPassword: string
): Promise<{ ok: boolean; message: string; field?: string }> {
  if (newPassword !== confirmPassword) {
    return { ok: false, field: "confirmPassword", message: "كلمة المرور غير متطابقة" }
  }
  if (newPassword.length < 8) {
    return { ok: false, field: "newPassword", message: "كلمة المرور 8 أحرف على الأقل" }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) {
    if (/session/i.test(error.message)) {
      return { ok: false, field: "general", message: "انتهت الجلسة — اطلب رابطًا جديدًا" }
    }
    return { ok: false, field: "general", message: "تعذر تحديث كلمة المرور، حاول مرة أخرى" }
  }

  await supabase.auth.signOut()
  return { ok: true, message: "تم تحديث كلمة المرور ✓" }
}