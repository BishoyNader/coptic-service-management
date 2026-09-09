/**
 * Phase 5C — read-only reporting aggregations for Super Admin.
 *
 * Reports never mutate data. Every aggregation runs against the
 * authenticated (RLS-bound) Supabase client, so reads stay constrained by
 * the same security policies the rest of the app uses; the calling page or
 * server action has already verified the actor is a SUPER_ADMIN.
 *
 * All windows are Cairo wall dates in the "YYYY-MM-DD" vocabulary the scoring
 * engine uses.
 */
import type { AppRole } from "../lib/roles"
import type { ScoringCategory } from "../lib/constants"
import type { SupabaseServerClient } from "../lib/supabase/server"
import { toAttendanceRows } from "./attendance-service"

export type ReportRange = { from: string; to: string }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** True for a well-formed "YYYY-MM-DD" calendar date. */
export function isDateString(value: unknown): value is string {
  return typeof value === "string" && DATE_RE.test(value)
}

/** Parses + validates an external report range; throws a UI-safe message. */
export function validateRange(value: unknown): ReportRange {
  const v = (value ?? {}) as Record<string, unknown>
  if (!isDateString(v.from) || !isDateString(v.to)) {
    throw new Error("نطاق التاريخ غير صحيح")
  }
  if (v.from > v.to) throw new Error("تاريخ البداية بعد تاريخ النهاية")
  return { from: v.from, to: v.to }
}

// --- Attendance -------------------------------------------------------------

export type AttendanceReportRow = {
  fullName: string
  role: AppRole
  records: number
  points: number
  church: number
  service: number
  source: { QR: number; CODE: number; MANUAL: number }
}

export type AttendanceReport = {
  range: ReportRange
  totals: { records: number; church: number; service: number; points: number }
  rows: AttendanceReportRow[]
}

/**
 * Attendance report: per-person aggregates (records, points, church vs
 * service, and the recording source) over an inclusive Cairo date range.
 * Archived (voided) records are excluded from every total.
 */
export async function buildAttendanceReport(
  client: SupabaseServerClient,
  range: ReportRange
): Promise<AttendanceReport> {
  const { from, to } = range
  const { data } = await client
    .from("attendance_records")
    .select(
      "id, attended_at, points, source, status, session:attendance_sessions(type), profile:profiles!attendance_records_profile_id_fkey(full_name, role)"
    )
    .gte("attended_at", `${from}T00:00:00.000Z`)
    .lte("attended_at", `${to}T23:59:59.999Z`)
    .limit(2000)

  const rows = toAttendanceRows((data ?? []) as never[]).filter(
    (r) => r.status !== "ARCHIVED"
  )

  const byName = new Map<string, AttendanceReportRow>()
  let records = 0
  let church = 0
  let service = 0
  let points = 0
  for (const r of rows) {
    records++
    points += r.points
    if (r.type === "CHURCH") church++
    else service++

    let row = byName.get(r.fullName)
    if (!row) {
      row = {
        fullName: r.fullName,
        role: r.role,
        records: 0,
        points: 0,
        church: 0,
        service: 0,
        source: { QR: 0, CODE: 0, MANUAL: 0 },
      }
      byName.set(r.fullName, row)
    }
    row.records++
    row.points += r.points
    row.source[r.source]++
    if (r.type === "CHURCH") row.church++
    else row.service++
  }

  const sorted = Array.from(byName.values()).sort(
    (a, b) => b.records - a.records || a.fullName.localeCompare(b.fullName, "ar")
  )
  return { range, totals: { records, church, service, points }, rows: sorted }
}

// --- Scores -----------------------------------------------------------------

export type ScoreReportRow = {
  fullName: string
  role: AppRole
  total: number
  categories: Partial<Record<ScoringCategory, number>>
}

export type ScoresReport = {
  range: ReportRange
  total: number
  categoryTotals: Partial<Record<ScoringCategory, number>>
  rows: ScoreReportRow[]
}

