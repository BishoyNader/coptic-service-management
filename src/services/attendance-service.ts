import type { SupabaseAdminClient } from "@/lib/supabase/admin"
import type { AppRole } from "@/lib/roles"
import type {
  AttendanceSource,
  AttendanceStatus,
  AttendanceType,
  UserStatus,
} from "@/lib/types"
import { ATTENDANCE_TYPE_LABELS } from "@/lib/constants"
import { cairoDateString, cairoTimeString } from "@/lib/cairo"
import { logAudit } from "./auth-service"
import {
  attendanceCategory,
  resolveAttendanceBand,
  type AttendanceRuleResolution,
} from "./attendance-rules"

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
 */
async function executeCheckIn(
  admin: SupabaseAdminClient,
  params: {
    actorId: string
    person: AttendancePerson
    type: AttendanceType
    source: AttendanceSource
    now: Date
  }
): Promise<CheckInOutcome> {
  const { actorId, person, type, source, now } = params

  if (person.status !== "ACTIVE") {
    return { status: "error", message: "هذا الحساب غير نشط" }
  }
  if (person.role !== "SERVED_MEMBER" && person.role !== "SERVANT") {
    return { status: "error", message: "هذا النوع من الحسابات لا يسجّل حضورًا" }
  }

  const cairoDate = cairoDateString(now)
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

  const { data: rules } = await admin
    .from("scoring_rules")
    .select("*")
    .in("category", ["CHURCH_ATTENDANCE", "SERVICE_ATTENDANCE"])

  const resolution: AttendanceRuleResolution = resolveAttendanceBand(
    type,
    now,
    (rules ?? []) as Parameters<typeof resolveAttendanceBand>[2],
    person.role
  )
  const points = resolution.points

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
      p_score_category:
        points > 0 && person.role === "SERVED_MEMBER"
          ? attendanceCategory(type)
          : null,
      p_score_rule_id: resolution.rule?.id ?? null,
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
      type,
      points: Number(result.points),
    }
  }

  const auditAction = source === "MANUAL" ? "ATTENDANCE_MANUAL" : "ATTENDANCE_CHECKIN"
  await logAudit(admin, {
    actorId,
    action: auditAction,
    entity: "ATTENDANCE",
    entityId: result.id,
    metadata: { type, source, points, session_id: sessionId },
  })

  return {
    status: "success",
    person: personToOutcome(person),
    attendedAt: now.toISOString(),
    cairoTime: cairoTimeString(now),
    type,
    source,
    points,
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
    mode: "QR" | "CODE"
    identifier: string
    type: AttendanceType
  }
): Promise<CheckInOutcome> {
  const { actorId, mode, identifier, type } = params

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
    person,
    type,
    source: mode === "QR" ? "QR" : "CODE",
    now: getServerNow(),
  })
}

/** Admin/Super Admin manual attendance — the server still decides the time. */
export async function checkInByProfileId(
  admin: SupabaseAdminClient,
  params: { actorId: string; profileId: string; type: AttendanceType }
): Promise<CheckInOutcome> {
  const { actorId, profileId, type } = params
  const person = await resolvePersonByProfileId(admin, profileId)
  if (!person) return { status: "error", message: "الشخص غير موجود" }

  return executeCheckIn(admin, {
    actorId,
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

  const originalInstant = new Date(record.attended_at)
  const cairoDate = cairoDateString(originalInstant)
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

  // Attendance move + score resize/void persisted atomically in one DB
  // transaction (correct_attendance_type). The unique target-session check
  // done above is re-enforced inside the function for the concurrent case.
  const { data: corrRes, error: corrError } = await admin.rpc(
    "correct_attendance_type",
    {
      p_record_id: recordId,
      p_new_session_id: newSessionId,
      p_new_points: newPoints,
      p_score_category: newPoints > 0 ? attendanceCategory(newType) : null,
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