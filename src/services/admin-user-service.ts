import type { SupabaseAdminClient } from "@/lib/supabase/admin"
import { generateUniqueCodes, logAudit } from "./auth-service"
import { normalizePhone } from "@/lib/validation"
import type { AppRole } from "@/lib/roles"

export type AdminCreateUserInput = {
  role: Extract<AppRole, "SERVED_MEMBER" | "SERVANT">
  fullName: string
  phone: string
  password: string
  dateOfBirth?: string
  address?: string
  fatherPhone?: string
  motherPhone?: string
  /** Free-text class name — kept for legacy/import flows. */
  class?: string
  /** Schools/classes FK — standardized class linkage for both roles. */
  classId?: string
}

export type AdminCreateUserResult =
  | { ok: true; userId: string; code: string; qrToken: string }
  | { ok: false; field?: string; message: string }

/**
 * Manually creates a SERVED_MEMBER or SERVANT on behalf of an admin.
 *
 * Runs entirely server-side using the service-role client because it must:
 *   1. create an auth user (password hashing handled by Supabase Auth),
 *   2. create the profile + role detail row,
 *   3. mint a unique personal code + QR token,
 *   4. record the audit log.
 *
 * The `authEmail` field is left NULL — admins/manual users log in by phone.
 * The initial password is provided by the admin at creation time and treated
 * as sensitive: it is never stored in the profiles table and never returned
 * in the response body after creation (it is only set inside Supabase Auth).
 */
export async function createAdminUser(
  admin: SupabaseAdminClient,
  actorId: string,
  input: AdminCreateUserInput
): Promise<AdminCreateUserResult> {
  const { role, fullName, phone, password, dateOfBirth, address, fatherPhone, motherPhone, class: memberClass, classId } = input
  const normalizedPhone = normalizePhone(phone)

  const existing = await admin
    .from("profiles")
    .select("id")
    .eq("phone", normalizedPhone)
    .maybeSingle()

  if (existing.data) {
    return { ok: false, field: "phone", message: "رقم الموبايل مسجّل بالفعل" }
  }

  const codes = await generateUniqueCodes(admin)

  const { data: authResult, error: authError } = await admin.auth.admin.createUser({
    phone: normalizedPhone,
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
    date_of_birth: dateOfBirth || null,
    address: address || null,
    father_phone: fatherPhone ? normalizePhone(fatherPhone) : null,
    mother_phone: motherPhone ? normalizePhone(motherPhone) : null,
  })

  if (profileError) {
    await admin.auth.admin.deleteUser(userId)
    return { ok: false, message: "تعذر حفظ البيانات، حاول مرة أخرى" }
  }

  // Resolve the class FK (and keep the free-text name for legacy display on
  // served members) before creating the detail row.
  let resolvedClassName: string | null = null
  if (classId) {
    const { data: cls } = await admin
      .from("classes")
      .select("id, name, is_active")
      .eq("id", classId)
      .maybeSingle()
    if (!cls || cls.is_active === false) {
      return { ok: false, field: "classId", message: "الصف غير موجود" }
    }
    resolvedClassName = (cls.name as string) ?? null
  }

  const detailTable = role === "SERVED_MEMBER" ? "served_members" : "servants"
  const detailRow: Record<string, unknown> = { profile_id: userId }
  if (classId) {
    detailRow.class_id = classId
  } else if (role === "SERVED_MEMBER" && memberClass) {
    detailRow.class = memberClass
  }
  if (role === "SERVED_MEMBER" && (resolvedClassName ?? memberClass)) {
    detailRow.class = resolvedClassName ?? memberClass
  }
  const { error: detailError } = await admin.from(detailTable).insert(detailRow)

  if (detailError) {
    await admin.auth.admin.deleteUser(userId)
    return { ok: false, message: "تعذر حفظ البيانات، حاول مرة أخرى" }
  }

  const { error: personalCodesError } = await admin.from("personal_codes").insert({
    profile_id: userId,
    code: codes.code,
    qr_token: codes.qrToken,
  })

  if (personalCodesError) {
    await admin.auth.admin.deleteUser(userId)
    return { ok: false, message: "تعذر إنشاء الكود الشخصي" }
  }

  await logAudit(admin, {
    actorId,
    action: "USER_CREATED",
    entity: "PROFILE",
    entityId: userId,
    metadata: { role, createdBy: actorId },
    next: { full_name: fullName.trim(), phone: normalizedPhone },
  })

  return { ok: true, userId, code: codes.code, qrToken: codes.qrToken }
}

