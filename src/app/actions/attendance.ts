"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ROLES } from "@/lib/roles"
import { ATTENDANCE_TYPE_LABELS } from "@/lib/constants"
import {
  checkInByIdentifier,
  checkInByProfileId,
  correctAttendance,
  getServerNow,
  recordManualAttendance,
  resolvePersonByIdentifier,
  type AttendanceCorrection,
} from "@/services/attendance-service"
import type {
  AttendanceSource,
  AttendanceType,
  UserStatus,
} from "@/lib/types"
import { isUuid } from "@/lib/validation"
import { cairoDateString } from "@/lib/cairo"
import { LIST_PAGE_SIZE } from "@/lib/pagination"

const VALID_TYPES = Object.keys(ATTENDANCE_TYPE_LABELS) as AttendanceType[]

function isAttendanceType(value: string): value is AttendanceType {
  return (VALID_TYPES as string[]).includes(value)
}

/**
 * Attendance actors: SERVANT (may record attendance for servants & served
 * members per this feature), plus ADMIN / SUPER_ADMIN who already could.
 * SERVED_MEMBER is deliberately rejected — members only ever record their
 * own attendance and never for other people.
 */
async function requireAttendanceActor(): Promise<{ actorId: string; role: string } | null> {
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

export type ResolveIdentityResult =
  | {
      ok: true
      person: {
        id: string
        fullName: string
        role: string
        avatarUrl: string | null
      }
    }
  | { ok: false; message: string }

/** Identity preview for the manual 6-digit code fallback. Nothing is recorded. */
export async function resolveAttendanceIdentityAction(
  code: string,
  type: AttendanceType
): Promise<ResolveIdentityResult> {
  const actor = await requireAttendanceActor()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (typeof type !== "string" || !isAttendanceType(type)) {
    return { ok: false, message: "نوع الحضور غير صحيح" }
  }

  const admin = createAdminClient()
  const person = await resolvePersonByIdentifier(admin, "CODE", code.trim())
  if (!person) return { ok: false, message: "الكود غير صحيح" }
  if (person.status !== "ACTIVE") return { ok: false, message: "هذا الحساب غير نشط" }

  return {
    ok: true,
    person: {
      id: person.id,
      fullName: person.fullName,
      role: person.role,
      avatarUrl: person.avatarUrl,
    },
  }
}

export type RecordAttendanceResult = {
  status: "success" | "duplicate" | "error"
  message?: string
  person?: { id: string; fullName: string; role: string; avatarUrl: string | null }
  attendedAt?: string
  cairoTime?: string
  type?: AttendanceType
  source?: AttendanceSource
  points?: number
  ruleName?: string
}

/**
 * Records attendance from the scanner (QR capability token) or the manual
 * 6-digit code. The server owns resolution, time, points and duplicate rules.
 */
export async function recordAttendanceAction(
  mode: "QR" | "CODE",
  identifier: string,
  type: AttendanceType
): Promise<RecordAttendanceResult> {
  const actor = await requireAttendanceActor()
  if (!actor) return { status: "error", message: "غير مصرح" }
  if (mode !== "QR" && mode !== "CODE") return { status: "error", message: "طريقة غير صحيحة" }
  if (typeof type !== "string" || !isAttendanceType(type)) {
    return { status: "error", message: "نوع الحضور غير صحيح" }
  }

  const admin = createAdminClient()
  const outcome = await checkInByIdentifier(admin, {
    actorId: actor.actorId,
    mode,
    identifier: identifier.trim(),
    type,
  })

  if (outcome.status === "error") return outcome
  if (outcome.status === "success") {
    return {
      status: "success",
      person: outcome.person,
      attendedAt: outcome.attendedAt,
      cairoTime: outcome.cairoTime,
      type: outcome.type,
      source: outcome.source,
      points: outcome.points,
      ruleName: outcome.ruleName,
    }
  }
  return {
    status: "duplicate",
    person: outcome.person,
    attendedAt: outcome.attendedAt,
    type: outcome.type,
    points: outcome.points,
  }
}

/**
 * Admin/Super Admin manual attendance. Time and points always come from the
 * server — admins cannot backdate records (that is a separate correction flow
 * reserved for Super Admin).
 */
export async function manualAttendanceAction(
  profileId: string,
  type: AttendanceType
): Promise<RecordAttendanceResult> {
  const actor = await requireAttendanceActor()
  if (!actor) return { status: "error", message: "غير مصرح" }
  if (!isUuid(profileId)) return { status: "error", message: "بيانات غير صحيحة" }
  if (typeof type !== "string" || !isAttendanceType(type)) {
    return { status: "error", message: "نوع الحضور غير صحيح" }
  }

  const admin = createAdminClient()
  const outcome = await checkInByProfileId(admin, {
    actorId: actor.actorId,
    profileId,
    type,
  })
  console.log("[attendance.manualAttendanceAction]", { profileId, type, status: outcome.status, message: outcome.status === "error" ? outcome.message : undefined })

  if (outcome.status === "error") return outcome
  if (outcome.status === "success") {
    return {
      status: "success",
      person: outcome.person,
      attendedAt: outcome.attendedAt,
      cairoTime: outcome.cairoTime,
      type: outcome.type,
      source: outcome.source,
      points: outcome.points,
      ruleName: outcome.ruleName,
    }
  }
  return {
    status: "duplicate",
    person: outcome.person,
    attendedAt: outcome.attendedAt,
    type: outcome.type,
    points: outcome.points,
  }
}

/**
 * Manual attendance for a specific Friday — the servant picks a scoring rule
 * whose start_time pins the attendance instant. Used by the manual attendance
 * dialog when recording attendance for a past or present Friday.
 */
export async function recordManualAttendanceAction(
  profileId: string,
  ruleId: string,
  sessionDate: string
): Promise<RecordAttendanceResult> {
  const actor = await requireAttendanceActor()
  if (!actor) return { status: "error", message: "غير مصرح" }
  if (!isUuid(profileId)) return { status: "error", message: "بيانات غير صحيحة" }
  if (!isUuid(ruleId)) return { status: "error", message: "نقطة التسجيل غير صحيحة" }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
    return { status: "error", message: "التاريخ غير صحيح" }
  }

  const admin = createAdminClient()
  const outcome = await recordManualAttendance(admin, {
    actorId: actor.actorId,
    profileId,
    ruleId,
    sessionDate,
  })

  if (outcome.status === "error") return outcome
  if (outcome.status === "success") {
    return {
      status: "success",
      person: outcome.person,
      attendedAt: outcome.attendedAt,
      cairoTime: outcome.cairoTime,
      type: outcome.type,
      source: outcome.source,
      points: outcome.points,
      ruleName: outcome.ruleName,
    }
  }
  return {
    status: "duplicate",
    person: outcome.person,
    attendedAt: outcome.attendedAt,
    type: outcome.type,
    points: outcome.points,
  }
}

