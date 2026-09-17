/**
 * Friday-based ministry views.
 *
 * Attendance + scoring + servant activities are all tracked on Fridays (never
 * a generic 7-day calendar). This service builds the Friday-based payloads:
 *
 *   - present/absent attendance grid per Friday for ALL active ministers,
 *   - a served member's per-Friday results (per-activity percentage, overall
 *     percentage, previous-Friday history, study-year totals),
 *   - the combined review used by servants/admins (attendance + served-member
 *     percentages + servant activity نعم/لا completion).
 *
 * The set of valid ministry Fridays is *derived* from the boundaries of a
 * Study Year (`getStudyYearForDate` / `getActiveStudyYear`), never hardcoded.
 * Every payload carries the year's Friday schedule so client components
 * render exactly the same navigable Fridays as the server.
 *
 * Attribution rule: every data row is bucketed to the Friday of its tracking
 * week — attendance rows already sit exactly on Fridays (DB-enforced), while a
 * weekly-card or activity grade saved on any weekday snaps to that week's
 * Friday via `lastFridayOnOrBefore`. Absence is never confused with "no score":
 * attendance is derived exclusively from `attendance_records`; percentages only
 * from score/activity rows.
 */
import type { SupabaseAdminClient } from "../lib/supabase/admin"
import type { ScoringRule } from "../lib/types"
import type { AppRole } from "../lib/roles"
import { ROLES } from "../lib/roles"
import { SCORING_CATEGORY_LABELS, type ScoringCategory } from "../lib/constants"
import { SCORE_CATEGORY_ICONS, addDaysDate } from "./scoring-rules"
import { lastFridayOnOrBefore, clampToSchedule } from "../lib/friday"
import { getActiveScoringRules } from "./scoring-service"
import { listGradedActivities, type GradedActivity } from "./member-scoring-service"
import {
  getStudyYearForDate,
  getActiveStudyYear,
  type StudyYearWithSchedule,
} from "./study-year-service"

// --- Shapes ----------------------------------------------------------------

/** One line of a served member's per-Friday result (one activity). */
export type FridayScoreLine = {
  /** Stable key for rendering ("CATEGORY:CHURCH_ATTENDANCE" / "ACTIVITY:<id>"). */
  key: string
  label: string
  icon: string
  /** Earned points that Friday (0 when not recorded). */
  points: number
  /** Best achievable points for that activity in one Friday. */
  max: number
  /** percentage = points / max. */
  percent: number
}

/** The Study Year a Friday view belongs to (name + derived schedule). */
export type FridayYearContext = {
  id: string
  name: string
  start_date: string
  end_date: string
  /** Every ministry Friday of the year, first-to-last. */
  schedule: string[]
}

export type FridayAttendancePerson = {
  id: string
  full_name: string
  role: AppRole
  /** Attendance per window-Friday, oldest-first. */
  rows: { date: string; present: boolean }[]
}

export type FridayAttendanceGrid = {
  date: string
  /** The n Fridays ending at `date` (window columns). */
  window: string[]
  people: FridayAttendancePerson[]
  /** The Study Year the grid belongs to. */
  year: FridayYearContext
}

export type FridayMemberResult = {
  date: string
  /** True when the member has any attendance record that Friday. */
  present: boolean
  lines: FridayScoreLine[]
  totalPoints: number
  totalMax: number
  totalPercent: number
}

export type FridayMemberHistoryItem = {
  date: string
  present: boolean
  totalPoints: number
  totalMax: number
  totalPercent: number
}

export type FridayYearlySummary = {
  yearStart: string
  yearEnd: string
  fridays: number
  totalPoints: number
  totalMax: number
  totalPercent: number
}

export type FridayMemberView = {
  selected: FridayMemberResult
  /** Older Fridays than the selected one, most-recent-first. */
  history: FridayMemberHistoryItem[]
  yearly: FridayYearlySummary
  /** The Study Year this view belongs to. */
  year: FridayYearContext
}

export type FridayServantActivity = {
  activityId: string
  code: string
  name: string
  icon: string | null
  recorded: boolean
}

export type FridayServantOverview = {
  id: string
  full_name: string
  present: boolean
  activities: FridayServantActivity[]
}

export type FridayMemberOverview = {
  id: string
  full_name: string
  present: boolean
  lines: FridayScoreLine[]
  totalPoints: number
  totalMax: number
  totalPercent: number
}