export type UpdateMemberClassResult = {
  ok: boolean
  message: string
  changed?: boolean
  className?: string
}

/**
 * Assigns a served member to a class (or moves them to another class).
 *
 * Validates the target class exists and is active, then keeps both the FK
 * (`class_id`) and the legacy free-text `class` column in sync. Every served
 * member must belong to one of the created classes, so this is a requirement
 * on both create and update.
 */
export async function updateMemberClass(
  admin: SupabaseAdminClient,
  profileId: string,
  classId: string
): Promise<UpdateMemberClassResult> {
  const { data: cls } = await admin
    .from("classes")
    .select("id, name, is_active")
    .eq("id", classId)
    .maybeSingle()

  if (!cls || cls.is_active === false) {
    return { ok: false, message: "الصف غير موجود" }
  }
  const className = (cls.name as string) ?? ""

  const { data: detail } = await admin
    .from("served_members")
    .select("profile_id, class_id")
    .eq("profile_id", profileId)
    .maybeSingle()

  if (detail && detail.class_id === classId) {
    return { ok: true, message: "تم تحديث البيانات بنجاح ✓", changed: false, className }
  }

  const { error } = await admin.from("served_members").upsert(
    { profile_id: profileId, class_id: classId, class: className },
    { onConflict: "profile_id" }
  )

  if (error) return { ok: false, message: "حدث خطأ أثناء حفظ الصف" }
  return { ok: true, message: "تم تحديث البيانات بنجاح ✓", changed: true, className }
}

/**
 * Admin change account status (ACTIVE / INACTIVE / ARCHIVED).
 * Never hard-deletes; historical data stays associated with the profile.
 *
 * Hierarchy guards (server-side):
 *  - A plain ADMIN can never change a SUPER_ADMIN account.
 *  - Nobody can change their OWN status (prevents self-lockout).
 */
export async function adminChangeStatus(
  admin: SupabaseAdminClient,
  actorId: string,
  actorRole: AppRole,
  targetId: string,
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED"
) {
  if (!["ACTIVE", "INACTIVE", "ARCHIVED"].includes(status)) {
    return { ok: false, message: "حالة غير صحيحة" }
  }
  if (targetId === actorId) {
    return { ok: false, message: "لا يمكنك تغيير حالة حسابك بنفسك" }
  }

  const { data: target, error: readError } = await admin
    .from("profiles")
    .select("id, status, full_name, role")
    .eq("id", targetId)
    .maybeSingle()

  if (readError || !target) {
    return { ok: false, message: "الحساب غير موجود" }
  }

  if (target.status === status) {
    return { ok: false, message: "الحساب بالفعل بهذه الحالة" }
  }

  if (target.role === "SUPER_ADMIN" && actorRole !== "SUPER_ADMIN") {
    return { ok: false, message: "لا يمكن تعديل حساب مسؤول عام من مسؤول خدمة" }
  }

  const { error } = await admin.from("profiles").update({ status }).eq("id", targetId)
  if (error) return { ok: false, message: "حدث خطأ أثناء تحديث الحالة" }

  await logAudit(admin, {
    actorId,
    action: "USER_STATUS_CHANGED",
    entity: "PROFILE",
    entityId: targetId,
    previous: { status: target.status },
    next: { status },
    metadata: { full_name: target.full_name, role: target.role, changedBy: actorId },
  })

  return { ok: true, message: "تم تحديث حالة الحساب" }
}
