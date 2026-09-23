/**
 * Study Year domain service.
 *
 * The ministry (attendance, scoring, reports) runs on the Friday schedule
 * *derived* from the boundaries of a Study Year — never on a hardcoded list of
 * dates. This service is the single place that:
 *
 *   - resolves a Study Year for any date (`getStudyYearForDate`),
 *   - resolves the active Study Year (`getActiveStudyYear`),
 *   - derives the Friday schedule of a year (`getStudyYearFridays`), and
 *   - manages Study Years (create / update / activate / deactivate) for the
 *     SUPER_ADMIN "إدارة أعوام الخدمة" screen.
 *
 * Writes go through the service-role client AFTER the calling server action has
 * verified the actor is a SUPER_ADMIN (mirroring the `study_years_write_super`
 * policy) and are audited like every other application-config change.
 */
import type { SupabaseAdminClient } from "../lib/supabase/admin"
import { fridaySchedule } from "../lib/friday"
import { logAudit } from "./auth-service"

export const STUDY_YEAR_ENTITY = "STUDY_YEAR"
export const STUDY_YEAR_CREATED = "STUDY_YEAR_CREATED"
export const STUDY_YEAR_UPDATED = "STUDY_YEAR_UPDATED"
export const STUDY_YEAR_ACTIVATED = "STUDY_YEAR_ACTIVATED"
export const STUDY_YEAR_DEACTIVATED = "STUDY_YEAR_DEACTIVATED"

export const STUDY_YEAR_MAX_NAME = 80

export type StudyYear = {
  id: string
  name: string
  start_date: string
  end_date: string
  is_active: boolean
  created_at: string
  updated_at: string
}

/** A Study Year together with its derived Friday schedule. */
export type StudyYearWithSchedule = StudyYear & {
  /** Every ministry Friday of the year, first-to-last (derived, never stored). */
  schedule: string[]
}

export type StudyYearInput = {
  name: string
  start_date: string
  end_date: string
}

export type StudyYearValidation =
  | { ok: true; value: StudyYearInput }
  | { ok: false; message: string }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Validates + normalizes the editable fields of a Study Year. */
export function validateStudyYearInput(raw: unknown): StudyYearValidation {
  const r = (raw ?? {}) as Record<string, unknown>

  const name = String(r.name ?? "").replace(/\s+/g, " ").trim()
  if (!name) return { ok: false, message: "اسم عام الخدمة مطلوب" }
  if (name.length > STUDY_YEAR_MAX_NAME) {
    return { ok: false, message: "اسم عام الخدمة أطول من المسموح به" }
  }

  const start_date = String(r.start_date ?? "")
  const end_date = String(r.end_date ?? "")
  if (!DATE_RE.test(start_date) || !DATE_RE.test(end_date)) {
    return { ok: false, message: "صيغة التاريخ غير صحيحة (YYYY-MM-DD)" }
  }
  if (start_date >= end_date) {
    return { ok: false, message: "بداية عام الخدمة يجب أن تسبق نهايته" }
  }

  return { ok: true, value: { name, start_date, end_date } }
}

/** Derives every ministry Friday of a Study Year, first-to-last. */
export function getStudyYearFridays(year: Pick<StudyYear, "start_date" | "end_date">): string[] {
  return fridaySchedule(year.start_date, year.end_date)
}

/**
 * Every ministry Friday on-or-before `today`, across all Study Years —
 * newest-first, each Friday once. This is the exact set of days a servant
 * activity may be recorded on: a ministry Friday, never a future one.
 */
export async function getPastMinistryFridays(
  admin: SupabaseAdminClient,
  today: string
): Promise<string[]> {
  const years = await listStudyYears(admin)
  const set = new Set<string>()
  for (const year of years) {
    for (const f of getStudyYearFridays(year)) {
      if (f <= today) set.add(f)
    }
  }
  return [...set].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
}

/** Every Study Year, oldest first (for the management screen). */
export async function listStudyYears(admin: SupabaseAdminClient): Promise<StudyYear[]> {
  const { data } = await admin
    .from("study_years")
    .select("*")
    .order("start_date", { ascending: true })
  return (data ?? []) as StudyYear[]
}

/** The Study Year a `date` falls into, alongside its Friday schedule. */
export async function getStudyYearForDate(
  admin: SupabaseAdminClient,
  date: string
): Promise<StudyYearWithSchedule | null> {
  const { data } = await admin
    .from("study_years")
    .select("*")
    .lte("start_date", date)
    .gte("end_date", date)
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return { ...(data as StudyYear), schedule: getStudyYearFridays(data as StudyYear) }
}

