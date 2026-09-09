/**
 * Phase 5C — scoring-rules settings (Super Admin only).
 *
 * The `scoring_rules` table is application configuration, so all writes go
 * through the service-role client AFTER the server action has verified the
 * actor is a SUPER_ADMIN (mirroring the `scoring_rules_write_super` policy).
 * Every change is audited with previous + next values.
 *
 * No new migration is needed: the columns the UI edits already exist and the
 * write policy already restricts them to SUPER_ADMIN.
 */
import type { SupabaseAdminClient } from "../lib/supabase/admin"
import type { AppRole } from "../lib/roles"
import { PUBLIC_REGISTRATION_ROLES } from "../lib/roles"
import { SCORING_CATEGORY_LABELS, type ScoringCategory } from "../lib/constants"
import type { ScoringRule } from "../lib/types"
import { logAudit } from "./auth-service"

export const SCORING_RULE_ENTITY = "SCORING_RULE"
export const SCORING_RULE_CREATED = "SCORING_RULE_CREATED"
export const SCORING_RULE_UPDATED = "SCORING_RULE_UPDATED"
export const SCORING_RULE_ARCHIVED = "SCORING_RULE_ARCHIVED"

export const SCORING_RULE_MAX_NAME = 80
export const SCORING_RULE_MAX_POINTS = 9999
export const SCORING_RULE_MAX_MIN_DAYS = 366

const RULE_ROLES = PUBLIC_REGISTRATION_ROLES
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export type ScoringRuleInput = {
  category: ScoringCategory
  name: string
  point_value: number
  applicable_role: AppRole[]
  start_time: string | null
  end_time: string | null
  requires_min_days: number | null
}

export type RuleValidation =
  | { ok: true; value: ScoringRuleInput }
  | { ok: false; message: string }

/** Validates + normalizes the editable fields of a scoring rule. */
export function validateScoringRule(raw: unknown): RuleValidation {
  const r = (raw ?? {}) as Record<string, unknown>

  const category = r.category as ScoringCategory
  if (!category || !(category in SCORING_CATEGORY_LABELS)) {
    return { ok: false, message: "فئة القاعدة غير صحيحة" }
  }

  const name = String(r.name ?? "").replace(/\s+/g, " ").trim()
  if (!name) return { ok: false, message: "مطلوب اسم القاعدة" }
  if (name.length > SCORING_RULE_MAX_NAME) {
    return { ok: false, message: "اسم القاعدة أطول من المسموح به" }
  }

  const point_value = Number(r.point_value)
  if (!Number.isFinite(point_value) || point_value < 0 || point_value > SCORING_RULE_MAX_POINTS) {
    return { ok: false, message: "قيمة القاعدة غير صحيحة" }
  }

  const rawRoles = Array.isArray(r.applicable_role) ? r.applicable_role : []
  const applicable_role = rawRoles.filter((role): role is AppRole =>
    RULE_ROLES.includes(role as AppRole)
  )
  if (applicable_role.length === 0) {
    return { ok: false, message: "اختار دور واحد على الأقل" }
  }
  if (applicable_role.length !== rawRoles.length) {
    return { ok: false, message: "دور غير مسموح به" }
  }

  const toTime = (value: unknown): string | null => {
    if (value === null || value === undefined || value === "") return null
    const s = String(value).trim()
    if (!TIME_RE.test(s)) throw new Error("صيغة التوقيت غير صحيحة (HH:MM)")
    return s
  }
  let start_time: string | null = null
  let end_time: string | null = null
  try {
    start_time = toTime(r.start_time)
    end_time = toTime(r.end_time)
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }

  let requires_min_days: number | null = null
  if (
    r.requires_min_days !== null &&
    r.requires_min_days !== undefined &&
    r.requires_min_days !== ""
  ) {
    const days = Number(r.requires_min_days)
    if (!Number.isInteger(days) || days < 1 || days > SCORING_RULE_MAX_MIN_DAYS) {
      return { ok: false, message: "الحد الأدنى للأيام غير صحيح" }
    }
    requires_min_days = days
  }

  return {
    ok: true,
    value: {
      category,
      name,
      point_value: Math.round(point_value * 100) / 100,
      applicable_role,
      start_time,
      end_time,
      requires_min_days,
    },
  }
}

