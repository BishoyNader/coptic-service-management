/**
 * Activity-based member scoring.
 *
 * Bridges the new `member_activity_scores` table (SERVED_MEMBER graded on
 * activities by servants/admins) with the existing attendance engine. The
 * scoring board shows, for one Cairo day, every active served member with
 * their attendance records (CHURCH/SERVICE from the attendance engine) and
 * their per-activity awarded points.
 *
 * All writes are service-role, super/servant-gated in the server action, and
 * audited. Points are validated against the activity's [min_score, max_score]
 * range and the target profile must be an ACTIVE SERVED_MEMBER.
 */
import type { SupabaseAdminClient } from "../lib/supabase/admin"
import type { AppRole } from "../lib/roles"
import { ROLES } from "../lib/roles"
import { toDateString } from "./scoring-rules"
import { logAudit } from "./auth-service"

export const ACTIVITY_SCORE_ENTITY = "ACTIVITY_SCORE"
export const ACTIVITY_SCORE_CREATED = "ACTIVITY_SCORE_CREATED"
export const ACTIVITY_SCORE_UPDATED = "ACTIVITY_SCORE_UPDATED"
export const ACTIVITY_SCORE_DELETED = "ACTIVITY_SCORE_DELETED"

export type GradedActivity = {
  id: string
  code: string
  name: string
  icon: string | null
  for_role: AppRole
  min_score: number
  max_score: number
  sort_order: number
}

export type BoardMemberAttendance = {
  id: string
  type: "CHURCH" | "SERVICE"
  points: number
  recordedBy: string | null
}

export type BoardMemberScore = {
  id: string
  activity_id: string
  points: number
}

export type ScoringBoardMember = {
  id: string
  full_name: string
  attendance: BoardMemberAttendance[]
  scores: BoardMemberScore[]
}

export type ScoringBoardData = {
  date: string
  activities: GradedActivity[]
  members: ScoringBoardMember[]
}

/**
 * Active activities the graded board + member view use, ordered. Board and
 * member views are graded on SERVED_MEMBER activities; the servant
 * self-tracking panel reads the SERVANT rows directly.
 */
export async function listGradedActivities(
  admin: SupabaseAdminClient,
  role: AppRole = ROLES.SERVED_MEMBER
): Promise<GradedActivity[]> {
  const { data } = await admin
    .from("activities")
    .select("id, code, name, icon, for_role, min_score, max_score, sort_order")
    .eq("is_active", true)
    .eq("for_role", role)
    .order("sort_order", { ascending: true })
  return (data ?? []) as GradedActivity[]
}

/** All active served members, ordered by name. */
export async function listActiveMembers(
  admin: SupabaseAdminClient
): Promise<{ id: string; full_name: string }[]> {
  const { data } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("role", ROLES.SERVED_MEMBER)
    .eq("status", "ACTIVE")
    .order("full_name", { ascending: true })
  return (data ?? []) as { id: string; full_name: string }[]
}

/**
 * Board payload for one Cairo day: active served members + their attendance
 * records for that day + their activity scores for that day + the graded
 * activity list.
 */
export async function getScoringBoardData(
  admin: SupabaseAdminClient,
  date: string
): Promise<ScoringBoardData> {
  const [activities, members, attendanceRows, scoreRows] = await Promise.all([
    listGradedActivities(admin),
    listActiveMembers(admin),
    admin
      .from("attendance_records")
      .select("id, profile_id, points, recorded_by, session:attendance_sessions(type)")
      .neq("status", "ARCHIVED")
      .eq("session.session_date", date),
    admin
      .from("member_activity_scores")
      .select("id, profile_id, activity_id, points")
      .eq("score_date", date),
  ])

  const attendanceByMember = new Map<string, BoardMemberAttendance[]>()
  for (const r of attendanceRows.data ?? []) {
    const list = attendanceByMember.get(r.profile_id) ?? []
    const session = r.session as { type?: string | null } | null
    if (!session?.type) continue
    list.push({
      id: r.id as string,
      type: session.type as "CHURCH" | "SERVICE",
      points: Number(r.points),
      recordedBy: (r.recorded_by as string | null) ?? null,
    })
    attendanceByMember.set(r.profile_id, list)
  }

  const scoresByMember = new Map<string, BoardMemberScore[]>()
  for (const r of scoreRows.data ?? []) {
    const list = scoresByMember.get(r.profile_id) ?? []
    list.push({
      id: r.id as string,
      activity_id: r.activity_id as string,
      points: Number(r.points),
    })
    scoresByMember.set(r.profile_id, list)
  }

  return {
    date,
    activities,
    members: members.map((m) => ({
      id: m.id,
      full_name: m.full_name,
      attendance: attendanceByMember.get(m.id) ?? [],
      scores: scoresByMember.get(m.id) ?? [],
    })),
  }
}

