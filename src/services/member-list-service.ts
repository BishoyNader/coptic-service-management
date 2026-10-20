/**
 * Member list "at a glance" stats for the members list card.
 *
 * The members list shows every served member; alongside the identity row the
 * card surfaces the two things a servant actually acts on:
 *
 *   - attendance over the last few ministry Fridays (present / absent dots),
 *   - visitation (الافتقاد) freshness for the last month.
 *
 * Both are computed for a whole page of members in a bounded number of
 * queries (never one query per member) so a 25-row page stays cheap.
 */
import type { SupabaseAdminClient } from "../lib/supabase/admin"
import { ROLES } from "../lib/roles"
import { cairoDateString } from "../lib/cairo"
import { daysBetweenDates } from "../lib/dates"
import { clampToSchedule } from "../lib/friday"
import { getServerNow } from "./attendance-service"
import { VISIT_WINDOW_DAYS } from "./visitation-service"

/** How many recent ministry Fridays the card tracks. */
export const MEMBER_ATTENDANCE_WINDOW = 4

export type MemberAttendanceDay = {
  /** Cairo date (YYYY-MM-DD) of the ministry Friday. */
  date: string
  present: boolean
}

/** Attendance + visitation summary for one member. */
export type MemberListStats = {
  /** The tracked Fridays, oldest first. Empty when no schedule is configured. */
  attendance: MemberAttendanceDay[]
  /** Present days out of `attendance.length`. */
  presentCount: number
  /** Cairo date of the latest ministry Friday in the window. */
  lastFriday: string | null
  /** Whole Cairo days since the latest visit; null when never visited. */
  daysSinceVisit: number | null
  /** True when the member has never been visited or is past the window. */
  visitationOverdue: boolean
}

/**
 * The `count` Fridays ending at `anchor`, oldest first. Mirrors the Friday
 * attendance grid so the card window always lines up with the year schedule.
 */
function windowFridays(schedule: string[], anchor: string, count: number): string[] {
  const idx = schedule.indexOf(anchor)
  if (idx === -1) return [anchor]
  return schedule.slice(Math.max(0, idx - count + 1), idx + 1)
}

/**
 * Batched stats for a page of served members.
 *
 * `schedule` is the active Study Year's Friday list. When it is empty (no
 * study year configured yet) the attendance strip is skipped entirely — the
 * card then falls back to visitation only rather than inventing Fridays.
 */
export async function getMemberListStats(
  admin: SupabaseAdminClient,
  memberIds: string[],
  schedule: string[],
  today: string = cairoDateString(getServerNow()),
): Promise<Map<string, MemberListStats>> {
  const out = new Map<string, MemberListStats>()
  if (memberIds.length === 0) return out

  const anchor = schedule.length > 0 ? clampToSchedule(schedule, today) : null
  const window = anchor ? windowFridays(schedule, anchor, MEMBER_ATTENDANCE_WINDOW) : []

  const [attendanceResult, visitsResult] = await Promise.all([
    window.length > 0
      ? admin
          .from("attendance_records")
          .select("profile_id, session:attendance_sessions!inner(session_date)")
          .in("profile_id", memberIds)
          .in("session.session_date", window)
          .neq("status", "ARCHIVED")
      : Promise.resolve({ data: [] as { profile_id: string; session: unknown }[] }),
    admin
      .from("member_visits")
      .select("member_id, visit_date")
      .in("member_id", memberIds)
      .gte("visit_date", visitationWindowStart(today))
      .order("visit_date", { ascending: false })
      .limit(5000),
  ])

  const presentByMember = new Map<string, Set<string>>()
  for (const r of (attendanceResult.data ?? []) as {
    profile_id: string
    session: { session_date?: string } | null
  }[]) {
    const date = r.session?.session_date
    if (!date) continue
    const set = presentByMember.get(r.profile_id) ?? new Set<string>()
    set.add(date)
    presentByMember.set(r.profile_id, set)
  }

  // Latest visit per member. Rows arrive newest-first, so the first hit wins.
  const lastVisitByMember = new Map<string, string>()
  for (const v of (visitsResult.data ?? []) as { member_id: string; visit_date: string }[]) {
    if (!lastVisitByMember.has(v.member_id)) lastVisitByMember.set(v.member_id, v.visit_date)
  }

  for (const id of memberIds) {
    const present = presentByMember.get(id)
    const attendance = window.map((date) => ({ date, present: present?.has(date) ?? false }))
    const lastVisit = lastVisitByMember.get(id) ?? null
    const daysSinceVisit = lastVisit ? daysBetweenDates(lastVisit, today) : null

    out.set(id, {
      attendance,
      presentCount: attendance.filter((d) => d.present).length,
      lastFriday: window.length > 0 ? window[window.length - 1] : null,
      daysSinceVisit,
      // A visit older than the window never appears in the query above, so it
      // must still count as overdue — hence the explicit day check.
      visitationOverdue: daysSinceVisit === null || daysSinceVisit > VISIT_WINDOW_DAYS,
    })
  }

  return out
}

/** Lower bound for the visit query: the start of the visitation window. The
 * window is calendar-based (30 days), not tied to the Friday schedule, so a
 * member visited on a non-Friday still reads correctly. */
function visitationWindowStart(today: string): string {
  const [y, m, d] = today.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - VISIT_WINDOW_DAYS)
  return dt.toISOString().slice(0, 10)
}

/**
 * Active served-member counts per class, plus the unassigned bucket.
 *
 * One pass over the class FK (never one query per class) so the filter chips
 * can show how many members each class holds.
 */
export async function countActiveMembersByClass(
  admin: SupabaseAdminClient,
): Promise<{ byClass: Map<string, number>; total: number; unassigned: number }> {
  const { data } = await admin
    .from("profiles")
    .select("id, served_members!inner(class_id)")
    .eq("role", ROLES.SERVED_MEMBER)
    .eq("status", "ACTIVE")

  const byClass = new Map<string, number>()
  let unassigned = 0
  for (const row of (data ?? []) as {
    served_members: { class_id: string | null } | { class_id: string | null }[] | null
  }[]) {
    const detail = Array.isArray(row.served_members) ? row.served_members[0] : row.served_members
    const classId = detail?.class_id ?? null
    if (!classId) {
      unassigned++
      continue
    }
    byClass.set(classId, (byClass.get(classId) ?? 0) + 1)
  }

  return { byClass, total: (data ?? []).length, unassigned }
}
