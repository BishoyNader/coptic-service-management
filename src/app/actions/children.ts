"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ROLES } from "@/lib/roles"
import { ATTENDANCE_TYPE_LABELS } from "@/lib/constants"
import { cairoDateString } from "@/lib/cairo"
import { getServerNow } from "@/services/attendance-service"
import { isUuid } from "@/lib/validation"
import { validateCommitmentScore } from "@/services/scoring-rules"
import {
  getWeeklyEntryState,
  saveWeeklyScores,
  type WeeklyEntryState,
} from "@/services/scoring-service"
import {
  recordChildAttendance,
  removeServantChildAttendance,
} from "@/services/attendance-service"
import {
  getServantClassId,
  memberInClass,
} from "@/services/member-scoring-service"
import type { AttendanceSource, AttendanceType } from "@/lib/types"

const VALID_TYPES = Object.keys(ATTENDANCE_TYPE_LABELS) as AttendanceType[]

function isAttendanceType(value: string): value is AttendanceType {
  return (VALID_TYPES as string[]).includes(value)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** True for a real "YYYY-MM-DD" calendar date (rejects e.g. 2026-02-30). */
function isRealDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const [y, m, d] = value.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

async function requireServantActor(): Promise<{ actorId: string; role: string } | null> {
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

  if (
    !profile ||
    (profile.role !== ROLES.SERVANT && profile.role !== ROLES.SUPER_ADMIN)
  ) {
    return null
  }
  return { actorId: user.id, role: profile.role }
}

export type ChildAttendanceActionResult = {
  ok: boolean
  duplicate?: boolean
  message: string
}

/**
 * A servant records a child's attendance for a chosen Cairo date. Duplicate
 * same-session entries resolve to an informative "already recorded".
 */
export async function recordChildAttendanceAction(
  memberId: string,
  type: string,
  date: string
): Promise<ChildAttendanceActionResult> {
  const actor = await requireServantActor()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (!isUuid(memberId)) return { ok: false, message: "مخدوم غير صحيح" }
  if (typeof type !== "string" || !isAttendanceType(type)) {
    return { ok: false, message: "نوع الحضور غير صحيح" }
  }
  if (typeof date !== "string" || !isRealDateString(date)) {
    return { ok: false, message: "التاريخ غير صحيح" }
  }

  const admin = createAdminClient()

  // A servant with an assigned class may only record attendance for members
  // of that class (their class-scoped board). Unassigned servants keep the
  // legacy any-member scope.
  if (actor.role === ROLES.SERVANT) {
    const myClass = await getServantClassId(admin, actor.actorId)
    if (myClass && !(await memberInClass(admin, memberId, myClass))) {
      return { ok: false, message: "هذا المخدوم ليس من صفّك" }
    }
  }

  const res = await recordChildAttendance(admin, {
    actorId: actor.actorId,
    actorRole: actor.role,
    memberId,
    type,
    date,
  })

  if (res.status === "success") {
    return { ok: true, message: `تم تسجيل الحضور (${res.points} نقطة)` }
  }
  if (res.status === "duplicate") {
    return { ok: false, duplicate: true, message: "تم تسجيل الحضور بالفعل" }
  }
  return { ok: false, message: res.message }
}

/** A servant may undo their own attendance entry for a child; super admins may undo any. */
export async function removeChildAttendanceAction(
  recordId: string
): Promise<{ ok: boolean; message: string }> {
  const actor = await requireServantActor()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (!isUuid(recordId)) return { ok: false, message: "سجل غير صحيح" }

  const admin = createAdminClient()
  const result = await removeServantChildAttendance(admin, {
    actorId: actor.actorId,
    actorRole: actor.role,
    recordId,
  })
  console.log("[children.removeChildAttendanceAction]", { recordId, result })
  return result
}

/**
 * Servant writes a child's weekly card (commitment / tunic / communion /
 * service commitment / bonus) for the week containing `date`. Persistence,
 * period keys and audit all reuse the admin weekly-card engine.
 */
export async function saveChildScoresAction(input: {
  profileId: string
  date: string
  commitment: string | number
  serviceCommitment: string | number
  tunic: boolean
  communion: boolean
  bonus: boolean
}): Promise<{ ok: boolean; changed?: boolean; message?: string }> {
  const actor = await requireServantActor()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (!isUuid(input.profileId)) return { ok: false, message: "مخدوم غير صحيح" }
  if (typeof input.date !== "string" || !isRealDateString(input.date)) {
    return { ok: false, message: "التاريخ غير صحيح" }
  }

  const commitment = Number(input.commitment)
  const serviceCommitment = Number(input.serviceCommitment)
  if (validateCommitmentScore(commitment) === null || validateCommitmentScore(serviceCommitment) === null) {
    return { ok: false, message: "الالتزام لازم يكون رقم من 0 لـ 10" }
  }

  const admin = createAdminClient()
  const result = await saveWeeklyScores(admin, {
    actorId: actor.actorId,
    profileId: input.profileId,
    weekRef: input.date,
    scores: {
      commitment,
      serviceCommitment,
      communion: Boolean(input.communion),
      tunic: Boolean(input.tunic),
      bonus: Boolean(input.bonus),
      note: null,
    },
  })

  return {
    ok: result.ok,
    changed: result.changed,
    message: result.ok
      ? "تم حفظ الدرجات"
      : result.message ?? "تعذر حفظ الدرجات",
  }
}

export type ChildDayAttendanceRow = {
  id: string
  type: AttendanceType
  points: number
  source: AttendanceSource
  attendedAt: string
  recordedBy: string | null
}

export type ChildDayHistoryItem = {
  id: string
  category: string
  date: string
  points: number
  note: string | null
  unit: "attendance" | "score"
}

export type ChildDayView =
  | { ok: false; message: string }
  | {
      ok: true
      attendance: ChildDayAttendanceRow[]
      state: WeeklyEntryState
      history: ChildDayHistoryItem[]
    }

/** Servant-scoped daily view: a child's attendance + graded card for a date. */
export async function getChildDayViewAction(
  memberId: string,
  date: string
): Promise<ChildDayView> {
  const actor = await requireServantActor()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (!isUuid(memberId)) return { ok: false, message: "مخدوم غير صحيح" }
  if (typeof date !== "string" || !isRealDateString(date)) {
    return { ok: false, message: "التاريخ غير صحيح" }
  }
  const cairoToday = cairoDateString(getServerNow())
  if (date > cairoToday) return { ok: false, message: "لا يمكن عرض تاريخ مستقبلي" }

  const admin = createAdminClient()

  const { data: target } = await admin
    .from("profiles")
    .select("id, role, status")
    .eq("id", memberId)
    .maybeSingle()
  if (!target || target.role !== ROLES.SERVED_MEMBER || target.status !== "ACTIVE") {
    return { ok: false, message: "لا يوجد مخدوم نشط بهذا الاسم" }
  }

  const [attendance, state, scores, recent] = await Promise.all([
    admin
      .from("attendance_records")
      .select(
        "id, attended_at, points, source, recorded_by, session:attendance_sessions!inner(type)"
      )
      .eq("profile_id", memberId)
      .eq("session.session_date", date)
      .neq("status", "ARCHIVED"),
    getWeeklyEntryState(admin, memberId, date),
    admin
      .from("score_records")
      .select("id, category, points, session_date, note")
      .eq("profile_id", memberId)
      .eq("is_voided", false)
      .order("session_date", { ascending: false })
      .limit(15),
    admin
      .from("attendance_records")
      .select("id, attended_at, points, session:attendance_sessions(type, session_date)")
      .eq("profile_id", memberId)
      .neq("status", "ARCHIVED")
      .order("attended_at", { ascending: false })
      .limit(15),
  ])

  const attendanceRows: ChildDayAttendanceRow[] = (attendance.data ?? []).map((r) => ({
    id: r.id,
    type: ((r.session as unknown as { type?: string } | null)?.type ??
      "CHURCH") as AttendanceType,
    points: Number(r.points),
    source: (r.source ?? "MANUAL") as AttendanceSource,
    attendedAt: r.attended_at,
    recordedBy: r.recorded_by,
  }))

  const history: ChildDayHistoryItem[] = []
  for (const r of scores.data ?? []) {
    history.push({
      id: r.id,
      unit: "score",
      category: r.category,
      date: r.session_date,
      points: Number(r.points),
      note: r.note,
    })
  }
  for (const r of recent.data ?? []) {
    const session = r.session as unknown as
      | { type?: string; session_date?: string }
      | null
    history.push({
      id: r.id,
      unit: "attendance",
      category: (session?.type ?? "CHURCH") as string,
      date: (session?.session_date ?? date) as string,
      points: Number(r.points),
      note: null,
    })
  }
  history.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  return {
    ok: true,
    attendance: attendanceRows,
    state,
    history,
  }
}