export async function resolveMemberProfile(
  admin: SupabaseAdminClient,
  memberId: string
): Promise<{ role: AppRole; status: string } | null> {
  const { data } = await admin
    .from("profiles")
    .select("role, status")
    .eq("id", memberId)
    .maybeSingle()
  return (data as { role: AppRole; status: string } | null) ?? null
}

export type ActivityScoreResult = { ok: boolean; message: string; points?: number }

export async function upsertMemberActivityScore(
  admin: SupabaseAdminClient,
  params: {
    actorId: string
    memberId: string
    activityId: string
    date: string
    points: number
  }
): Promise<ActivityScoreResult> {
  const { actorId, memberId, activityId, date, points } = params

  if (!Number.isFinite(points) || points < 0) {
    return { ok: false, message: "الدرجة غير صحيحة" }
  }

  // Only ACTIVE activities intended for SERVED_MEMBER are gradable on the
  // board. A SERVANT-role activity (or an inactive one) must be rejected even
  // when the id is forged — an activity is never bound to a single member.
  const activity = await admin
    .from("activities")
    .select("id, name, min_score, max_score")
    .eq("id", activityId)
    .eq("is_active", true)
    .eq("for_role", ROLES.SERVED_MEMBER)
    .maybeSingle()
  if (!activity.data) return { ok: false, message: "النشاط غير موجود" }

  // The target must be an EXISTING ACTIVE SERVED_MEMBER. Any other role
  // (SERVANT / ADMIN / SUPER_ADMIN) or an inactive/archived profile is
  // rejected up front — this also guards the 0-clear/delete path, which would
  // otherwise delete a row for whatever id the client sent.
  const member = await resolveMemberProfile(admin, memberId)
  if (!member || member.role !== ROLES.SERVED_MEMBER || member.status !== "ACTIVE") {
    return { ok: false, message: "الشخص غير موجود" }
  }

  const normalized = Math.round(points * 100) / 100
  // A score of 0 = "no award recorded" → remove any existing row.
  if (normalized <= 0) {
    const { error } = await admin
      .from("member_activity_scores")
      .delete()
      .eq("profile_id", memberId)
      .eq("activity_id", activityId)
      .eq("score_date", date)
    if (error) return { ok: false, message: "تعذر تسجيل الدرجة" }
    await logAudit(admin, {
      actorId,
      action: ACTIVITY_SCORE_DELETED,
      entity: ACTIVITY_SCORE_ENTITY,
      entityId: activityId,
      metadata: { profile_id: memberId, score_date: date, points: 0 },
    })
    return { ok: true, message: "تم حذف الدرجة", points: 0 }
  }

  const max = Number(activity.data.max_score)
  const min = Number(activity.data.min_score)
  if (normalized < min || normalized > max) {
    return { ok: false, message: `الدرجة يجب أن تكون بين ${min} و ${max}` }
  }

  const { data: existing } = await admin
    .from("member_activity_scores")
    .select("id, points")
    .eq("profile_id", memberId)
    .eq("activity_id", activityId)
    .eq("score_date", date)
    .maybeSingle()

  const payload = {
    profile_id: memberId,
    activity_id: activityId,
    score_date: date,
    points: normalized,
    recorded_by: actorId,
  }

  if (existing) {
    const { error } = await admin
      .from("member_activity_scores")
      .update({ points: normalized, recorded_by: actorId })
      .eq("id", existing.id)
    if (error) return { ok: false, message: "تعذر تحديث الدرجة" }
    await logAudit(admin, {
      actorId,
      action: ACTIVITY_SCORE_UPDATED,
      entity: ACTIVITY_SCORE_ENTITY,
      entityId: activityId,
      previous: { profile_id: memberId, score_date: date, points: Number(existing.points) },
      next: { profile_id: memberId, score_date: date, points: normalized },
    })
    return { ok: true, message: "تم تحديث الدرجة ✓", points: normalized }
  }

  const { error } = await admin.from("member_activity_scores").insert(payload)
  if (error) return { ok: false, message: "تعذر تسجيل الدرجة" }
  await logAudit(admin, {
    actorId,
    action: ACTIVITY_SCORE_CREATED,
    entity: ACTIVITY_SCORE_ENTITY,
    entityId: activityId,
    next: { profile_id: memberId, score_date: date, points: normalized },
  })
  return { ok: true, message: "تم تسجيل الدرجة ✓", points: normalized }
}