export type CorrectAttendanceResult = { ok: boolean; message: string }

/** Super Admin only: change attendance type or void. Every change is audited. */
export async function correctAttendanceAction(
  recordId: string,
  change: AttendanceCorrection
): Promise<CorrectAttendanceResult> {
  const actor = await requireAttendanceActor()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (!isUuid(recordId)) return { ok: false, message: "بيانات غير صحيحة" }
  if (actor.role !== ROLES.SUPER_ADMIN) {
    return { ok: false, message: "هذه العملية متاحة لمسؤول عام فقط" }
  }

  const admin = createAdminClient()
  return correctAttendance(admin, { actorId: actor.actorId, recordId, change })
}

// ---------------------------------------------------------------------------
// Attendance board — shared by the SERVANT attendance page (first page for
// both tabs) and the client-side search / load-more actions.
// ---------------------------------------------------------------------------

export type BoardAttendance = {
  attended_at: string
  type: AttendanceType
  source: AttendanceSource
  points: number
}

export type BoardPerson = {
  id: string
  fullName: string
  role: "SERVANT" | "SERVED_MEMBER"
  status: UserStatus
  isMe: boolean
  /** Today's (Cairo) active attendance record for this person, if any. */
  attendance: BoardAttendance | null
}

type BoardPageInput = {
  role: "SERVANT" | "SERVED_MEMBER"
  query: string
  offset: number
}

