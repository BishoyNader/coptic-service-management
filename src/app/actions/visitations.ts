"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ROLES, isStaffRole, type AppRole } from "@/lib/roles"
import { getServantClassId, memberInClass } from "@/services/member-scoring-service"
import { recordMemberVisit, type VisitRecordResult } from "@/services/visitation-service"

/**
 * Any staff profile (servant or super-admin) may record a visitation. The
 * actor's role is read from the session server-side; mutations run through the
 * service-role client exactly like the other staff actions.
 */
async function requireStaffActor(): Promise<{ actorId: string; role: AppRole } | null> {
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

  if (!profile || !isStaffRole(profile.role as AppRole | null)) return null
  return { actorId: user.id, role: profile.role as AppRole }
}

function isUuid(value: string): boolean {
  return /^[0-9a-fA-F-]{36}$/.test(value)
}

/**
 * Marks a served member as visited (الافتقاد) for today's Cairo date.
 *
 * A servant is limited to their assigned class (unassigned servants may visit
 * anyone, mirroring the legacy any-member scope). Idempotent per member-day.
 */
export async function markMemberVisitedAction(memberId: string): Promise<VisitRecordResult> {
  const actor = await requireStaffActor()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (!isUuid(memberId)) return { ok: false, message: "بيانات غير صحيحة" }

  const admin = createAdminClient()

  if (actor.role === ROLES.SERVANT) {
    const myClass = await getServantClassId(admin, actor.actorId)
    if (myClass && !(await memberInClass(admin, memberId, myClass))) {
      return { ok: false, message: "هذا المخدوم ليس ضمن صفّك" }
    }
  }

  return recordMemberVisit(admin, { actorId: actor.actorId, memberId })
}