export type FridayMinistryData = {
  date: string
  servants: FridayServantOverview[]
  members: FridayMemberOverview[]
  /** The Study Year this review belongs to. */
  year: FridayYearContext
}

// --- Core category configuration -------------------------------------------

/** Weekly-card categories included in a per-Friday view, in label order. */
const FRIDAY_CORE_CATEGORIES: readonly ScoringCategory[] = [
  "CHURCH_ATTENDANCE",
  "SERVICE_ATTENDANCE",
  "WEEKLY_COMMITMENT",
  "TUNIC",
  "COMMUNION",
  "SERVICE_COMMITMENT",
  "BONUS",
]

/** 0–10 picker categories (max is the fixed 0–10 scale, not a rule value). */
const COMMITMENT_CATEGORIES: readonly ScoringCategory[] = [
  "WEEKLY_COMMITMENT",
  "SERVICE_COMMITMENT",
]

function maxForCategory(rules: ScoringRule[], category: ScoringCategory, role: AppRole): number {
  const candidates = rules.filter(
    (r) =>
      r.category === category &&
      r.is_active &&
      (r.applicable_role ?? []).includes(role)
  )
  return candidates.reduce((m, r) => Math.max(m, Number(r.point_value)), 0)
}

/** Best achievable per-Friday points for every core category for a role. */
function coreMaxima(rules: ScoringRule[], role: AppRole): Map<ScoringCategory, number> {
  const maxima = new Map<ScoringCategory, number>()
  for (const category of FRIDAY_CORE_CATEGORIES) {
    const max =
      (COMMITMENT_CATEGORIES as readonly ScoringCategory[]).includes(category)
        ? 10
        : maxForCategory(rules, category, role)
    maxima.set(category, max)
  }
  return maxima
}

// --- Shared helpers ----------------------------------------------------------

function scoreLineKey(category: ScoringCategory): string {
  return `CATEGORY:${category}`
}

function buildLines(
  rows: { category?: ScoringCategory; points: number }[],
  activities: GradedActivity[],
  activityPoints: Map<string, number>,
  coreMax: Map<ScoringCategory, number>
): FridayScoreLine[] {
  const byCat = new Map<ScoringCategory, number>()
  for (const r of rows) {
    if (!r.category) continue
    byCat.set(r.category, (byCat.get(r.category) ?? 0) + Number(r.points))
  }

  const lines: FridayScoreLine[] = FRIDAY_CORE_CATEGORIES.map((category) => {
    const max = coreMax.get(category) ?? 0
    const points = byCat.get(category) ?? 0
    const percent = max > 0 ? Math.round((points / max) * 100) : 0
    return {
      key: scoreLineKey(category),
      label: SCORING_CATEGORY_LABELS[category],
      icon: SCORE_CATEGORY_ICONS[category],
      points,
      max,
      percent,
    }
  })

  for (const a of activities) {
    const max = Number(a.max_score)
    const points = activityPoints.get(a.id) ?? 0
    const percent = max > 0 ? Math.round((points / max) * 100) : 0
    lines.push({
      key: `ACTIVITY:${a.id}`,
      label: a.name,
      icon: a.icon ?? "star",
      points,
      max,
      percent,
    })
  }
  return lines
}

function totalled(lines: FridayScoreLine[]): {
  totalPoints: number
  totalMax: number
  totalPercent: number
} {
  const totalPoints = lines.reduce((s, l) => s + l.points, 0)
  const totalMax = lines.reduce((s, l) => s + l.max, 0)
  return {
    totalPoints,
    totalMax,
    totalPercent: totalMax > 0 ? Math.round((totalPoints / totalMax) * 100) : 0,
  }
}

/** Picks the Study Year describing `date`, else the active one, else null. */
async function resolveYear(
  admin: SupabaseAdminClient,
  date: string
): Promise<StudyYearWithSchedule | null> {
  return (await getStudyYearForDate(admin, date)) ?? (await getActiveStudyYear(admin))
}

function yearContext(year: StudyYearWithSchedule): FridayYearContext {
  const { id, name, start_date, end_date, schedule } = year
  return { id, name, start_date, end_date, schedule: [...schedule] }
}

// --- Attendance grid ---------------------------------------------------------

