import type { SupabaseAdminClient } from "@/lib/supabase/admin"
import type { RegistrationPayload } from "@/lib/types"
import { generateUniqueCodes, logAudit } from "./auth-service"

export type RegistrationResult =
  | { ok: true; userId: string; profileId: string; code: string; qrToken: string }
  | { ok: false; field?: string; message: string }

/**
 * Registers a publicly-signed-up SERVED_MEMBER or SERVANT.
 *
 * Runs entirely server-side using the service-role client because it must:
 *   1. create an auth user (password hashing handled by Supabase Auth),
 *   2. create the profile + role detail rows,
 *   3. mint a unique personal code + QR token,
 *   4. record the audit log — atomically as possible.
 */
export async function registerUser(
  admin: SupabaseAdminClient,
  payload: RegistrationPayload
): Promise<RegistrationResult> {
  const { role, fullName, phone, password, dateOfBirth, address, fatherPhone, motherPhone } = payload

  const existing = await admin
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .maybeSingle()

  if (existing.data) {
    return { ok: false, field: "phone", message: "رقم الموبايل مسجّل بالفعل" }
  }

  const codes = await generateUniqueCodes(admin)

  const { data: authResult, error: authError } = await admin.auth.admin.createUser({
    phone,
    password,
    phone_confirm: true,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
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
    phone,
    date_of_birth: dateOfBirth || null,
    address: address || null,
    father_phone: fatherPhone || null,
    mother_phone: motherPhone || null,
  })

  if (profileError) {
    await admin.auth.admin.deleteUser(userId)
    return { ok: false, message: "تعذر حفظ البيانات، حاول مرة أخرى" }
  }

  const detailTable = role === "SERVED_MEMBER" ? "served_members" : "servants"
  const { error: detailError } = await admin.from(detailTable).insert({ profile_id: userId })

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
    actorId: userId,
    action: "REGISTER",
    entity: "PROFILE",
    entityId: userId,
    metadata: { role },
    next: { full_name: fullName.trim(), phone },
  })

  return { ok: true, userId, profileId: userId, code: codes.code, qrToken: codes.qrToken }
}