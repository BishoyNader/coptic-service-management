"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ROLES } from "@/lib/roles"
import { isUuid } from "@/lib/validation"
import { getServerNow } from "@/services/attendance-service"
import { cairoDateString } from "@/lib/cairo"
import { logAudit } from "@/services/auth-service"
import {
  getClassDeskData,
  type ClassDeskData,
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