const GRID_ROLES: AppRole[] = [ROLES.SERVANT, ROLES.SERVED_MEMBER]

/** The `count` Fridays ending at `anchor`, ordered oldest-first. */
function windowFridays(schedule: string[], anchor: string, count: number): string[] {
  const idx = schedule.indexOf(anchor)
  if (idx === -1) return [anchor]
  const start = Math.max(0, idx - count + 1)
  return schedule.slice(start, idx + 1)
}

/**
 * Present/absent grid for all active ministers across the last `count`
 * Fridays ending at `date`. Absence is explicit: a person with no attendance
 * record on a Friday row is غائب (present=false).
 */
export async function getFridayAttendanceGrid(
  admin: SupabaseAdminClient,
  date: string,
  count = 6
): Promise<FridayAttendanceGrid> {
  const year = await resolveYear(admin, date)
  if (!year) {
    return {
      date,
      window: [],
      people: [],
      year: { id: "", name: "", start_date: date, end_date: date, schedule: [] },
    }
  }
  const schedule = year.schedule
  const anchor = clampToSchedule(schedule, date) ?? schedule[schedule.length - 1]
  const window = windowFridays(schedule, anchor, count)

  const [profilesResult, recordsResult] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, role")
      .in("role", GRID_ROLES)
      .eq("status", "ACTIVE")
      .order("full_name", { ascending: true }),
    admin
      .from("attendance_records")
      .select("profile_id, session:attendance_sessions!inner(session_date)")
      .in("session.session_date", window)
      .neq("status", "ARCHIVED"),
  ])

  const presentByPerson = new Map<string, Set<string>>()
  for (const r of recordsResult.data ?? []) {
    const session = r.session as { session_date?: string } | null
    if (!session?.session_date) continue
    const set = presentByPerson.get(r.profile_id) ?? new Set<string>()
    set.add(session.session_date)
    presentByPerson.set(r.profile_id, set)
  }

  return {
    date: anchor,
    window,
    people: (profilesResult.data ?? []).map((p) => ({
      id: p.id as string,
      full_name: (p.full_name as string) ?? "",
      role: p.role as AppRole,
      rows: window.map((w) => ({
        date: w,
        present: presentByPerson.get(p.id)?.has(w) ?? false,
      })),
    })),
    year: yearContext(year),
  }
}

// --- Member per-Friday results ------------------------------------------------

function bucketKey(date: string, schedule: string[]): string {
  const f = lastFridayOnOrBefore(date)
  return schedule.includes(f) ? f : ""
}

async function loadMemberRows(admin: SupabaseAdminClient, profileId: string) {
  const [rules, activities, attendance, scoreRows, activityRows] = await Promise.all([
    getActiveScoringRules(admin),
    listGradedActivities(admin),
    admin
      .from("attendance_records")
      .select("attended_at, session:attendance_sessions(session_date)")
      .eq("profile_id", profileId)
      .neq("status", "ARCHIVED"),
    admin
      .from("score_records")
      .select("category, points, session_date")
      .eq("profile_id", profileId)
      .eq("is_voided", false),
    admin
      .from("member_activity_scores")
      .select("activity_id, points, score_date")
      .eq("profile_id", profileId),
  ])
  return { rules, activities, attendance, scoreRows, activityRows }
}

/**
 * Computes one member's full Friday view: the selected Friday's per-activity
 * percentages, the previous-Friday history (compact), and the Study Year
 * totals. All un-scored activities remain visible at 0% so a dropped score is
 * never mistaken for something else.
 */
