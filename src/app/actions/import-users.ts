"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { createAdminUser, type AdminCreateUserInput } from "@/services/admin-user-service"
import { ROLES, type AppRole } from "@/lib/roles"
import { normalizePhone } from "@/lib/validation"
import { getProfile } from "@/services/profile-service"
import { consumeRateLimit, exportKey, ratePolicy } from "@/lib/rate-limit"

const VALID_PHONE = /^\+?[0-9]{10,15}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_ROWS = 500
const DEFAULT_PASSWORD = "12345678"

export type ImportRow = {
  fullName: string
  phone: string
  dateOfBirth?: string
  fatherPhone?: string
  motherPhone?: string
  address?: string
}

export type ImportResult = {
  row: number
  ok: boolean
  message: string
  fullName?: string
  phone?: string
  code?: string
}

type ImportActionResult =
  | { ok: true; results: ImportResult[]; created: number; failed: number }
  | { ok: false; message: string }

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const [y, m, d] = value.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function pick(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k]
    if (typeof v === "string" && v.trim()) return v.trim()
    if (typeof v === "number") return String(v)
  }
  return ""
}

function parseDob(raw: string): string | undefined {
  if (!raw) return undefined
  if (isRealDate(raw)) return raw
  const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (m) {
    const candidate = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
    if (isRealDate(candidate)) return candidate
  }
  return undefined
}

function validateRow(
  row: Record<string, unknown>,
  role: AppRole,
  rowNumber: number,
): { ok: true; input: AdminCreateUserInput } | { ok: false; message: string } {
  const fullName = pick(row, "الاسم", "name")
  if (fullName.length < 2) return { ok: false, message: `الصف ${rowNumber}: الاسم قصير جدًا` }

  const phoneRaw = pick(row, "الموبايل", "phone")
  if (!phoneRaw) return { ok: false, message: `الصف ${rowNumber}: رقم الموبايل مطلوب` }

  const normalizedPhone = normalizePhone(phoneRaw)
  if (!VALID_PHONE.test(normalizedPhone)) {
    return { ok: false, message: `الصف ${rowNumber}: رقم الموبايل غير صحيح (${phoneRaw})` }
  }

  const dobRaw = pick(row, "تاريخ الميلاد", "dob", "date_of_birth")
  const dateOfBirth = parseDob(dobRaw)
  if (dobRaw && !dateOfBirth) {
    return { ok: false, message: `الصف ${rowNumber}: تاريخ الميلاد غير صحيح (${dobRaw})` }
  }

  const passwordRaw = pick(row, "كلمة المرور", "password")
  const password = passwordRaw || DEFAULT_PASSWORD
  if (password.length < 8) {
    return { ok: false, message: `الصف ${rowNumber}: كلمة المرور يجب أن تكون 8 أحرف على الأقل` }
  }

  const input: AdminCreateUserInput = {
    role: role as Extract<AppRole, "SERVED_MEMBER" | "SERVANT">,
    fullName,
    phone: normalizedPhone,
    password,
    dateOfBirth,
  }

  const memberClass = pick(row, "الصف", "class")
  if (memberClass) input.class = memberClass

  if (role === ROLES.SERVED_MEMBER) {
    const fatherPhone = pick(row, "هاتف الأب", "father_phone")
    if (fatherPhone) {
      const normalizedFather = normalizePhone(fatherPhone)
      if (!VALID_PHONE.test(normalizedFather)) {
        return { ok: false, message: `الصف ${rowNumber}: هاتف الأب غير صحيح` }
      }
      input.fatherPhone = normalizedFather
    }

    const motherPhone = pick(row, "هاتف الأم", "mother_phone")
    if (motherPhone) {
      const normalizedMother = normalizePhone(motherPhone)
      if (!VALID_PHONE.test(normalizedMother)) {
        return { ok: false, message: `الصف ${rowNumber}: هاتف الأم غير صحيح` }
      }
      input.motherPhone = normalizedMother
    }

    const address = pick(row, "العنوان", "address")
    if (address) input.address = address
  }

  return { ok: true, input }
}

async function requireStaffActor(): Promise<{ actorId: string } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const profile = await getProfile(supabase)
  if (!profile || (profile.role !== ROLES.SUPER_ADMIN && profile.role !== ROLES.SERVANT)) return null

  const allowed = await consumeRateLimit(exportKey(user.id), ratePolicy("exportPerAdmin"))
  if (!allowed) return null

  return { actorId: user.id }
}

export async function importUsersAction(
  rows: Record<string, unknown>[],
  role: AppRole,
): Promise<ImportActionResult> {
  if (role !== ROLES.SERVED_MEMBER && role !== ROLES.SERVANT) {
    return { ok: false, message: "الدور غير صحيح" }
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, message: "الملف فارغ" }
  }
  if (rows.length > MAX_ROWS) {
    return { ok: false, message: `الحد الأقصى ${MAX_ROWS} صف` }
  }

  const actor = await requireStaffActor()
  if (!actor) return { ok: false, message: "غير مصرح" }

  const admin = createAdminClient()

  // Best-effort class resolution for free-text class names in the sheet:
  // exact match against the active classes table yields the FK; otherwise the
  // legacy free-text name is kept as-is on served members.
  const activeClasses = await admin
    .from("classes")
    .select("id, name")
    .eq("is_active", true)
  const classByName = new Map<string, string>()
  for (const c of (activeClasses.data ?? [])) {
    classByName.set(String(c.name ?? ""), String(c.id))
  }
  const resolveClassId = (name: string | undefined): string | undefined => {
    if (!name) return undefined
    return classByName.get(name.trim())
  }

  const results: ImportResult[] = []
  let created = 0
  let failed = 0

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2
    const validation = validateRow(rows[i], role, rowNumber)

    if (!validation.ok) {
      results.push({ row: rowNumber, ok: false, message: validation.message })
      failed++
      continue
    }

    validation.input.classId = resolveClassId(validation.input.class)

    const result = await createAdminUser(admin, actor.actorId, validation.input)

    if (result.ok) {
      results.push({
        row: rowNumber,
        ok: true,
        message: "تم الإنشاء بنجاح",
        fullName: validation.input.fullName,
        phone: validation.input.phone,
        code: result.code,
      })
      created++
    } else {
      results.push({
        row: rowNumber,
        ok: false,
        message: `الصف ${rowNumber}: ${result.message}`,
        fullName: validation.input.fullName,
        phone: validation.input.phone,
      })
      failed++
    }
  }

  return { ok: true, results, created, failed }
}
