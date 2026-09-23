/**
 * Super Admin class desk.
 *
 * One Cairo day, one class: every ACTIVE servant of the class with their day
 * desk (today's attendance + SERVANT activities + history) and every ACTIVE
 * served member of the class already covered by the shared scoring board.
 *
 * All reads run over the service-role client; the caller (server page / action)
 * owns the SUPER_ADMIN gate.
 */
import type { SupabaseAdminClient } from "../lib/supabase/admin"
import { ROLES } from "../lib/roles"
import { cairoDateString } from "../lib/cairo"
import { getServantDayData, type ServantDayData } from "./servant-day-service"
import {
  getScoringBoardData,
  upsertMemberActivityScore,
  type ScoringBoardData,
} from "./member-scoring-service"
import {
  getServerNow,
  recordChildAttendance,
  recordServantAttendance,
  removeDeskAttendanceRecord,
} from "./attendance-service"
import { logAudit } from "./auth-service"

export type DeskServant = {
  profileId: string
  fullName: string
  day: ServantDayData
}

export type ClassDeskData = {
  classId: string
  className: string
  servants: DeskServant[]
  board: ScoringBoardData
}

/** Active servants of a class, ordered by name. */
async function listClassServants(
  admin: SupabaseAdminClient,
  classId: string
): Promise<{ id: string; full_name: string }[]> {
  // The embedded `servants!inner(id)` select is required for the
  // `servants.class_id` filter to be applied — PostgREST can only filter on a
  // to-one relation that is present in the select list.
  const { data } = await admin
    .from("profiles")
    .select("id, full_name, servants!inner(id)")
    .eq("role", ROLES.SERVANT)
    .eq("status", "ACTIVE")
    .eq("servants.class_id", classId)
    .order("full_name", { ascending: true })
  return (data ?? []) as unknown as { id: string; full_name: string }[]
}

export type ConnectableServant = {
  profileId: string
  fullName: string
  currentClassId: string | null
  currentClassName: string | null
}

/**
 * Active servants that can be assigned to a class — every servant NOT already
 * connected to that class. Each row carries the servant's current class (null
 * = unassigned) so the caller can show what the assignment would change.
 */
export async function listConnectableServants(
  admin: SupabaseAdminClient,
  classId: string
): Promise<ConnectableServant[]> {
  const { data } = await admin
    .from("profiles")
    .select("id, full_name, servants!inner(id, class_id, classes(name))")
    .eq("role", ROLES.SERVANT)
    .eq("status", "ACTIVE")

  const rows = (data ?? []) as unknown as Array<{
    id: string
    full_name: string
    servants:
      | { id: string; class_id: string | null; classes: { name: string } | null }
      | { id: string; class_id: string | null; classes: { name: string } | null }[]
      | null
  }>

  const out: ConnectableServant[] = []
  for (const row of rows) {
    const detail = Array.isArray(row.servants) ? row.servants[0] : row.servants
    if (!detail) continue
    if (detail.class_id === classId) continue
    out.push({
      profileId: row.id,
      fullName: row.full_name,
      currentClassId: detail.class_id,
      currentClassName: detail.classes?.name ?? null,
    })
  }

  out.sort((a, b) => a.fullName.localeCompare(b.fullName, "ar"))
  return out
}

export async function getClassDeskData(
  admin: SupabaseAdminClient,
  classId: string,
  date: string,
  historySince: string
): Promise<ClassDeskData> {
  const { data: cls } = await admin
    .from("classes")
    .select("id, name")
    .eq("id", classId)
    .maybeSingle()

  const [servantProfiles, board] = await Promise.all([
    listClassServants(admin, classId),
    getScoringBoardData(admin, date, classId),
  ])

  const servants: DeskServant[] = await Promise.all(
    servantProfiles.map(async (p) => ({
      profileId: p.id,
      fullName: p.full_name,
      day: await getServantDayData(admin, p.id, date, historySince),
    }))
  )

  return {
    classId,
    className: (cls?.name as string | undefined) ?? "صف",
    servants,
    board,
  }
}

// --- Batch save -------------------------------------------------------------

export type DeskSaveServantAttendance = { profileId: string; present: boolean }
export type DeskSaveMemberAttendance = {
  memberId: string
  type: "CHURCH" | "SERVICE"
  present: boolean
}
export type DeskSaveServantActivity = {
  servantId: string
  date: string
  activityId: string
  recorded: boolean
}
export type DeskSaveMemberScore = { memberId: string; activityId: string; points: number }

export type DeskSaveInput = {
  classId: string
  date: string
  servantAttendance: DeskSaveServantAttendance[]
  servantActivities: DeskSaveServantActivity[]
  memberAttendance: DeskSaveMemberAttendance[]
  memberScores: DeskSaveMemberScore[]
}

export type DeskSaveSummary = {
  ok: boolean
  message: string
  /** How many per group were applied successfully. */
  servantAttendance: number
  servantActivities: number
  memberAttendance: number
  memberScores: number
  /** How many individual writes were rejected/errored. */
  failed: number
}

/**
 * One today's attendance record id for a profile, optionally for one type.
 * Used to remove an entry from the desk (a record is identified by its
 * session date + session type, not by a stable client id).
 */
async function findDeskAttendanceId(
  admin: SupabaseAdminClient,
  profileId: string,
  date: string,
  type?: "CHURCH" | "SERVICE"
): Promise<string | null> {
  let q = admin
    .from("attendance_records")
    .select("id, session:attendance_sessions!inner(type)")
    .eq("profile_id", profileId)
    .neq("status", "ARCHIVED")
    .eq("session.session_date", date)
  if (type) q = q.eq("session.type", type)
  q = q.order("attended_at", { ascending: false }).limit(10)
  const { data } = await q
  const row = (data ?? [])[0] as
    | { id: string; session: { type?: string | null } | { type?: string | null }[] | null }
    | undefined
  if (!row) return null
  if (!type) return row.id as string
  const t = Array.isArray(row.session) ? row.session[0]?.type : row.session?.type
  return t === type ? (row.id as string) : null
}

