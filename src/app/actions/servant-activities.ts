"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ROLES } from "@/lib/roles"
import { logAudit } from "@/services/auth-service"
import { cairoDateString } from "@/lib/cairo"
import { getServerNow } from "@/services/attendance-service"
import { isUuid } from "@/lib/validation"
import { getServantDayData, type ServantDayData } from "@/services/servant-day-service"

export type ServantActivityResult = {
  ok: boolean
  already?: boolean
  message: string
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** True for a real "YYYY-MM-DD" calendar date (rejects e.g. 2026-02-30). */
function isRealDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const [y, m, d] = value.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** Servant and super-admin (acting on a servant's behalf) may use this desk. */
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

/**
 * Resolves whom the record is being written for. A servant can only ever act
 * on themselves; a super admin may pass any active servant's id.
 */
async function resolveSubjectServant(
  admin: ReturnType<typeof createAdminClient>,
  actor: { actorId: string; role: string },
  servantId: string | undefined
): Promise<string | null> {
  if (actor.role === ROLES.SERVANT) {
    return servantId && servantId !== actor.actorId ? null : actor.actorId
  }

  const target = servantId ?? actor.actorId
  if (!isUuid(target)) return null
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, status")
    .eq("id", target)
    .maybeSingle()
  if (!profile || profile.role !== ROLES.SERVANT || profile.status !== "ACTIVE") return null
  return target
}

/**
 * Servant records their own participation in an active SERVANT activity — or,
 * for a super admin, the participation of any active servant. The date is the
 * Cairo calendar date of the activity (today by default), never a future date.
 * Duplicate submissions are idempotent.
 */
export async function recordServantActivityAction(
  activityId: string,
  date: string,
  servantId?: string
): Promise<ServantActivityResult> {
  const actor = await requireServantActor()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (actor.role !== ROLES.SUPER_ADMIN) {
    return { ok: false, message: "أنشطة الخدام تُسجَّل من مسؤول الخدمة فقط" }
  }
  if (!isUuid(activityId)) {
    return { ok: false, message: "نشاط غير صحيح" }
  }
  if (typeof date !== "string" || !isRealDateString(date)) {
    return { ok: false, message: "التاريخ غير صحيح" }
  }

  const cairoToday = cairoDateString(getServerNow())
  if (date > cairoToday) {
    return { ok: false, message: "لا يمكن تسجيل نشاط في تاريخ مستقبلي" }
  }

  const admin = createAdminClient()

  const subjectId = await resolveSubjectServant(admin, actor, servantId)
  if (!subjectId) return { ok: false, message: "غير مصرح" }

  const { data: activity } = await admin
    .from("activities")
    .select("id, is_active, for_role")
    .eq("id", activityId)
    .maybeSingle()
  if (!activity || activity.is_active !== true || activity.for_role !== ROLES.SERVANT) {
    return { ok: false, message: "هذا النشاط غير متاح" }
  }

  const { data: existing } = await admin
    .from("servant_activity_records")
    .select("id")
    .eq("servant_id", subjectId)
    .eq("activity_id", activityId)
    .eq("recorded_on", date)
    .maybeSingle()
  if (existing) return { ok: true, already: true, message: "مسجل بالفعل" }

  const { data: inserted, error } = await admin
    .from("servant_activity_records")
    .insert({
      servant_id: subjectId,
      activity_id: activityId,
      recorded_on: date,
      recorded_by: actor.actorId,
    })
    .select("id")
    .single()

  if (error) {
    // Unique (servant_id, activity_id, recorded_on) — concurrent duplicate.
    if (error.code === "23505") return { ok: true, already: true, message: "مسجل بالفعل" }
    return { ok: false, message: "تعذر التسجيل، حاول مرة أخرى" }
  }

  await logAudit(admin, {
    actorId: actor.actorId,
    action: "SERVANT_ACTIVITY_RECORDED",
    entity: "SERVANT_ACTIVITY",
    entityId: inserted.id,
    metadata: { activity_id: activityId, recorded_on: date },
  })

  return { ok: true, message: "تم تسجيل المشاركة ✓" }
}

/**
 * Servant removes their own (today-only) activity record — a super admin may
 * remove the equivalent record on behalf of any active servant. Past
 * recordings are immutable: the same rule is enforced by the RLS delete
 * policy, and this server action re-enforces it for the admin-client path.
 */
export async function removeServantActivityAction(
  activityId: string,
  date: string,
  servantId?: string
): Promise<ServantActivityResult> {
  const actor = await requireServantActor()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (actor.role !== ROLES.SUPER_ADMIN) {
    return { ok: false, message: "أنشطة الخدام تُسجَّل من مسؤول الخدمة فقط" }
  }
  if (!isUuid(activityId)) {
    return { ok: false, message: "نشاط غير صحيح" }
  }
  if (typeof date !== "string" || !isRealDateString(date)) {
    return { ok: false, message: "التاريخ غير صحيح" }
  }

  const cairoToday = cairoDateString(getServerNow())
  if (date !== cairoToday) {
    return { ok: false, message: "يمكن إلغاء تسجيل نشاط اليوم فقط" }
  }

  const admin = createAdminClient()

  const subjectId = await resolveSubjectServant(admin, actor, servantId)
  if (!subjectId) return { ok: false, message: "غير مصرح" }

  const { data: existing } = await admin
    .from("servant_activity_records")
    .select("id")
    .eq("servant_id", subjectId)
    .eq("activity_id", activityId)
    .eq("recorded_on", date)
    .maybeSingle()
  if (!existing) return { ok: false, message: "لا يوجد تسجيل لإلغائه" }

  const { error } = await admin.from("servant_activity_records").delete().eq("id", existing.id)
  if (error) return { ok: false, message: "تعذر الإلغاء، حاول مرة أخرى" }

  await logAudit(admin, {
    actorId: actor.actorId,
    action: "SERVANT_ACTIVITY_REMOVED",
    entity: "SERVANT_ACTIVITY",
    entityId: existing.id,
    metadata: { activity_id: activityId, recorded_on: date, servant_id: subjectId },
  })

  return { ok: true, message: "تم إلغاء التسجيل" }
}

const SELF_HISTORY_DAYS = 14

export type ServantDayActionResult =
  | { ok: true; data: ServantDayData }
  | { ok: false; message: string }

/**
 * One servant's "day desk" (today's attendance + recent attendance + active
 * SERVANT activities + participation history). A servant may load only their
 * own desk; a super admin may load any active servant's desk on their behalf.
 */
export async function getServantDayDataAction(servantId?: string): Promise<ServantDayActionResult> {
  const actor = await requireServantActor()
  if (!actor) return { ok: false, message: "غير مصرح" }

  const admin = createAdminClient()
  const subjectId = await resolveSubjectServant(admin, actor, servantId)
  if (!subjectId) return { ok: false, message: "غير مصرح" }

  const now = getServerNow()
  const cairoToday = cairoDateString(now)
  const historySince = cairoDateString(new Date(now.getTime() - SELF_HISTORY_DAYS * 86_400_000))
  const data = await getServantDayData(admin, subjectId, cairoToday, historySince)
  return { ok: true, data }
}