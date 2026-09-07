import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { registerUser } from "@/services/register-service"
import { validateRegistration, normalizePhone } from "@/lib/validation"
import type { RegistrationPayload } from "@/lib/types"

/**
 * Public registration endpoint.
 * Only creates SERVED_MEMBER / SERVANT accounts — never admin roles.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY server-side. The response never
 * contains the password, and user creation happens inside Supabase Auth.
 */
export async function POST(request: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { ok: false, message: "الخدمة غير متاحة الآن" },
      { status: 500 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, message: "بيانات غير صحيحة" }, { status: 400 })
  }

  const raw = (body ?? {}) as Record<string, unknown>
  const validation = validateRegistration(raw)
  if (!validation.ok) {
    return NextResponse.json(
      { ok: false, field: validation.field, message: validation.message },
      { status: 400 }
    )
  }

  const payload: RegistrationPayload = {
    role: raw.role as RegistrationPayload["role"],
    fullName: raw.fullName as string,
    phone: normalizePhone(raw.phone as string),
    password: raw.password as string,
    dateOfBirth: (raw.dateOfBirth as string | undefined) || undefined,
    address: (raw.address as string | undefined) || undefined,
    fatherPhone: (raw.fatherPhone as string | undefined)
      ? normalizePhone(raw.fatherPhone as string)
      : undefined,
    motherPhone: (raw.motherPhone as string | undefined)
      ? normalizePhone(raw.motherPhone as string)
      : undefined,
  }

  const admin = createAdminClient()
  const result = await registerUser(admin, payload)

  if (!result.ok) {
    const status = result.message === "رقم الموبايل مسجّل بالفعل" ? 409 : 400
    return NextResponse.json({ ok: false, field: result.field, message: result.message }, { status })
  }

  return NextResponse.json(
    {
      ok: true,
      profile: { id: result.profileId, role: payload.role },
    },
    { status: 201 }
  )
}