/** Idempotently record a servant's participation in an active SERVANT activity. */
async function recordDeskServantActivity(
  admin: SupabaseAdminClient,
  actorId: string,
  it: DeskSaveServantActivity
): Promise<{ ok: boolean }> {
  const { data: activity } = await admin
    .from("activities")
    .select("id")
    .eq("id", it.activityId)
    .eq("is_active", true)
    .eq("for_role", ROLES.SERVANT)
    .maybeSingle()
  if (!activity) return { ok: false }

  const { data: existing } = await admin
    .from("servant_activity_records")
    .select("id")
    .eq("servant_id", it.servantId)
    .eq("activity_id", it.activityId)
    .eq("recorded_on", it.date)
    .maybeSingle()
  if (existing) return { ok: true }

  const { data: inserted, error } = await admin
    .from("servant_activity_records")
    .insert({
      servant_id: it.servantId,
      activity_id: it.activityId,
      recorded_on: it.date,
      recorded_by: actorId,
    })
    .select("id")
    .single()
  if (error) {
    if (error.code === "23505") return { ok: true }
    return { ok: false }
  }

  await logAudit(admin, {
    actorId,
    action: "SERVANT_ACTIVITY_RECORDED",
    entity: "SERVANT_ACTIVITY",
    entityId: inserted.id,
    metadata: { activity_id: it.activityId, recorded_on: it.date, servant_id: it.servantId },
  })
  return { ok: true }
}

/** Remove today's servant activity record (past records are immutable). */
async function removeDeskServantActivity(
  admin: SupabaseAdminClient,
  actorId: string,
  it: DeskSaveServantActivity
): Promise<{ ok: boolean }> {
  const cairoToday = cairoDateString(getServerNow())
  if (it.date !== cairoToday) return { ok: false }

  const { data: existing } = await admin
    .from("servant_activity_records")
    .select("id")
    .eq("servant_id", it.servantId)
    .eq("activity_id", it.activityId)
    .eq("recorded_on", it.date)
    .maybeSingle()
  if (!existing) return { ok: true }

  const { error } = await admin.from("servant_activity_records").delete().eq("id", existing.id)
  if (error) return { ok: false }

  await logAudit(admin, {
    actorId,
    action: "SERVANT_ACTIVITY_REMOVED",
    entity: "SERVANT_ACTIVITY",
    entityId: existing.id,
    metadata: { activity_id: it.activityId, recorded_on: it.date, servant_id: it.servantId },
  })
  return { ok: true }
}

/**
 * Applies a whole class desk draft in one pass: servant attendance,
 * servant activities, served-member attendance and served-member activity
 * scores — each write reuses the validated service/engine paths and is
 * audited. Individual failures never roll back the rest; the summary counts
 * them so the caller can report partial saves.
 */
export async function applyDeskSave(
  admin: SupabaseAdminClient,
  actorId: string,
  input: DeskSaveInput
): Promise<DeskSaveSummary> {
  let failed = 0
  let servantAttendance = 0
  let servantActivities = 0
  let memberAttendance = 0
  let memberScores = 0

  for (const it of input.servantAttendance) {
    if (it.present) {
      const outcome = await recordServantAttendance(admin, { actorId, subjectId: it.profileId })
      if (outcome.status === "error") failed += 1
      else servantAttendance += 1
    } else {
      const id = await findDeskAttendanceId(admin, it.profileId, input.date)
      if (!id) continue
      const res = await removeDeskAttendanceRecord(admin, {
        actorId,
        actorRole: ROLES.SUPER_ADMIN,
        recordId: id,
      })
      if (res.ok) servantAttendance += 1
      else failed += 1
    }
  }

  for (const it of input.memberAttendance) {
    if (it.present) {
      const outcome = await recordChildAttendance(admin, {
        actorId,
        actorRole: ROLES.SUPER_ADMIN,
        memberId: it.memberId,
        type: it.type,
        date: input.date,
      })
      if (outcome.status === "error") failed += 1
      else memberAttendance += 1
    } else {
      const id = await findDeskAttendanceId(admin, it.memberId, input.date, it.type)
      if (!id) continue
      const res = await removeDeskAttendanceRecord(admin, {
        actorId,
        actorRole: ROLES.SUPER_ADMIN,
        recordId: id,
      })
      if (res.ok) memberAttendance += 1
      else failed += 1
    }
  }

  for (const it of input.servantActivities) {
    const res = it.recorded
      ? await recordDeskServantActivity(admin, actorId, it)
      : await removeDeskServantActivity(admin, actorId, it)
    if (res.ok) servantActivities += 1
    else failed += 1
  }

  for (const it of input.memberScores) {
    const res = await upsertMemberActivityScore(admin, {
      actorId,
      memberId: it.memberId,
      activityId: it.activityId,
      date: input.date,
      points: it.points,
    })
    if (res.ok) memberScores += 1
    else failed += 1
  }

  const total = servantAttendance + servantActivities + memberAttendance + memberScores
  const message =
    failed === 0
      ? `تم حفظ التعديلات ✓ (${total})`
      : total > 0
        ? `تم حفظ ${total} تعديل — فشل ${failed}`
        : "ملف الحفظ فارغ"

  return {
    ok: failed === 0,
    message,
    servantAttendance,
    servantActivities,
    memberAttendance,
    memberScores,
    failed,
  }
}