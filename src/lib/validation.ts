import type { AppRole } from "./roles"
import { PUBLIC_REGISTRATION_ROLES } from "./roles"

export type ValidationResult =
  | { ok: true }
  | { ok: false; field?: string; message: string }

const PHONE_RE = /^\+?[0-9]{10,15}$/
const NUMERIC_DIGITS = /^\d+$/

export function isPublicRole(role: string): role is AppRole {
  return (PUBLIC_REGISTRATION_ROLES as readonly string[]).includes(role)
}

export function validateRegistration(input: Record<string, unknown>): ValidationResult {
  const role = input.role
  if (typeof role !== "string" || !isPublicRole(role)) {
    return { ok: false, message: "اختر نوع الحساب — خادم أو مخدوم" }
  }

  const fullName = typeof input.fullName === "string" ? input.fullName.trim() : ""
  if (fullName.length < 2) {
    return { ok: false, field: "fullName", message: "اكتب الاسم بالكامل" }
  }

  const phone = typeof input.phone === "string" ? input.phone.trim() : ""
  if (!PHONE_RE.test(phone)) {
    return {
      ok: false,
      field: "phone",
      message: "اكتب رقم موبايل صحيح (10–15 رقمًا)",
    }
  }

  const password = typeof input.password === "string" ? input.password : ""
  if (password.length < 8) {
    return {
      ok: false,
      field: "password",
      message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل",
    }
  }

  if (input.password !== input.confirmPassword) {
    return { ok: false, field: "confirmPassword", message: "كلمة المرور غير متطابقة" }
  }

  if (input.dateOfBirth !== undefined && input.dateOfBirth !== "") {
    if (typeof input.dateOfBirth !== "string" || isNaN(Date.parse(input.dateOfBirth))) {
      return { ok: false, field: "dateOfBirth", message: "تاريخ الميلاد غير صحيح" }
    }
  }

  for (const f of ["fatherPhone", "motherPhone"] as const) {
    const value = input[f]
    if (value !== undefined && value !== "" && typeof value === "string") {
      if (!PHONE_RE.test(value.trim())) {
        return { ok: false, field: f, message: "رقم الهاتف غير صحيح" }
      }
    }
  }

  return { ok: true }
}

export function normalizePhone(phone: string): string {
  const trimmed = phone.trim()
  if (NUMERIC_DIGITS.test(trimmed)) {
    if (trimmed.startsWith("0")) return trimmed.replace(/^0/, "+20")
    if (trimmed.startsWith("20") && trimmed.length >= 11) return `+${trimmed}`
    return `+${trimmed}`
  }
  return trimmed
}

/** Digests a password for nothing but validation length checks. */
export function hasMinPasswordLength(password: string): boolean {
  return password.length >= 8
}