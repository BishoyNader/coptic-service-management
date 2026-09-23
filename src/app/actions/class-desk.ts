"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ROLES } from "@/lib/roles"
import { isUuid } from "@/lib/validation"
import { getServerNow } from "@/services/attendance-service"
import { cairoDateString } from "@/lib/cairo"
import { logAudit } from "@/services/auth-service"
import {
  applyDeskSave,
  getClassDeskData,
  listConnectableServants,
  type ClassDeskData,
  type ConnectableServant,
  type DeskSaveInput,
  type DeskSaveSummary,
} from "@/services/class-desk-service"
import { removeDeskAttendanceRecord } from "@/services/attendance-service"

const SELF_HISTORY_DAYS = 14

async function requireSuperAdmin(): Promise<string | null> {
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

  if (!profile || profile.role !== ROLES.SUPER_ADMIN) return null
  return user.id
}

export type ClassDeskResult = { ok: true; data: ClassDeskData } | { ok: false; message: string }

/** Super Admin only: one class's desk for today (servants + served members). */
export async function getClassDeskAction(classId: string): Promise<ClassDeskResult> {
  const actorId = await requireSuperAdmin()
  if (!actorId) return { ok: false, message: "غير مصرح" }
  if (!isUuid(classId)) return { ok: false, message: "الصف غير صحيح" }

  const admin = createAdminClient()
  const now = getServerNow()
  const data = await getClassDeskData(
    admin,
    classId,
    cairoDateString(now),
    cairoDateString(new Date(now.getTime() - SELF_HISTORY_DAYS * 86_400_000))
  )
  return { ok: true, data }
}

export type DeskRemoveResult = { ok: boolean; message: string }

/** Super Admin only: drop an attendance record from the class desk. */
export async function removeDeskAttendanceAction(
  recordId: string
): Promise<DeskRemoveResult> {
  const actorId = await requireSuperAdmin()
  if (!actorId) return { ok: false, message: "غير مصرح" }
  if (!isUuid(recordId)) return { ok: false, message: "سجل غير صحيح" }

  return removeDeskAttendanceRecord(createAdminClient(), {
    actorId,
    actorRole: ROLES.SUPER_ADMIN,
    recordId,
  })
}

export type SetServantClassResult = { ok: boolean; field?: string; message: string }

/** Super Admin only: assign (or clear) a servant's class. */
export async function adminSetServantClassAction(
  servantId: string,
  classId: string | null
): Promise<SetServantClassResult> {
  const actorId = await requireSuperAdmin()
  if (!actorId) return { ok: false, message: "غير مصرح" }
  if (!isUuid(servantId)) return { ok: false, message: "الخادم غير صحيح" }
  if (classId !== null && !isUuid(classId)) return { ok: false, message: "الصف غير صحيح" }

  const admin = createAdminClient()

  const { data: target } = await admin
    .from("profiles")
    .select("id, role, full_name, status")
    .eq("id", servantId)
    .maybeSingle()
  if (!target || target.role !== ROLES.SERVANT) {
    return { ok: false, message: "الخادم غير موجود" }
  }

  if (classId) {
    const { data: cls } = await admin
      .from("classes")
      .select("id")
      .eq("id", classId)
      .eq("is_active", true)
      .maybeSingle()
    if (!cls) return { ok: false, message: "الصف غير موجود" }
  }

  const { error } = await admin
    .from("servants")
    .update({ class_id: classId })
    .eq("profile_id", servantId)
  if (error) return { ok: false, message: "تعذر تحديث صف الخادم" }

  await logAudit(admin, {
    actorId,
    action: "SERVANT_CLASS_UPDATED",
    entity: "PROFILE",
    entityId: servantId,
    metadata: { class_id: classId, servant_name: target.full_name },
  })

  return { ok: true, message: classId ? "تم تحديث صف الخادم ✓" : "تم إزالة الصف" }
}

export type ListConnectServantsResult =
  | { ok: true; data: ConnectableServant[] }
  | { ok: false; message: string }

/**
 * Super Admin only: active servants that can still be connected to a class
 * (servants without a class, or assigned to a different one).
 */
export async function listConnectServantsAction(
  classId: string
): Promise<ListConnectServantsResult> {
  const actorId = await requireSuperAdmin()
  if (!actorId) return { ok: false, message: "غير مصرح" }
  if (!isUuid(classId)) return { ok: false, message: "الصف غير صحيح" }

  const data = await listConnectableServants(createAdminClient(), classId)
  return { ok: true, data }
}

const MAX_BATCH_CONNECT = 200

export type ConnectServantsResult = { ok: boolean; message: string; connected?: number }

/**
 * Super Admin only: connect a batch of servants to one class in a single call.
 * Only active SERVANT profiles are accepted; the rest are ignored.
 */