export async function getMemberFridayView(
  admin: SupabaseAdminClient,
  profileId: string,
  anchor: string
): Promise<FridayMemberView> {
  const year = await resolveYear(admin, anchor)
  if (!year) {
    return {
      selected: {
        date: anchor,
        present: false,
        lines: [],
        totalPoints: 0,
        totalMax: 0,
        totalPercent: 0,
      },
      history: [],
      yearly: { yearStart: anchor, yearEnd: anchor, fridays: 0, totalPoints: 0, totalMax: 0, totalPercent: 0 },
      year: { id: "", name: "", start_date: anchor, end_date: anchor, schedule: [] },
    }
  }
  const schedule = year.schedule
  const selected = clampToSchedule(schedule, anchor) ?? schedule[schedule.length - 1]
  const { rules, activities, attendance, scoreRows, activityRows } = await loadMemberRows(
    admin,
    profileId
  )

  const coreMax = coreMaxima(rules, ROLES.SERVED_MEMBER)

  // Core weekly-card points bucketed per Friday.
  const coreByFriday = new Map<string, Map<ScoringCategory, number>>()
  for (const r of scoreRows.data ?? []) {
    const category = r.category as ScoringCategory
    if (!(FRIDAY_CORE_CATEGORIES as readonly ScoringCategory[]).includes(category)) continue
    const key = bucketKey(r.session_date as string, schedule)
    const m = coreByFriday.get(key) ?? new Map<ScoringCategory, number>()
    m.set(category, (m.get(category) ?? 0) + Number(r.points))
    coreByFriday.set(key, m)
  }

  // Graded-activity points bucketed per Friday.
  const activityByFriday = new Map<string, Map<string, number>>()
  for (const r of activityRows.data ?? []) {
    const key = bucketKey(r.score_date as string, schedule)
    const m = activityByFriday.get(key) ?? new Map<string, number>()
    m.set(r.activity_id as string, (m.get(r.activity_id) ?? 0) + Number(r.points))
    activityByFriday.set(key, m)
  }

  // Attendance present per Friday (exact Friday dates only).
  const presentFridays = new Set<string>()
  for (const r of attendance.data ?? []) {
    const session = r.session as { session_date?: string } | null
    if (session?.session_date) presentFridays.add(session.session_date)
  }

  const resultFor = (friday: string): FridayMemberResult => {
    const coreRows = [...(coreByFriday.get(friday) ?? new Map()).entries()].map(
      ([category, points]) => ({ category, points })
    )
    const lines = buildLines(
      coreRows,
      activities,
      activityByFriday.get(friday) ?? new Map(),
      coreMax
    )
    return {
      date: friday,
      present: presentFridays.has(friday),
      lines,
      ...totalled(lines),
    }
  }

  const result = resultFor(selected)

  const history: FridayMemberHistoryItem[] = schedule
    .filter((f) => f < selected)
    .reverse()
    .map((f) => {
      const r = resultFor(f)
      return {
        date: r.date,
        present: r.present,
        totalPoints: r.totalPoints,
        totalMax: r.totalMax,
        totalPercent: r.totalPercent,
      }
    })

  // Study-year totals: every Friday is worth the same achievable maximum.
  const perFridayMax = totalled(
    buildLines([], activities, new Map(), coreMax)
  ).totalMax
  const yearlyMax = perFridayMax * schedule.length
  const inYear = new Set(schedule)

  let yearlyPoints = 0
  for (const r of scoreRows.data ?? []) {
    const category = r.category as ScoringCategory
    if (
      (FRIDAY_CORE_CATEGORIES as readonly ScoringCategory[]).includes(category) &&
      inYear.has(bucketKey(r.session_date as string, schedule))
    ) {
      yearlyPoints += Number(r.points)
    }
  }
  for (const r of activityRows.data ?? []) {
    if (inYear.has(bucketKey(r.score_date as string, schedule))) {
      yearlyPoints += Number(r.points)
    }
  }

  return {
    selected: result,
    history,
    yearly: {
      yearStart: year.start_date,
      yearEnd: year.end_date,
      fridays: schedule.length,
      totalPoints: yearlyPoints,
      totalMax: yearlyMax,
      totalPercent: yearlyMax > 0 ? Math.round((yearlyPoints / yearlyMax) * 100) : 0,
    },
    year: yearContext(year),
  }
}

// --- Combined ministry review (servants / admins) ----------------------------

/**
 * The per-Friday review seen by servants and admins: attendance for everyone
 * (servants + served members), each served member's Friday percentages, and
 * each servant's activity completion (نعم/لا) for that Friday.
 */
