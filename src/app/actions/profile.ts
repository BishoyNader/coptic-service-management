"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { updateMyProfile, updateProfileById } from "@/services/profile-service"
import {
  createAdminUser,
  adminChangeStatus,
  type AdminCreateUserInput,
} from "@/services/admin-user-service"
import {
  ROLES,
  isAdminRole,
  type AppRole,
} from "@/lib/roles"
import { validateRegistration, isUuid } from "@/lib/validation"
import { logAudit } from "@/services/auth-service"

export type ProfileUpdatePayload = {
  fullName: string
  phone: string
  dateOfBirth: string
  address?: string
  fatherPhone?: string
  motherPhone?: string
}

export async function updateProfileAction(payload: ProfileUpdatePayload) {
  const supabase = await createClient()
  return updateMyProfile(supabase, {
    full_name: payload.fullName,
    phone: payload.phone,
    date_of_birth: payload.dateOfBirth || null,
    address: payload.address || null,
    father_phone: payload.fatherPhone || null,
    mother_phone: payload.motherPhone || null,
  })
}

export async function adminUpdateProfileAction(
  id: string,
  payload: ProfileUpdatePayload & { status?: "ACTIVE" | "INACTIVE" }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: "غير مصرح" }
  if (!isUuid(id)) return { ok: false, message: "بيانات غير صحيحة" }

  const { data: adminProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  if (!adminProfile || !isAdminRole(adminProfile.role)) {
    return { ok: false, message: "غير مصرح" }
  }

  const result = await updateProfileById(supabase, id, {
    full_name: payload.fullName,
    phone: payload.phone,
    date_of_birth: payload.dateOfBirth || null,
    address: payload.address || null,
    father_phone: payload.fatherPhone || null,
    mother_phone: payload.motherPhone || null,
    status: payload.status ?? "ACTIVE",
  })

  if (result.ok) {
    const admin = createAdminClient()
    await logAudit(admin, {
      actorId: user.id,
      action: "PROFILE_UPDATED",
      entity: "PROFILE",
      entityId: id,
      metadata: { updatedBy: user.id, status: payload.status },
    }).catch(() => {})
  }

  return result
}

export async function adminUpdateStatusAction(
  id: string,
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED"
) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: "غير مصرح" }
  if (!isUuid(id)) return { ok: false, message: "بيانات غير صحيحة" }

  const { data: adminProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  if (!adminProfile || !isAdminRole(adminProfile.role)) {
    return { ok: false, message: "غير مصرح" }
  }

  return adminChangeStatus(admin, user.id, adminProfile.role as AppRole, id, status)
}

type AdminCreateUserActionPayload = {
  role: Extract<AppRole, "SERVED_MEMBER" | "SERVANT">
  fullName: string
  phone: string
  password: string
  confirmPassword: string
  dateOfBirth?: string
  address?: string
  fatherPhone?: string
  motherPhone?: string
}

export type AdminCreateUserActionResult =
  | { ok: true; userId: string; code: string; qrToken: string }
  | { ok: false; field?: string; message: string }

/**
 * Creates a SERVED_MEMBER / SERVANT account on behalf of an admin.
 * - ADMIN may only create SERVED_MEMBER.
 * - SUPER_ADMIN may create SERVED_MEMBER or SERVANT.
 * Uses the service-role client internally; the caller's identity is verified
 * first with the session client so RLS semantics for the actor are preserved.
 */
export async function adminCreateUserAction(
  payload: AdminCreateUserActionPayload
): Promise<AdminCreateUserActionResult> {
  const { role } = payload

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: "غير مصرح" }

  const { data: adminProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  if (!adminProfile || !isAdminRole(adminProfile.role)) {
    return { ok: false, message: "غير مصرح" }
  }

  if (role !== ROLES.SERVED_MEMBER && role !== ROLES.SERVANT) {
    return { ok: false, message: "نوع الحساب غير مسموح به" }
  }

  if (adminProfile.role === ROLES.ADMIN && role !== ROLES.SERVED_MEMBER) {
    return { ok: false, message: "مسؤول الخدمة يمكنه إضافة مخدومين فقط" }
  }

  const validation = validateRegistration({
    role,
    fullName: payload.fullName,
    phone: payload.phone,
    password: payload.password,
    confirmPassword: payload.confirmPassword,
    dateOfBirth: payload.dateOfBirth,
    fatherPhone: payload.fatherPhone,
    motherPhone: payload.motherPhone,
  })
  if (!validation.ok) return validation

  const adminClient = createAdminClient()
  const input: AdminCreateUserInput = {
    role,
    fullName: payload.fullName,
    phone: payload.phone,
    password: payload.password,
    dateOfBirth: payload.dateOfBirth,
    address: payload.address,
    fatherPhone: payload.fatherPhone,
    motherPhone: payload.motherPhone,
  }

  return createAdminUser(adminClient, user.id, input)
}