export async function adminConnectServantsToClassAction(
  servantIds: string[],
  classId: string
): Promise<ConnectServantsResult> {
  const actorId = await requireSuperAdmin()
  if (!actorId) return { ok: false, message: "غير مصرح" }
  if (!isUuid(classId)) return { ok: false, message: "الصف غير صحيح" }
  const ids = [...new Set(servantIds.filter((v) => isUuid(v)))].slice(0, MAX_BATCH_CONNECT)
  if (ids.length === 0) return { ok: false, message: "اختر خادمًا واحدًا على الأقل" }

  const admin = createAdminClient()

  const { data: cls } = await admin
    .from("classes")
    .select("id, name")
    .eq("id", classId)
    .eq("is_active", true)
    .maybeSingle()
  if (!cls) return { ok: false, message: "الصف غير موجود" }

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name")
    .in("id", ids)
    .eq("role", ROLES.SERVANT)
    .eq("status", "ACTIVE")

  const valid = (profiles ?? []).map((p) => p.id as string)
  if (valid.length === 0) return { ok: false, message: "لا يوجد خدام صالحون للربط" }

  const { error } = await admin
    .from("servants")
    .update({ class_id: classId })
    .in("profile_id", valid)
  if (error) return { ok: false, message: "تعذر ربط الخدام بالصف" }

  await logAudit(admin, {
    actorId,
    action: "SERVANTS_CLASS_CONNECTED",
    entity: "CLASS",
    entityId: classId,
    metadata: {
      class_id: classId,
      class_name: cls.name,
      servant_ids: valid,
      servants: (profiles ?? []).map((p) => p.full_name as string).join("، "),
    },
  })

  return { ok: true, message: `تم ربط ${valid.length} خادم بالصف ✓`, connected: valid.length }
}

// --- Batch save -------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** True for a real "YYYY-MM-DD" calendar date (rejects e.g. 2026-02-30). */
function isRealDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const [y, m, d] = value.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

const MAX_SERVANT_ROWS = 400
const MAX_ACTIVITY_ROWS = 2000
const MAX_MEMBER_ROWS = 400
const MAX_SCORE_ROWS = 4000

export type SaveClassDeskResult = { ok: boolean; message: string; summary?: DeskSaveSummary }

/**
 * Super Admin only: persists a whole class-desk draft in one call — servant
 * attendance, servant activities, served-member attendance and served-member
 * scores. Every write is validated + audited, individual failures are counted,
 * and the caller re-fetches the desk afterwards so the page reflects the save
 * automatically.
 */
export async function saveClassDeskAction(input: DeskSaveInput): Promise<SaveClassDeskResult> {
  const actorId = await requireSuperAdmin()
  if (!actorId) return { ok: false, message: "غير مصرح" }
  if (!input || !isUuid(input.classId)) return { ok: false, message: "الصف غير صحيح" }
  if (typeof input.date !== "string" || !isRealDateString(input.date)) {
    return { ok: false, message: "التاريخ غير صحيح" }
  }
  if (input.date > cairoDateString(getServerNow())) {
    return { ok: false, message: "لا يمكن الحفظ في تاريخ مستقبلي" }
  }

  const servantAttendance = (Array.isArray(input.servantAttendance) ? input.servantAttendance : [])
    .filter((r) => r && isUuid(r.profileId) && typeof r.present === "boolean")
    .slice(0, MAX_SERVANT_ROWS)

  const servantActivities = (Array.isArray(input.servantActivities) ? input.servantActivities : [])
    .filter(
      (r) =>
        r &&
        isUuid(r.servantId) &&
        isUuid(r.activityId) &&
        isRealDateString(r.date) &&
        typeof r.recorded === "boolean"
    )
    .slice(0, MAX_ACTIVITY_ROWS)

  const memberAttendance = (Array.isArray(input.memberAttendance) ? input.memberAttendance : [])
    .filter(
      (r) =>
        r &&
        isUuid(r.memberId) &&
        (r.type === "CHURCH" || r.type === "SERVICE") &&
        typeof r.present === "boolean"
    )
    .slice(0, MAX_MEMBER_ROWS)

  const memberScores = (Array.isArray(input.memberScores) ? input.memberScores : [])
    .filter(
      (r) => r && isUuid(r.memberId) && isUuid(r.activityId) && Number.isFinite(r.points)
    )
    .slice(0, MAX_SCORE_ROWS)

  const summary = await applyDeskSave(createAdminClient(), actorId, {
    classId: input.classId,
    date: input.date,
    servantAttendance,
    servantActivities,
    memberAttendance,
    memberScores,
  })

  return { ok: summary.ok, message: summary.message, summary }
}