function ruleEditableFields(rule: ScoringRule): ScoringRuleInput {
  return {
    category: rule.category,
    name: rule.name,
    point_value: Number(rule.point_value),
    applicable_role: [...rule.applicable_role],
    start_time: rule.start_time,
    end_time: rule.end_time,
    requires_min_days: rule.requires_min_days,
  }
}

/** Full rule list (active + archived) ordered for the settings screen. */
export async function listScoringRulesForSettings(
  admin: SupabaseAdminClient
): Promise<ScoringRule[]> {
  const { data } = await admin
    .from("scoring_rules")
    .select("*")
    .order("sort_order", { ascending: true })
  return (data ?? []) as ScoringRule[]
}

export type RuleMutationResult = { ok: boolean; message: string }

export async function createScoringRule(
  admin: SupabaseAdminClient,
  params: { actorId: string; rule: ScoringRuleInput }
): Promise<RuleMutationResult> {
  const { actorId, rule } = params

  const { data: max } = await admin
    .from("scoring_rules")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
  const nextOrder = Number((max?.[0]?.sort_order as number | undefined) ?? 0) + 10

  const { error } = await admin.from("scoring_rules").insert({
    ...rule,
    sort_order: nextOrder,
  })
  if (error) return { ok: false, message: "تعذر إضافة القاعدة" }

  await logAudit(admin, {
    actorId,
    action: SCORING_RULE_CREATED,
    entity: SCORING_RULE_ENTITY,
    next: { ...rule },
  })
  return { ok: true, message: "تمت إضافة القاعدة ✓" }
}

export async function updateScoringRule(
  admin: SupabaseAdminClient,
  params: { actorId: string; ruleId: string; rule: ScoringRuleInput }
): Promise<RuleMutationResult> {
  const { actorId, ruleId, rule } = params

  const { data: current, error: readError } = await admin
    .from("scoring_rules")
    .select("*")
    .eq("id", ruleId)
    .maybeSingle()
  if (readError || !current) return { ok: false, message: "القاعدة غير موجودة" }

  const { error } = await admin
    .from("scoring_rules")
    .update({
      category: rule.category,
      name: rule.name,
      point_value: rule.point_value,
      applicable_role: rule.applicable_role,
      start_time: rule.start_time,
      end_time: rule.end_time,
      requires_min_days: rule.requires_min_days,
    })
    .eq("id", ruleId)
  if (error) return { ok: false, message: "تعذر تحديث القاعدة" }

  await logAudit(admin, {
    actorId,
    action: SCORING_RULE_UPDATED,
    entity: SCORING_RULE_ENTITY,
    entityId: ruleId,
    previous: ruleEditableFields(current as ScoringRule),
    next: { ...rule },
  })
  return { ok: true, message: "تم تحديث القاعدة ✓" }
}

async function setRuleActive(
  admin: SupabaseAdminClient,
  params: {
    actorId: string
    ruleId: string
    active: boolean
    action: string
    successMessage: string
  }
): Promise<RuleMutationResult> {
  const { actorId, ruleId, active, action, successMessage } = params

  const { data: current, error: readError } = await admin
    .from("scoring_rules")
    .select("*")
    .eq("id", ruleId)
    .maybeSingle()
  if (readError || !current) return { ok: false, message: "القاعدة غير موجودة" }

  const { error } = await admin
    .from("scoring_rules")
    .update({ is_active: active })
    .eq("id", ruleId)
  if (error) return { ok: false, message: "تعذر تحديث القاعدة" }

  await logAudit(admin, {
    actorId,
    action,
    entity: SCORING_RULE_ENTITY,
    entityId: ruleId,
    previous: { is_active: current.is_active },
    next: { is_active: active },
  })
  return { ok: true, message: successMessage }
}

/** Archive = soft-delete (is_active = false); the rule stays in history. */
export async function archiveScoringRule(
  admin: SupabaseAdminClient,
  params: { actorId: string; ruleId: string }
): Promise<RuleMutationResult> {
  return setRuleActive(admin, {
    ...params,
    active: false,
    action: SCORING_RULE_ARCHIVED,
    successMessage: "تمت أرشفة القاعدة",
  })
}

/** Restores an archived rule back into the active scoring set. */
export async function restoreScoringRule(
  admin: SupabaseAdminClient,
  params: { actorId: string; ruleId: string }
): Promise<RuleMutationResult> {
  return setRuleActive(admin, {
    ...params,
    active: true,
    action: SCORING_RULE_UPDATED,
    successMessage: "تمت استعادة القاعدة ✓",
  })
}