/** The currently active Study Year, alongside its Friday schedule. */
export async function getActiveStudyYear(
  admin: SupabaseAdminClient,
  today?: string
): Promise<StudyYearWithSchedule | null> {
  let query = admin.from("study_years").select("*").eq("is_active", true)
  if (today) {
    query = query.lte("start_date", today).gte("end_date", today)
  }
  const { data } = await query.limit(1).maybeSingle()
  if (!data) return null
  return { ...(data as StudyYear), schedule: getStudyYearFridays(data as StudyYear) }
}

/** A single Study Year by id, alongside its Friday schedule. */
export async function getStudyYearById(
  admin: SupabaseAdminClient,
  id: string
): Promise<StudyYearWithSchedule | null> {
  const { data } = await admin.from("study_years").select("*").eq("id", id).maybeSingle()
  if (!data) return null
  return { ...(data as StudyYear), schedule: getStudyYearFridays(data as StudyYear) }
}

export type StudyYearMutationResult = { ok: boolean; message: string }

/** Creates a Study Year (optionally activating it right away). */
export async function createStudyYear(
  admin: SupabaseAdminClient,
  params: { actorId: string; year: StudyYearInput; is_active?: boolean }
): Promise<StudyYearMutationResult> {
  const { actorId, year, is_active = false } = params

  const { error } = await admin.from("study_years").insert({
    ...year,
    is_active,
  })
  if (error) {
    if (error.message.includes("study_years_no_overlap")) {
      return { ok: false, message: "عام الخدمة يتداخل مع عام آخر" }
    }
  }

  await logAudit(admin, {
    actorId,
    action: STUDY_YEAR_CREATED,
    entity: STUDY_YEAR_ENTITY,
    next: { ...year, is_active },
  })
  return { ok: true, message: "تمت إضافة عام الخدمة" }
}

/** Updates name / start / end of an existing Study Year. */
export async function updateStudyYear(
  admin: SupabaseAdminClient,
  params: { actorId: string; yearId: string; year: StudyYearInput }
): Promise<StudyYearMutationResult> {
  const { actorId, yearId, year } = params

  const { data: current, error: readError } = await admin
    .from("study_years")
    .select("*")
    .eq("id", yearId)
    .maybeSingle()
  if (readError || !current) return { ok: false, message: "عام الخدمة غير موجود" }

  const { error } = await admin
    .from("study_years")
    .update({ ...year })
    .eq("id", yearId)
  if (error) {
    if (error.message.includes("study_years_no_overlap")) {
      return { ok: false, message: "عام الخدمة يتداخل مع عام آخر" }
    }
    return { ok: false, message: "تعذر تحديث عام الخدمة" }
  }

  await logAudit(admin, {
    actorId,
    action: STUDY_YEAR_UPDATED,
    entity: STUDY_YEAR_ENTITY,
    entityId: yearId,
    previous: {
      name: current.name,
      start_date: current.start_date,
      end_date: current.end_date,
    },
    next: { ...year },
  })
  return { ok: true, message: "تم تحديث عام الخدمة" }
}

/** Activates one Study Year; every other year is deactivated in the same step. */
export async function activateStudyYear(
  admin: SupabaseAdminClient,
  params: { actorId: string; yearId: string }
): Promise<StudyYearMutationResult> {
  const { actorId, yearId } = params
  const { error } = await admin.rpc("set_active_study_year", { p_study_year_id: yearId })
  if (error) return { ok: false, message: "تعذر تفعيل عام الخدمة" }

  await logAudit(admin, {
    actorId,
    action: STUDY_YEAR_ACTIVATED,
    entity: STUDY_YEAR_ENTITY,
    entityId: yearId,
  })
  return { ok: true, message: "تم تفعيل عام الخدمة" }
}

/** Deactivates a Study Year (the app then has no active year until one is set). */
export async function deactivateStudyYear(
  admin: SupabaseAdminClient,
  params: { actorId: string; yearId: string }
): Promise<StudyYearMutationResult> {
  const { actorId, yearId } = params

  const { data: current, error: readError } = await admin
    .from("study_years")
    .select("*")
    .eq("id", yearId)
    .maybeSingle()
  if (readError || !current) return { ok: false, message: "عام الخدمة غير موجود" }

  const { error } = await admin.from("study_years").update({ is_active: false }).eq("id", yearId)
  if (error) return { ok: false, message: "تعذر إيقاف عام الخدمة" }

  await logAudit(admin, {
    actorId,
    action: STUDY_YEAR_DEACTIVATED,
    entity: STUDY_YEAR_ENTITY,
    entityId: yearId,
    previous: { is_active: current.is_active },
    next: { is_active: false },
  })
  return { ok: true, message: "تم إيقاف عام الخدمة" }
}