// --- Member-facing view -----------------------------------------------------

export type MemberActivityDayEntry = {
  activity_id: string
  code: string
  name: string
  icon: string | null
  min_score: number
  max_score: number
  points_today: number
  points_total: number
  days_active: number
}

export type MemberActivityView = {
  date: string
  today_points: number
  today_max: number
  today_percent: number
  grand_total: number
  total_max: number
  total_percent: number
  entries: MemberActivityDayEntry[]
}

/**
 * Today + cumulative activity scoring for a member.
 *
 * All active graded activities are listed. Activities the member has no
 * scores on still appear (0 / max_score) so their best-possible total is
 * visible, and the today percentage uses that full achievable denominator.
 * The cumulative total is also measured against what the member could have
 * earned on every day they were actually graded (max × days active), giving
 * an honest all-time percentage.
 */
export async function getMemberActivityView(
  admin: SupabaseAdminClient,
  profileId: string,
  date: string
): Promise<MemberActivityView> {
  const [activities, todayRows, allRows] = await Promise.all([
    listGradedActivities(admin),
    admin
      .from("member_activity_scores")
      .select("activity_id, points")
      .eq("profile_id", profileId)
      .eq("score_date", date),
    admin
      .from("member_activity_scores")
      .select("activity_id, points, score_date")
      .eq("profile_id", profileId),
  ])

  const todayByActivity = new Map<string, number>()
  for (const r of todayRows.data ?? []) {
    todayByActivity.set(r.activity_id, Number(r.points))
  }

  const totalByActivity = new Map<string, number>()
  const daysByActivity = new Map<string, Set<string>>()
  for (const r of allRows.data ?? []) {
    const aid = r.activity_id as string
    totalByActivity.set(aid, (totalByActivity.get(aid) ?? 0) + Number(r.points))
    const days = daysByActivity.get(aid) ?? new Set<string>()
    days.add(r.score_date as string)
    daysByActivity.set(aid, days)
  }

  let today_points = 0
  let today_max = 0
  let grand_total = 0
  let total_max = 0
  const entries: MemberActivityDayEntry[] = []

  for (const a of activities) {
    const max = Number(a.max_score)
    const points_today = todayByActivity.get(a.id) ?? 0
    const points_total = totalByActivity.get(a.id) ?? 0
    const days_active = daysByActivity.get(a.id)?.size ?? 0
    today_points += points_today
    today_max += max
    grand_total += points_total
    total_max += max * days_active
    entries.push({
      activity_id: a.id,
      code: a.code,
      name: a.name,
      icon: a.icon,
      min_score: Number(a.min_score),
      max_score: max,
      points_today,
      points_total,
      days_active,
    })
  }

  if (today_max <= 0) today_max = 0
  if (total_max <= 0) total_max = 0

  return {
    date,
    today_points,
    today_max,
    today_percent: today_max > 0 ? Math.round((today_points / today_max) * 100) : 0,
    grand_total,
    total_max,
    total_percent: total_max > 0 ? Math.round((grand_total / total_max) * 100) : 0,
    entries,
  }
}

export { toDateString }