function sanitizeBoardInput(input: BoardPageInput): BoardPageInput {
  const offset = Number.isFinite(input.offset) && input.offset >= 0 ? Math.floor(input.offset) : 0
  const query = typeof input.query === "string" ? input.query.trim().slice(0, 120) : ""
  const role = input.role === "SERVED_MEMBER" ? "SERVED_MEMBER" : "SERVANT"
  return { role, query, offset }
}

/**
 * Fetches one page of the attendance board for a role: active (non-archived)
 * servants or served members ordered by name, joined with each person's
 * today attendance. Runs through the RLS-bound client so the SERVANT scope
 * policies are the final authority on what is visible.
 */
export async function fetchAttendanceBoardPageAction(input: BoardPageInput): Promise<{
  ok: boolean
  people: BoardPerson[]
  total: number
  message?: string
}> {
  const actor = await requireAttendanceActor()
  if (!actor) return { ok: false, people: [], total: 0, message: "غير مصرح" }

  const { role, query, offset } = sanitizeBoardInput(input)
  const supabase = await createClient()

  let request = supabase
    .from("profiles")
    .select("id, full_name, role, status", { count: "exact" })
    .eq("role", role)
    .neq("status", "ARCHIVED")
  if (query) request = request.ilike("full_name", `%${query}%`)

  const { data, count, error } = await request
    .order("full_name", { ascending: true })
    .order("id")
    .range(offset, offset + LIST_PAGE_SIZE - 1)

  if (error) return { ok: false, people: [], total: 0, message: "تعذر تحميل القائمة" }

  const raw = data ?? []
  const people: BoardPerson[] = raw.map((p) => ({
    id: p.id as string,
    fullName: p.full_name as string,
    role: p.role as BoardPerson["role"],
    status: p.status as UserStatus,
    isMe: p.id === actor.actorId,
    attendance: null,
  }))

  const attendanceMap = await loadTodayAttendanceByIds(supabase, role, people.map((p) => p.id))
  for (const person of people) {
    person.attendance = attendanceMap.get(person.id) ?? null
  }

  return { ok: true, people, total: count ?? raw.length }
}

/**
 * Loads today's (Cairo) active attendance records for a set of profile ids and
 * maps them by subject — the earliest record wins so a person is "حاضر" even
 * when they attended both CHURCH and SERVICE today.
 */
export async function loadTodayAttendanceByIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  role: "SERVANT" | "SERVED_MEMBER",
  ids: string[]
): Promise<Map<string, BoardAttendance>> {
  const map = new Map<string, BoardAttendance>()
  if (ids.length === 0) return map

  const today = cairoDateString(getServerNow())
  const { data } = await supabase
    .from("attendance_records")
    .select(
      "profile_id, attended_at, points, source, status, session:attendance_sessions!inner(type)"
    )
    .eq("session.session_date", today)
    .neq("status", "ARCHIVED")
    .in("profile_id", ids)
    .order("attended_at", { ascending: true })

  for (const r of data ?? []) {
    const pid = r.profile_id as string
    if (map.has(pid)) continue
    const session = r.session as unknown as { type: AttendanceType } | { type: AttendanceType }[] | null
    const sessionType = Array.isArray(session) ? session[0]?.type : session?.type
    map.set(pid, {
      attended_at: r.attended_at as string,
      type: sessionType === "SERVICE" ? "SERVICE" : "CHURCH",
      source: (r.source ?? "MANUAL") as AttendanceSource,
      points: Number(r.points),
    })
  }
  return map
}
