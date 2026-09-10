import type { AppRole } from "./roles"
import { PUBLIC_REGISTRATION_ROLES } from "./roles"

export type ValidationResult =
  | { ok: true }
  | { ok: false; field?: string; message: string }

const PHONE_RE = /^\+?[0-9]{10,15}$/
const NUMERIC_DIGITS = /^\d+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** True for a well-formed v4-style UUID string (defense against junk input). */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value)
}

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const [y, m, d] = value.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function isFutureDate(value: string): boolean {
  if (!isRealDate(value)) return false
  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return new Date(`${value}T00:00:00.000Z`) > today
}

/** Validates a "YYYY-MM-DD" date-of-birth input; returns an error or null. */
export function validateDateOfBirth(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") return null
  if (typeof value !== "string") return "تاريخ الميلاد غير صحيح"
  if (!isRealDate(value)) return "تاريخ الميلاد غير صحيح"
  if (isFutureDate(value)) return "تاريخ الميلاد لا يمكن أن يكون في المستقبل"
  return null
}

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
    if (typeof input.dateOfBirth !== "string") {
      return { ok: false, field: "dateOfBirth", message: "تاريخ الميلاد غير صحيح" }
    }
    const dobError = validateDateOfBirth(input.dateOfBirth)
    if (dobError) return { ok: false, field: "dateOfBirth", message: dobError }
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