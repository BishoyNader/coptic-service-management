"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { updateMyProfile, updateProfileById, updateServantManagedDob } from "@/services/profile-service"
import {
  createAdminUser,
  adminChangeStatus,
  updateMemberClass,
  type AdminCreateUserInput,
} from "@/services/admin-user-service"
import {
  ROLES,
  isStaffRole,
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
  payload: ProfileUpdatePayload & {
    status?: "ACTIVE" | "INACTIVE"
    /** Required for SERVED_MEMBER — they must belong to one of the created classes. */
    memberClassId?: string
  }
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

  if (!adminProfile || !isStaffRole(adminProfile.role)) {
    return { ok: false, message: "غير مصرح" }
  }

  const { data: target } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", id)
    .maybeSingle()
  if (!target) return { ok: false, message: "الحساب غير موجود" }

  // A served member must always be assigned to a class; resolve/validate the
  // class before touching the profile so the user is never left half-edited.
  let classChanged = false
  let className: string | undefined
  if (target.role === "SERVED_MEMBER") {
    if (!payload.memberClassId || !isUuid(payload.memberClassId)) {
      return { ok: false, field: "memberClass", message: "يجب اختيار الصف للمخدوم" }
    }
    const admin = createAdminClient()
    const clsRes = await updateMemberClass(admin, id, payload.memberClassId)
    if (!clsRes.ok) return { ok: false, field: "memberClass", message: clsRes.message }
    classChanged = !!clsRes.changed
    className = clsRes.className
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
      metadata: {
        updatedBy: user.id,
        status: payload.status,
        classChanged,
        memberClassId: payload.memberClassId,
        memberClass: className,
      },
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

  if (!adminProfile || !isStaffRole(adminProfile.role)) {
    return { ok: false, message: "غير مصرح" }
  }

  return adminChangeStatus(admin, user.id, adminProfile.role as AppRole, id, status)
}

/**
 * Servant: updates an ACTIVE SERVED_MEMBER's date of birth.
 *
 * The caller's identity and role are resolved server-side from the session —
 * never trusted from the client. Only the `date_of_birth` column is mutated
 * and only for an ACTIVE SERVED_MEMBER target, mirroring the existing
 * role-scoped member-management authorization model.
 */
export async function servantUpdateMemberDobAction(payload: {
  profileId: string
  dateOfBirth: string
}) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: "غير مصرح" }
  if (!isUuid(payload.profileId)) return { ok: false, message: "بيانات غير صحيحة" }

  const { data: actorProfile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle()

  if (!actorProfile || actorProfile.role !== ROLES.SERVANT) {
    return { ok: false, message: "غير مصرح" }
  }

  const result = await updateServantManagedDob(
    admin,
    { id: actorProfile.id as string, role: actorProfile.role as string },
    payload.profileId,
    payload.dateOfBirth || null
  )

  if (result.ok) {
    await logAudit(admin, {
      actorId: user.id,
      action: "PROFILE_UPDATED",
      entity: "PROFILE",
      entityId: payload.profileId,
      metadata: { updatedBy: user.id, scope: "SERVANT_MANAGED_DOB", dateOfBirth: payload.dateOfBirth || null },
    }).catch(() => {})
  }

  return result
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
  /** Free-text class name (legacy) — kept for import flows. */
  memberClass?: string
  /** Classes FK for both roles. */
  memberClassId?: string
}

export type AdminCreateUserActionResult =
  | { ok: true; userId: string; code: string; qrToken: string }
  | { ok: false; field?: string; message: string }

/**
 * Creates a SERVED_MEMBER / SERVANT account on behalf of staff.
 * Staff (SERVANT / SUPER_ADMIN) may create both SERVED_MEMBER and SERVANT.
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

  if (!adminProfile || !isStaffRole(adminProfile.role)) {
    return { ok: false, message: "غير مصرح" }
  }

  if (role !== ROLES.SERVED_MEMBER && role !== ROLES.SERVANT) {
    return { ok: false, message: "نوع الحساب غير مسموح به" }
  }

  if (
    role === ROLES.SERVED_MEMBER &&
    (!payload.memberClassId || !isUuid(payload.memberClassId))
  ) {
    return { ok: false, field: "memberClass", message: "يجب اختيار الصف للمخدوم" }
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
    class: payload.memberClass,
    classId: payload.memberClassId,
  }

  return createAdminUser(adminClient, user.id, input)
}
