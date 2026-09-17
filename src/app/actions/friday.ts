"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ROLES } from "@/lib/roles"
import { cairoDateString, isCairoFriday } from "@/lib/cairo"
import { getServerNow } from "@/services/attendance-service"
import { getStudyYearForDate } from "@/services/study-year-service"
import type { SupabaseAdminClient } from "@/lib/supabase/admin"
import {
  getFridayAttendanceGrid,
  getFridayMinistryData,
  getMemberFridayView,
  type FridayAttendanceGrid,
  type FridayMinistryData,
  type FridayMemberView,
} from "@/services/friday-service"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** True for a real "YYYY-MM-DD" calendar date (rejects e.g. 2026-02-30). */
function isRealDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const [y, m, d] = value.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

async function requireRoles(
  allowed: string[]
): Promise<{ actorId: string; role: string } | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile || !allowed.includes(profile.role as string)) return null
  return { actorId: user.id, role: profile.role as string }
}

/**
 * Validates a Friday ministry date: real date, actually a Friday, not future,
 * and inside a configured Study Year (files under a SUPPER-admin-managed year,
 * never a hardcoded calendar).
 */
async function validateFridayDate(
  admin: SupabaseAdminClient,
  date: string
): Promise<{ ok: true; friday: string } | { ok: false; message: string }> {
  if (typeof date !== "string" || !isRealDateString(date)) {
    return { ok: false, message: "التاريخ غير صحيح" }
  }
  if (!isCairoFriday(date)) {
    return { ok: false, message: "التقييم والغياب يُسجَّلان يوم الجمعة فقط" }
  }
  const cairoToday = cairoDateString(getServerNow())
  if (date > cairoToday) {
    return { ok: false, message: "لا يمكن عرض تاريخ مستقبلي" }
  }
  const year = await getStudyYearForDate(admin, date)
  if (!year) {
    return { ok: false, message: "التاريخ خارج أعوام الخدمة المفعّلة" }
  }
  return { ok: true, friday: date }
}

// --- Attendance grid (servants + admins) -------------------------------------

export type FridayGridResult =
  | { ok: true; grid: FridayAttendanceGrid }
  | { ok: false; message: string }

/**
 * Present/absent grid across the last ministry Fridays. Servants, admins and
 * super admins may all see who attended and who did not — absence is derived
 * strictly from the absence of an attendance record, never from a missing
 * score.
 */
export async function getFridayAttendanceGridAction(date: string): Promise<FridayGridResult> {
  const actor = await requireRoles([ROLES.SERVANT, ROLES.ADMIN, ROLES.SUPER_ADMIN])
  if (!actor) return { ok: false, message: "غير مصرح" }
  const admin = createAdminClient()
  const parsed = await validateFridayDate(admin, date)
  if (!parsed.ok) return { ok: false, message: parsed.message }

  const grid = await getFridayAttendanceGrid(admin, parsed.friday)
  return { ok: true, grid }
}

// --- Combined Friday review (servants + admins) ------------------------------

export type FridayMinistryResult =
  | { ok: true; data: FridayMinistryData }
  | { ok: false; message: string }

/**
 * Combined per-Friday review: attendance for everyone, served-member
 * percentages, servant activity completion. Servants see all active ministers
 * (no ownership restriction) just like admins.
 */
export async function getFridayMinistryDataAction(date: string): Promise<FridayMinistryResult> {
  const actor = await requireRoles([ROLES.SERVANT, ROLES.ADMIN, ROLES.SUPER_ADMIN])
  if (!actor) return { ok: false, message: "غير مصرح" }
  const admin = createAdminClient()
  const parsed = await validateFridayDate(admin, date)
  if (!parsed.ok) return { ok: false, message: parsed.message }

  const data = await getFridayMinistryData(admin, parsed.friday)
  return { ok: true, data }
}

// --- Served member's own Friday results --------------------------------------

export type FridayMemberResultsResult =
  | { ok: true; view: FridayMemberView }
  | { ok: false; message: string }

/**
 * A served member's own Friday results. Only the caller's own rows are ever
 * read (resolved from the verified session), for the caller's own role. A
 * member never receives any other member's data and never any ranking.
 */
export async function getMemberFridayResultsAction(date: string): Promise<FridayMemberResultsResult> {
  const actor = await requireRoles([ROLES.SERVED_MEMBER])
  if (!actor) return { ok: false, message: "غير مصرح" }
  const admin = createAdminClient()
  const parsed = await validateFridayDate(admin, date)
  if (!parsed.ok) return { ok: false, message: parsed.message }

  const view = await getMemberFridayView(admin, actor.actorId, parsed.friday)
  return { ok: true, view }
}