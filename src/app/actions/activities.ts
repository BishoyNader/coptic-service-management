"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ROLES } from "@/lib/roles"
import {
  archiveActivity,
  createActivity,
  restoreActivity,
  updateActivity,
  validateActivity,
  type ActivityMutationResult,
} from "@/services/activities-admin-service"

/**
 * Activity management is SUPER_ADMIN only. The actor is verified from the
 * session inside every action, then the mutation runs through the service-role
 * client with full audit logging — mirroring the scoring-rules settings flow.
 */
async function requireSuperAdmin(): Promise<{ actorId: string } | null> {
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
  return { actorId: user.id }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-fA-F-]{36}$/.test(value)
}

export async function createActivityAction(raw: unknown): Promise<ActivityMutationResult> {
  const actor = await requireSuperAdmin()
  if (!actor) return { ok: false, message: "غير مصرح" }

  const validation = validateActivity(raw)
  if (!validation.ok) return validation

  return createActivity(createAdminClient(), {
    actorId: actor.actorId,
    activity: validation.value,
  })
}

export async function updateActivityAction(
  activityId: unknown,
  raw: unknown
): Promise<ActivityMutationResult> {
  const actor = await requireSuperAdmin()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (!isUuid(activityId)) return { ok: false, message: "بيانات غير صحيحة" }

  const validation = validateActivity(raw)
  if (!validation.ok) return validation

  return updateActivity(createAdminClient(), {
    actorId: actor.actorId,
    activityId,
    activity: validation.value,
  })
}

/** Archive = soft-delete: the activity disappears from the active set. */
export async function archiveActivityAction(
  activityId: unknown
): Promise<ActivityMutationResult> {
  const actor = await requireSuperAdmin()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (!isUuid(activityId)) return { ok: false, message: "بيانات غير صحيحة" }

  return archiveActivity(createAdminClient(), {
    actorId: actor.actorId,
    activityId,
  })
}

export async function restoreActivityAction(
  activityId: unknown
): Promise<ActivityMutationResult> {
  const actor = await requireSuperAdmin()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (!isUuid(activityId)) return { ok: false, message: "بيانات غير صحيحة" }

  return restoreActivity(createAdminClient(), {
    actorId: actor.actorId,
    activityId,
  })
}