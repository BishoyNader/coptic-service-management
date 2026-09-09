"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ROLES } from "@/lib/roles"
import {
  archiveScoringRule,
  createScoringRule,
  restoreScoringRule,
  updateScoringRule,
  validateScoringRule,
  type RuleMutationResult,
} from "@/services/settings-service"

/**
 * Settings are SUPER_ADMIN only here. The actor is verified from the session
 * inside every action, then the mutation runs through the service-role client
 * with full audit logging. Admin-level profile management already lives in its
 * own flow and is intentionally out of scope for this screen.
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

export async function createScoringRuleAction(raw: unknown): Promise<RuleMutationResult> {
  const actor = await requireSuperAdmin()
  if (!actor) return { ok: false, message: "غير مصرح" }

  const validation = validateScoringRule(raw)
  if (!validation.ok) return validation

  return createScoringRule(createAdminClient(), {
    actorId: actor.actorId,
    rule: validation.value,
  })
}

export async function updateScoringRuleAction(
  ruleId: unknown,
  raw: unknown
): Promise<RuleMutationResult> {
  const actor = await requireSuperAdmin()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (!isUuid(ruleId)) return { ok: false, message: "بيانات غير صحيحة" }

  const validation = validateScoringRule(raw)
  if (!validation.ok) return validation

  return updateScoringRule(createAdminClient(), {
    actorId: actor.actorId,
    ruleId,
    rule: validation.value,
  })
}

export async function archiveScoringRuleAction(ruleId: unknown): Promise<RuleMutationResult> {
  const actor = await requireSuperAdmin()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (!isUuid(ruleId)) return { ok: false, message: "بيانات غير صحيحة" }

  return archiveScoringRule(createAdminClient(), {
    actorId: actor.actorId,
    ruleId,
  })
}

export async function restoreScoringRuleAction(ruleId: unknown): Promise<RuleMutationResult> {
  const actor = await requireSuperAdmin()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (!isUuid(ruleId)) return { ok: false, message: "بيانات غير صحيحة" }

  return restoreScoringRule(createAdminClient(), {
    actorId: actor.actorId,
    ruleId,
  })
}