export async function getFridayMinistryData(
  admin: SupabaseAdminClient,
  date: string
): Promise<FridayMinistryData> {
  const year = await resolveYear(admin, date)
  if (!year) {
    return {
      date,
      servants: [],
      members: [],
      year: { id: "", name: "", start_date: date, end_date: date, schedule: [] },
    }
  }
  const schedule = year.schedule
  const anchor = clampToSchedule(schedule, date) ?? schedule[schedule.length - 1]
  const weekEnd = addDaysDate(anchor, 6)

  const [rules, activities, servantActivitiesDef, profilesResult, attendance, scoreRows, activityRows, servantActivities] =
    await Promise.all([
      getActiveScoringRules(admin),
      listGradedActivities(admin),
      admin
        .from("activities")
        .select("id, code, name, icon")
        .eq("for_role", ROLES.SERVANT)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      admin
        .from("profiles")
        .select("id, full_name, role")
        .in("role", GRID_ROLES)
        .eq("status", "ACTIVE")
        .order("full_name", { ascending: true }),
      admin
        .from("attendance_records")
        .select("profile_id, session:attendance_sessions!inner(session_date)")
        .eq("session.session_date", anchor)
        .neq("status", "ARCHIVED"),
      admin
        .from("score_records")
        .select("profile_id, category, points, session_date")
        .eq("is_voided", false)
        .gte("session_date", anchor)
        .lte("session_date", weekEnd),
      admin
        .from("member_activity_scores")
        .select("profile_id, activity_id, points, score_date")
        .gte("score_date", anchor)
        .lte("score_date", weekEnd),
      admin
        .from("servant_activity_records")
        .select("servant_id, activity_id, recorded_on")
        .eq("recorded_on", anchor),
    ])

  const present = new Set<string>()
  for (const r of attendance.data ?? []) {
    const session = r.session as { session_date?: string } | null
    if (session?.session_date) present.add(r.profile_id as string)
  }

  const coreMax = coreMaxima(rules, ROLES.SERVED_MEMBER)

  const byMemberCore = new Map<string, Map<ScoringCategory, number>>()
  for (const r of scoreRows.data ?? []) {
    const category = r.category as ScoringCategory
    if (!(FRIDAY_CORE_CATEGORIES as readonly ScoringCategory[]).includes(category)) continue
    const key = bucketKey(r.session_date as string, schedule)
    if (key !== anchor) continue
    const m = byMemberCore.get(r.profile_id as string) ?? new Map<ScoringCategory, number>()
    m.set(category, (m.get(category) ?? 0) + Number(r.points))
    byMemberCore.set(r.profile_id as string, m)
  }

  const byMemberActivity = new Map<string, Map<string, number>>()
  for (const r of activityRows.data ?? []) {
    const key = bucketKey(r.score_date as string, schedule)
    if (key !== anchor) continue
    const m = byMemberActivity.get(r.profile_id as string) ?? new Map<string, number>()
    m.set(r.activity_id as string, (m.get(r.activity_id) ?? 0) + Number(r.points))
    byMemberActivity.set(r.profile_id as string, m)
  }

  const recordedByServant = new Map<string, Set<string>>()
  for (const r of servantActivities.data ?? []) {
    const set = recordedByServant.get(r.servant_id as string) ?? new Set<string>()
    set.add(r.activity_id as string)
    recordedByServant.set(r.servant_id as string, set)
  }

  const servantActivityDefs = (servantActivitiesDef.data ?? []).map((a) => ({
    activityId: a.id as string,
    code: (a.code as string) ?? "",
    name: (a.name as string) ?? "",
    icon: (a.icon as string | null) ?? null,
  }))

  const servants: FridayServantOverview[] = []
  const members: FridayMemberOverview[] = []

  for (const p of profilesResult.data ?? []) {
    const profileId = p.id as string
    const name = (p.full_name as string) ?? ""
    const role = p.role as AppRole
    const isPresent = present.has(profileId)

    if (role === ROLES.SERVANT) {
      const recorded = recordedByServant.get(profileId) ?? new Set<string>()
      servants.push({
        id: profileId,
        full_name: name,
        present: isPresent,
        activities: servantActivityDefs.map((a) => ({
          ...a,
          recorded: recorded.has(a.activityId),
        })),
      })
    } else {
      const coreRows = [...(byMemberCore.get(profileId) ?? new Map()).entries()].map(
        ([category, points]) => ({ category, points })
      )
      const lines = buildLines(
        coreRows,
        activities,
        byMemberActivity.get(profileId) ?? new Map(),
        coreMax
      )
      members.push({
        id: profileId,
        full_name: name,
        present: isPresent,
        lines,
        ...totalled(lines),
      })
    }
  }

  return { date: anchor, servants, members, year: yearContext(year) }
}