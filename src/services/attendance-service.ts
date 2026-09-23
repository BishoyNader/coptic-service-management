import type { SupabaseAdminClient } from "@/lib/supabase/admin"
import type { AppRole } from "@/lib/roles"
import type {
  AttendanceSource,
  AttendanceStatus,
  AttendanceType,
  UserStatus,
} from "@/lib/types"
import { ATTENDANCE_TYPE_LABELS } from "@/lib/constants"
import { cairoDateString, cairoLocalToInstant, cairoTimeString, isCairoFriday } from "@/lib/cairo"
import { ROLES } from "@/lib/roles"
import { logAudit } from "./auth-service"
import {
  attendanceCategory,
  resolveAttendanceBand,
  type AttendanceRuleResolution,
} from "./attendance-rules"
import { periodKeyForDate } from "./scoring-rules"

/**
 * Authoritative "now" for the attendance engine.
 *
 * Production always uses the real server clock. An optional
 * `ATTENDANCE_TEST_NOW` ISO override exists ONLY so the deterministic E2E
 * suite can drive time-dependent flows; a client can never influence it.
 * The override is hard-disabled when `NODE_ENV === "production"` so a
 * misconfigured production server can never run the engine on a test clock.
 */
export function resolveServerNow(
  override: string | undefined,
  overrideAllowed: boolean
): Date {
  if (overrideAllowed && override) {
    const d = new Date(override)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date()
}

export function getServerNow(): Date {
  return resolveServerNow(
    process.env.ATTENDANCE_TEST_NOW,
    process.env.NODE_ENV !== "production"
  )
}

export type AttendancePerson = {
  id: string
  fullName: string
  role: AppRole
  avatarUrl: string | null
  status: UserStatus
  personalCode: string | null
}

export type CheckInPerson = {
  id: string
  fullName: string
  role: AppRole
  avatarUrl: string | null
}

export type CheckInOutcome =
  | {
      status: "success"
      person: CheckInPerson
      attendedAt: string
      cairoTime: string
      type: AttendanceType
      source: AttendanceSource
      points: number
      /** Name of the matched scoring band (e.g. "باكر"), when one applied. */
      ruleName?: string
    }
  | {
      status: "duplicate"
      person: CheckInPerson
      attendedAt: string
      type: AttendanceType
      points: number
    }
  | { status: "error"; message: string }

/**
 * Finds or creates the daily attendance session for (type, Cairo date).
 * The `(type, session_date)` unique constraint makes this race-safe.
 */
async function ensureAttendanceSession(
  admin: SupabaseAdminClient,
  type: AttendanceType,
  sessionDate: string,
  actorId: string
): Promise<string> {
  const { data: existing } = await admin
    .from("attendance_sessions")
    .select("id")
    .eq("type", type)
    .eq("session_date", sessionDate)
    .maybeSingle()

  if (existing) return existing.id

  const { data, error } = await admin
    .from("attendance_sessions")
    .insert({
      type,
      title: ATTENDANCE_TYPE_LABELS[type],
      session_date: sessionDate,
      created_by: actorId,
    })
    .select("id")
    .single()

  if (error) {
    // Unique (type, session_date) — another request won the race.
    if (error.code === "23505") {
      const { data: again } = await admin
        .from("attendance_sessions")
        .select("id")
        .eq("type", type)
        .eq("session_date", sessionDate)
        .maybeSingle()
      if (again) return again.id
    }
    throw new Error("تعذر إنشاء جلسة الحضور")
  }

  return data.id
}

/** Resolves a person from a QR capability token or a 6-digit personal code. */
export async function resolvePersonByIdentifier(
  admin: SupabaseAdminClient,
  mode: "QR" | "CODE",
  identifier: string
): Promise<AttendancePerson | null> {
  const column = mode === "QR" ? "qr_token" : "code"
  const { data: codes } = await admin
    .from("personal_codes")
    .select("profile_id, code, qr_token")
    .eq(column, identifier)
    .maybeSingle()

  if (!codes) return null

  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, full_name, status, avatar_url")
    .eq("id", codes.profile_id)
    .maybeSingle()

  if (!profile) return null

  return {
    id: profile.id,
    fullName: profile.full_name,
    role: profile.role as AppRole,
    avatarUrl: profile.avatar_url,
    status: profile.status as UserStatus,
    personalCode: mode === "CODE" ? codes.code : null,
  }
}

export async function resolvePersonByProfileId(
  admin: SupabaseAdminClient,
  profileId: string
): Promise<AttendancePerson | null> {
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, full_name, status, avatar_url")
    .eq("id", profileId)
    .maybeSingle()

  if (!profile) return null

  return {
    id: profile.id,
    fullName: profile.full_name,
    role: profile.role as AppRole,
    avatarUrl: profile.avatar_url,
    status: profile.status as UserStatus,
    personalCode: null,
  }
}

/**
 * Core check-in. The actor is derived server-side from the authenticated
 * session; the target person is resolved from a trusted identifier (QR
 * capability token or 6-digit code) that we look up server-side — never from
 * a client-provided user id.
 *
 * `sessionDate` is the Cairo wall-date of the session being recorded (always
 * a Friday). For real-time check-ins it is derived from `now`; for
 * backdated servant child-records it is the explicitly chosen date. The
 * Friday validation is performed against `sessionDate` so both paths work
 * correctly regardless of the current server clock.
 */
async function executeCheckIn(
  admin: SupabaseAdminClient,
  params: {
    actorId: string
    /** Role of the authenticated actor — used to enforce who may record whom. */
    actorRole: string
    person: AttendancePerson
    type: AttendanceType
    source: AttendanceSource
    now: Date
    /** Cairo wall-date (YYYY-MM-DD) of the session. Defaults to cairoDateString(now). */
    sessionDate?: string
    /**
     * Explicit attendance points (served members only), used for manual entry
     * where an admin picks the value. When omitted the attendance band rules
     * resolve the points as usual.
     */
    pointsOverride?: number
  }
): Promise<CheckInOutcome> {
  const { actorId, actorRole, person, type, source, now, pointsOverride } = params
  const cairoDate = params.sessionDate ?? cairoDateString(now)

  if (person.status !== "ACTIVE") {
    return { status: "error", message: "هذا الحساب غير نشط" }
  }
  if (person.role !== "SERVED_MEMBER" && person.role !== "SERVANT") {
    return { status: "error", message: "هذا النوع من الحسابات لا يسجّل حضورًا" }
  }
  // Servant attendance is recorded from the super admin side only.
  if (person.role === "SERVANT" && actorRole !== "SUPER_ADMIN") {
    return { status: "error", message: "حضور الخدام يُسجَّل من مسؤول الخدمة فقط" }
  }

  if (!isCairoFriday(cairoDate)) {
    return { status: "error", message: "الحضور يُسجَّل يوم الجمعة فقط" }
  }
  const sessionId = await ensureAttendanceSession(admin, type, cairoDate, actorId)

  // Duplicate check: an active record already exists for this session.
  const { data: existing } = await admin
    .from("attendance_records")
    .select("id, attended_at, points")
    .eq("profile_id", person.id)
    .eq("session_id", sessionId)
    .neq("status", "ARCHIVED")
    .maybeSingle()

  if (existing) {
    return {
      status: "duplicate",
      person: personToOutcome(person),
      attendedAt: existing.attended_at,
      type,
      points: Number(existing.points),
    }
  }

  // Servants are tracked as present/absent only — no scoring, no time bands.
  // Scoring rules apply only to served members.
  let points = 0
  let resolution: AttendanceRuleResolution = { points: 0, rule: null }

  if (person.role === "SERVED_MEMBER") {
    const { data: rules } = await admin
      .from("scoring_rules")
      .select("*")
      .in("category", ["CHURCH_ATTENDANCE", "SERVICE_ATTENDANCE"])

    resolution = resolveAttendanceBand(
      type,
      now,
      (rules ?? []) as Parameters<typeof resolveAttendanceBand>[2],
      person.role
    )
    points = pointsOverride ?? resolution.points
  }

  // Compute period key for score_records so the weekly/monthly engine
  // can aggregate attendance-derived scores correctly.
  const scoreCategory =
    person.role === "SERVED_MEMBER" ? attendanceCategory(type) : null
  const periodKey = scoreCategory
    ? periodKeyForDate(
        scoreCategory === "MONTHLY_ACTIVITY" ? "MONTHLY" : "WEEKLY",
        cairoDate
      )
    : null

  // Attendance + earned score persisted atomically in one DB transaction
  // (record_attendance_with_score). The partial unique index is internal to
  // the function, so a concurrent double check-in resolves to "duplicate".
  const { data: rpcData, error: rpcError } = await admin.rpc(
    "record_attendance_with_score",
    {
      p_session_id: sessionId,
      p_profile_id: person.id,
      p_attended_at: now.toISOString(),
      p_points: points,
      p_recorded_by: actorId,
      p_source: source,
      p_score_category: scoreCategory,
      p_score_rule_id: resolution.rule?.id ?? null,
      p_session_date: cairoDate,
      p_period_key: periodKey,
    }
  )

  if (rpcError) {
    return { status: "error", message: "تعذر تسجيل الحضور" }
  }

  const result = rpcData as unknown as {
    status: string
    id: string
    attended_at: string
    points: number | string
  }

  if (result.status === "duplicate") {
    return {
      status: "duplicate",
      person: personToOutcome(person),
      attendedAt: result.attended_at,
      type,
      points: Number(result.points),
    }
  }

  const attendedAt = now.toISOString()
  const auditAction = source === "MANUAL" ? "ATTENDANCE_MANUAL" : "ATTENDANCE_CHECKIN"
  // Successful recording is audited exactly once, post-commit via the
  // service-role client — the same convention as ATTENDANCE_VOIDED and
  // ATTENDANCE_CORRECTED. The actor is the authenticated server session;
  // the subject (person whose attendance was recorded) and its role are
  // captured in metadata so self vs cross-person recording is unambiguous.
  // Duplicate attempts never reach this point, so they add no audit rows.
  await logAudit(admin, {
    actorId,
    action: auditAction,
    entity: "ATTENDANCE",
    entityId: result.id,
    metadata: {
      profile_id: person.id,
      subject_role: person.role,
      attended_at: attendedAt,
      type,
      source,
      points,
      session_id: sessionId,
      outcome: "success",
    },
  })

  return {
    status: "success",
    person: personToOutcome(person),
    attendedAt,
    cairoTime: cairoTimeString(now),
    type,
    source,
    points,
    ruleName: resolution.rule?.name,
  }
}

function personToOutcome(person: AttendancePerson): CheckInPerson {
  return {
    id: person.id,
    fullName: person.fullName,
    role: person.role,
    avatarUrl: person.avatarUrl,
  }
}

/** Attendance row projected for admin/super-admin history lists. */
export type AttendanceRowData = {
  id: string
  attended_at: string
  points: number
  source: AttendanceSource
  status: AttendanceStatus
  type: AttendanceType
  fullName: string
  role: AppRole
}

type RawRecordRow = {
  id: string
  attended_at: string
  points: number | string
  source: string
  status: string
  session?: { type?: string } | null
  profile?: { full_name?: string | null; role?: string | null } | null
}

/** Normalizes a PostgREST attendance row (with embedded session + profile). */
export function toAttendanceRows(raw: RawRecordRow[]): AttendanceRowData[] {
  return raw.map((r) => ({
    id: r.id,
    attended_at: r.attended_at,
    points: Number(r.points),
    source: (r.source ?? "MANUAL") as AttendanceSource,
    status: (r.status ?? "PRESENT") as AttendanceStatus,
    type: (r.session?.type ?? "CHURCH") as AttendanceType,
    fullName: r.profile?.full_name ?? "—",
    role: (r.profile?.role ?? "SERVED_MEMBER") as AppRole,
  }))
}

export async function checkInByIdentifier(
  admin: SupabaseAdminClient,
  params: {
    actorId: string
    actorRole: string
    mode: "QR" | "CODE"
    identifier: string
    type: AttendanceType
  }
): Promise<CheckInOutcome> {
  const { actorId, actorRole, mode, identifier, type } = params

  if (mode === "CODE" && !/^[0-9]{6}$/.test(identifier)) {
    return { status: "error", message: "الكود يجب أن يكون 6 أرقام" }
  }

  const person = await resolvePersonByIdentifier(admin, mode, identifier)
  if (!person) {
    return {
      status: "error",
      message: mode === "QR" ? "الكود غير معروف" : "الكود غير صحيح",
    }
  }

  return executeCheckIn(admin, {
    actorId,
    actorRole,
    person,
    type,
    source: mode === "QR" ? "QR" : "CODE",
    now: getServerNow(),
  })
}

/** Admin/Super Admin manual attendance — the server still decides the time. */
export async function checkInByProfileId(
  admin: SupabaseAdminClient,
  params: { actorId: string; actorRole: string; profileId: string; type: AttendanceType }
): Promise<CheckInOutcome> {
  const { actorId, actorRole, profileId, type } = params
  const person = await resolvePersonByProfileId(admin, profileId)
  if (!person) return { status: "error", message: "الشخص غير موجود" }

  return executeCheckIn(admin, {
    actorId,
    actorRole,
    person,
    type,
    source: "MANUAL",
    now: getServerNow(),
  })
}

export type AttendanceCorrection = { type?: AttendanceType } | { voided: true }

/**
 * Super Admin attendance correction.
 * - Change type  → move the record to the target session of the SAME
 *   original Cairo day and recompute points from the ORIGINAL check-in time
 *   (historical integrity preserved).
 * - Void         → soft-delete: attendance row is archived, its score is
 *   soft-voided, nothing is permanently destroyed.
 * Both paths are audited with before/after values.
 */
export async function correctAttendance(
  admin: SupabaseAdminClient,
  params: { actorId: string; recordId: string; change: AttendanceCorrection }
): Promise<{ ok: boolean; message: string }> {
  const { actorId, recordId, change } = params

  const { data: record } = await admin
    .from("attendance_records")
    .select("id, session_id, profile_id, attended_at, points, status")
    .eq("id", recordId)
    .maybeSingle()

  if (!record) return { ok: false, message: "سجل الحضور غير موجود" }
  if (record.status === "ARCHIVED") return { ok: false, message: "السجل ملغي بالفعل" }

  const { data: session } = await admin
    .from("attendance_sessions")
    .select("id, type, session_date")
    .eq("id", record.session_id)
    .maybeSingle()

  if (!session) return { ok: false, message: "جلسة الحضور غير موجودة" }

  const previous = {
    type: session.type,
    points: Number(record.points),
    status: record.status,
  }

  // --- Void (soft delete) ---------------------------------------------------
  if ("voided" in change) {
    if (!change.voided) return { ok: false, message: "تغيير غير صحيح" }

    // Archive record + soft-void score atomically in one DB transaction.
    const { data: voidRes, error: voidError } = await admin.rpc("void_attendance", {
      p_record_id: recordId,
    })
    if (voidError) return { ok: false, message: "تعذر إلغاء التسجيل" }

    const voided = voidRes as unknown as { ok?: boolean; error?: string }
    if (!voided.ok) {
      if (voided.error === "not_found") return { ok: false, message: "سجل الحضور غير موجود" }
      if (voided.error === "already_archived") return { ok: false, message: "السجل ملغي بالفعل" }
      return { ok: false, message: "تعذر إلغاء التسجيل" }
    }

    await logAudit(admin, {
      actorId,
      action: "ATTENDANCE_VOIDED",
      entity: "ATTENDANCE",
      entityId: recordId,
      previous,
      next: { status: "ARCHIVED" },
    })

    return { ok: true, message: "تم إلغاء تسجيل الحضور" }
  }

  // --- Change attendance type ------------------------------------------------
  const newType = change.type
  if (!newType || newType === session.type) {
    return { ok: false, message: "لا يوجد تغيير في نوع الحضور" }
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", record.profile_id)
    .maybeSingle()

  // Use the session's own date (already guaranteed Friday by the DB constraint
  // and by executeCheckIn). Re-checking the original attended_at timestamp is
  // wrong: it may cross midnight UTC while still being a Cairo-Friday session.
  const cairoDate = session.session_date as string
  // The original instant is still used for time-of-day band resolution so
  // that a correction preserves the historical check-in time for scoring.
  const originalInstant = new Date(record.attended_at)
  const newSessionId = await ensureAttendanceSession(admin, newType, cairoDate, actorId)

  // No duplicate in the target session for the same person.
  const { data: duplicate } = await admin
    .from("attendance_records")
    .select("id")
    .eq("profile_id", record.profile_id)
    .eq("session_id", newSessionId)
    .neq("status", "ARCHIVED")
    .maybeSingle()

  if (duplicate) {
    return { ok: false, message: "يوجد حضور مسجّل بالفعل بهذا النوع في نفس اليوم" }
  }

  const { data: rules } = await admin
    .from("scoring_rules")
    .select("*")
    .in("category", ["CHURCH_ATTENDANCE", "SERVICE_ATTENDANCE"])

  const role = (profile?.role as AppRole) ?? "SERVED_MEMBER"
  const resolution = resolveAttendanceBand(
    newType,
    originalInstant,
    (rules ?? []) as Parameters<typeof resolveAttendanceBand>[2],
    role
  )
  const newPoints = role === "SERVED_MEMBER" ? resolution.points : 0
  const corrScoreCategory = role === "SERVED_MEMBER" ? attendanceCategory(newType) : null

  // Attendance move + score resize/void persisted atomically in one DB
  // transaction (correct_attendance_type). The unique target-session check
  // done above is re-enforced inside the function for the concurrent case.
  const { data: corrRes, error: corrError } = await admin.rpc(
    "correct_attendance_type",
    {
      p_record_id: recordId,
      p_new_session_id: newSessionId,
      p_new_points: newPoints,
      p_score_category: corrScoreCategory,
      p_score_rule_id: resolution.rule?.id ?? null,
      p_session_date: cairoDate,
      p_actor_id: actorId,
    }
  )
  if (corrError) return { ok: false, message: "تعذر تصحيح الحضور" }

  const corrected = corrRes as unknown as { ok?: boolean; error?: string }
  if (!corrected.ok) {
    if (corrected.error === "not_found") return { ok: false, message: "سجل الحضور غير موجود" }
    if (corrected.error === "already_archived") return { ok: false, message: "السجل ملغي بالفعل" }
    if (corrected.error === "duplicate") {
      return { ok: false, message: "يوجد حضور مسجّل بالفعل بهذا النوع في نفس اليوم" }
    }
    return { ok: false, message: "تعذر تصحيح الحضور" }
  }

  await logAudit(admin, {
    actorId,
    action: "ATTENDANCE_CORRECTED",
    entity: "ATTENDANCE",
    entityId: recordId,
    previous,
    next: { type: newType, points: newPoints },
  })

  return { ok: true, message: "تم تصحيح الحضور" }
}

/** Servant-side default of the day for each type (window start ⇒ full band). */
const CHILD_ATTENDANCE_DEFAULT_TIMES: Record<AttendanceType, string> = {
  CHURCH: "07:00",
  SERVICE: "10:30",
}

/**
 * A servant records a child's (ACTIVE served member) attendance for a chosen
 * Cairo date (today or earlier). The instant is reconstructed server-side
 * from the chosen date plus each type's default time-of-day (window start),
 * so the entry resolves deterministically to the full attendance band. The
 * stale `now` interpretation is intentional: a record-keeping entry, not a
 * live check-in — the server, never the client, pins the time.
 */
export async function recordChildAttendance(
  admin: SupabaseAdminClient,
  params: {
    actorId: string
    actorRole: string
    memberId: string
    type: AttendanceType
    date: string
    /** Explicit points override — used when an admin picks the attendance value. */
    points?: number
  }
): Promise<CheckInOutcome> {
  const { actorId, actorRole, memberId, type, date, points } = params

  const person = await resolvePersonByProfileId(admin, memberId)
  if (!person) return { status: "error", message: "الشخص غير موجود" }
  if (person.role !== ROLES.SERVED_MEMBER) {
    return { status: "error", message: "السجلات تُكتب للمخدومين فقط" }
  }
  if (person.status !== "ACTIVE") {
    return { status: "error", message: "هذا الحساب غير نشط" }
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { status: "error", message: "التاريخ غير صحيح" }
  }
  const cairoToday = cairoDateString(getServerNow())
  if (date > cairoToday) {
    return { status: "error", message: "لا يمكن تسجيل حضور في تاريخ مستقبلي" }
  }

  return executeCheckIn(admin, {
    actorId,
    actorRole,
    person,
    type,
    source: "MANUAL",
    now: cairoLocalToInstant(date, CHILD_ATTENDANCE_DEFAULT_TIMES[type]),
    sessionDate: date,
    pointsOverride: points,
  })
}

/**
 * Manual attendance for any Friday — the servant picks a scoring rule whose
 * start_time pins the attendance instant. The session date is the chosen
 * Friday (not necessarily today). Used by the manual attendance dialog when
 * recording attendance for a past or present Friday.
 */
export async function recordManualAttendance(
  admin: SupabaseAdminClient,
  params: {
    actorId: string
    actorRole: string
    profileId: string
    ruleId: string
    sessionDate: string
  }
): Promise<CheckInOutcome> {
  const { actorId, actorRole, profileId, ruleId, sessionDate } = params

  const person = await resolvePersonByProfileId(admin, profileId)
  if (!person) return { status: "error", message: "الشخص غير موجود" }
  if (person.role !== ROLES.SERVED_MEMBER && person.role !== ROLES.SERVANT) {
    return { status: "error", message: "هذا النوع من الحسابات لا يسجّل حضورًا" }
  }
  if (!sessionDate || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) {
    return { status: "error", message: "التاريخ غير صحيح" }
  }
  if (!isCairoFriday(sessionDate)) {
    return { status: "error", message: "الحضور يُسجَّل يوم الجمعة فقط" }
  }

  const cairoToday = cairoDateString(getServerNow())
  if (sessionDate > cairoToday) {
    return { status: "error", message: "لا يمكن تسجيل حضور في تاريخ مستقبلي" }
  }

  // Look up the scoring rule to determine type + time
  const { data: rule } = await admin
    .from("scoring_rules")
    .select("*")
    .eq("id", ruleId)
    .maybeSingle()

  if (!rule) return { status: "error", message: "نقطة التسجيل غير موجودة" }

  const category = rule.category as string
  let type: AttendanceType
  if (category === "CHURCH_ATTENDANCE") {
    type = "CHURCH"
  } else if (category === "SERVICE_ATTENDANCE") {
    type = "SERVICE"
  } else {
    return { status: "error", message: "نقطة التسجيل ليست من نوع حضور" }
  }

  // Reconstruct the instant from sessionDate + rule's start_time
  const timeStr = (rule.start_time as string) || "07:00"
  const now = cairoLocalToInstant(sessionDate, timeStr)

  return executeCheckIn(admin, {
    actorId,
    actorRole,
    person,
    type,
    source: "MANUAL",
    now,
    sessionDate,
  })
}

/**
 * A servant may undo an attendance record THEY created for a child. A super
 * admin may undo any record (full access). The linked auto-derived score row
 * is removed by cascade, so weekly/monthly totals recompute from the
 * remaining attendance-engine rows.
 */
export async function removeServantChildAttendance(
  admin: SupabaseAdminClient,
  params: { actorId: string; actorRole?: string; recordId: string }
): Promise<{ ok: boolean; message: string }> {
  const { actorId, actorRole, recordId } = params

  const { data: row } = await admin
    .from("attendance_records")
    .select("id, recorded_by, profile_id")
    .eq("id", recordId)
    .maybeSingle()

  if (!row) return { ok: false, message: "سجل الحضور غير موجود" }
  if (row.recorded_by !== actorId && actorRole !== ROLES.SUPER_ADMIN) {
    return { ok: false, message: "لا يمكن حذف تسجيلة سجلها شخص آخر" }
  }

  const { data: targetProfile } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", row.profile_id ?? "")
    .maybeSingle()

  if (!targetProfile || targetProfile.role !== ROLES.SERVED_MEMBER) {
    return { ok: false, message: "السجلات تُكتب للمخدومين فقط" }
  }

  const { error } = await admin.from("attendance_records").delete().eq("id", recordId)
  if (error) return { ok: false, message: "تعذر حذف سجل الحضور" }

  await logAudit(admin, {
    actorId,
    action: "ATTENDANCE_REMOVED",
    entity: "ATTENDANCE",
    entityId: recordId,
    metadata: {
      profile_id: targetProfile.id,
      removed_by_servant: true,
    },
  })

  return { ok: true, message: "تم حذف تسجيل الحضور" }
}

/**
 * Records a servant's attendance with a single tap — no type selection, no
 * time-band scoring. Uses CHURCH as the default internal type and records
 * the current instant. Points are always 0 for servants.
 *
 * `subjectId` defaults to `actorId` (self check-in) but lets a SUPER_ADMIN
 * record the attendance of any active servant on their behalf. The actor is
 * still captured as `recorded_by`.
 */
export async function recordServantAttendance(
  admin: SupabaseAdminClient,
  params: { actorId: string; subjectId?: string }
): Promise<CheckInOutcome> {
  const { actorId } = params
  const subjectId = params.subjectId ?? actorId
  const now = getServerNow()
  const cairoDate = cairoDateString(now)

  const person = await resolvePersonByProfileId(admin, subjectId)
  if (!person) return { status: "error", message: "الشخص غير موجود" }
  if (person.role !== ROLES.SERVANT) {
    return { status: "error", message: "هذه العملية للخدام فقط" }
  }
  if (person.status !== "ACTIVE") {
    return { status: "error", message: "هذا الحساب غير نشط" }
  }
  if (!isCairoFriday(cairoDate)) {
    return { status: "error", message: "الحضور يُسجَّل يوم الجمعة فقط" }
  }

  const sessionId = await ensureAttendanceSession(admin, "CHURCH", cairoDate, actorId)

  const { data: existing } = await admin
    .from("attendance_records")
    .select("id, attended_at, points")
    .eq("profile_id", subjectId)
    .eq("session_id", sessionId)
    .neq("status", "ARCHIVED")
    .maybeSingle()

  if (existing) {
    return {
      status: "duplicate",
      person: personToOutcome(person),
      attendedAt: existing.attended_at,
      type: "CHURCH",
      points: Number(existing.points),
    }
  }

  const { data: rpcData, error: rpcError } = await admin.rpc(
    "record_attendance_with_score",
    {
      p_session_id: sessionId,
      p_profile_id: subjectId,
      p_attended_at: now.toISOString(),
      p_points: 0,
      p_recorded_by: actorId,
      p_source: "MANUAL",
      p_score_category: null,
      p_score_rule_id: null,
      p_session_date: cairoDate,
    }
  )

  if (rpcError) {
    return { status: "error", message: "تعذر تسجيل الحضور" }
  }

  const result = rpcData as unknown as {
    status: string
    id: string
    attended_at: string
    points: number | string
  }

  if (result.status === "duplicate") {
    return {
      status: "duplicate",
      person: personToOutcome(person),
      attendedAt: result.attended_at,
      type: "CHURCH",
      points: Number(result.points),
    }
  }

  await logAudit(admin, {
    actorId,
    action: "ATTENDANCE_MANUAL",
    entity: "ATTENDANCE",
    entityId: result.id,
    metadata: {
      profile_id: subjectId,
      subject_role: "SERVANT",
      attended_at: now.toISOString(),
      type: "CHURCH",
      source: "MANUAL",
      points: 0,
      session_id: sessionId,
      outcome: "success",
    },
  })

  return {
    status: "success",
    person: personToOutcome(person),
    attendedAt: now.toISOString(),
    cairoTime: cairoTimeString(now),
    type: "CHURCH",
    source: "MANUAL",
    points: 0,
  }
}

/**
 * Super Admin class-desk cleanup: voids (removes) any attendance record —
 * including a servant's — so a wrong entry can be dropped then re-recorded
 * from the desk. The record is hard-deleted like the servant child path;
 * the linked score cascade for members applies automatically.
 */
export async function removeDeskAttendanceRecord(
  admin: SupabaseAdminClient,
  params: { actorId: string; actorRole: string; recordId: string }
): Promise<{ ok: boolean; message: string }> {
  const { actorId, actorRole, recordId } = params
  if (actorRole !== ROLES.SUPER_ADMIN) {
    return { ok: false, message: "غير مصرح" }
  }

  const { data: row } = await admin
    .from("attendance_records")
    .select("id, profile_id")
    .eq("id", recordId)
    .maybeSingle()
  if (!row) return { ok: false, message: "سجل الحضور غير موجود" }

  const { error } = await admin.from("attendance_records").delete().eq("id", recordId)
  if (error) return { ok: false, message: "تعذر حذف سجل الحضور" }

  await logAudit(admin, {
    actorId,
    action: "ATTENDANCE_REMOVED",
    entity: "ATTENDANCE",
    entityId: recordId,
    metadata: {
      profile_id: row.profile_id,
      removed_by: "DESK",
      actor_role: actorRole,
    },
  })

  return { ok: true, message: "تم حذف تسجيل الحضور" }
}