/**
 * Scores report: served-member ranking (descending total points) with a
 * per-category breakdown, only over non-voided records in the date window.
 */
export async function buildScoresReport(
  client: SupabaseServerClient,
  range: ReportRange
): Promise<ScoresReport> {
  const { from, to } = range
  const { data } = await client
    .from("score_records")
    .select(
      "category, points, profile:profiles!score_records_profile_id_fkey(full_name, role)"
    )
    .eq("is_voided", false)
    .gte("session_date", from)
    .lte("session_date", to)

  const byName = new Map<string, ScoreReportRow>()
  const categoryTotals: Partial<Record<ScoringCategory, number>> = {}
  let total = 0

  const rawRows = (data ?? []) as unknown as Array<{
    category: string
    points: number | string
    profile?: { full_name?: string | null; role?: string | null } | null
  }>

  for (const r of rawRows) {
    const fullName = (r.profile?.full_name as string | null) ?? "—"
    const role = (r.profile?.role ?? "SERVED_MEMBER") as AppRole
    const cat = r.category as ScoringCategory
    const pts = Number(r.points) || 0

    total += pts
    categoryTotals[cat] = (categoryTotals[cat] ?? 0) + pts

    let row = byName.get(fullName)
    if (!row) {
      row = { fullName, role, total: 0, categories: {} }
      byName.set(fullName, row)
    }
    row.total += pts
    row.categories[cat] = (row.categories[cat] ?? 0) + pts
  }

  const rows = Array.from(byName.values()).sort(
    (a, b) => b.total - a.total || a.fullName.localeCompare(b.fullName, "ar")
  )
  return { range, total, categoryTotals, rows }
}

// --- Servant activities -----------------------------------------------------

export type ActivityReportActivityRow = {
  code: string
  name: string
  count: number
  servants: number
}

export type ActivityReportServantRow = {
  fullName: string
  total: number
  activities: Record<string, number>
}

export type ActivitiesReport = {
  range: ReportRange
  total: number
  servants: number
  byActivity: ActivityReportActivityRow[]
  rows: ActivityReportServantRow[]
}

/**
 * Servant activities report: per-activity totals (with the number of
 * distinct servants) and a per-servant breakdown over the date window.
 */
export async function buildActivitiesReport(
  client: SupabaseServerClient,
  range: ReportRange
): Promise<ActivitiesReport> {
  const { from, to } = range
  const { data } = await client
    .from("servant_activity_records")
    .select(
      "activity:activities(code, name), profile:profiles!servant_activity_records_servant_id_fkey(full_name)"
    )
    .gte("recorded_on", from)
    .lte("recorded_on", to)

  const activities = new Map<string, ActivityReportActivityRow>()
  const byName = new Map<string, ActivityReportServantRow>()
  const activityServants = new Map<string, Set<string>>()
  let total = 0

  const rawRows = (data ?? []) as unknown as Array<{
    activity?: { code?: string | null; name?: string | null } | null
    profile?: { full_name?: string | null } | null
  }>

  for (const r of rawRows) {
    const code = (r.activity?.code as string | null) ?? "—"
    const name = (r.activity?.name as string | null) ?? code
    const fullName = (r.profile?.full_name as string | null) ?? "—"

    total++
    if (!activities.has(code)) {
      activities.set(code, { code, name, count: 0, servants: 0 })
      activityServants.set(code, new Set())
    }
    const activity = activities.get(code)!
    activity.count++
    activityServants.get(code)!.add(fullName)

    let row = byName.get(fullName)
    if (!row) {
      row = { fullName, total: 0, activities: {} }
      byName.set(fullName, row)
    }
    row.total++
    row.activities[code] = (row.activities[code] ?? 0) + 1
  }

  const byActivity = Array.from(activities.values())
    .map((a) => ({ ...a, servants: activityServants.get(a.code)!.size }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ar"))
  const rows = Array.from(byName.values()).sort(
    (a, b) => b.total - a.total || a.fullName.localeCompare(b.fullName, "ar")
  )

  return { range, total, servants: rows.length, byActivity, rows }
}
