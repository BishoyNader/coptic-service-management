/**
 * Super Admin — activity management.
 *
 * Activities are application configuration (name, target role, scoring
 * range) so all writes go through the service-role client AFTER the server
 * action has verified the actor is a SUPER_ADMIN. Every change is audited
 * with previous + next values.
 *
 * The `activities` table needs a machine `code` (unique, non-null). New
 * activities get an auto-generated code derived from the name; existing
 * seeded activities already have codes.
 */
import type { SupabaseAdminClient } from "../lib/supabase/admin"
import type { AppRole } from "../lib/roles"
import { PUBLIC_REGISTRATION_ROLES } from "../lib/roles"
import type { Activity } from "../lib/types"
import { logAudit } from "./auth-service"

export const ACTIVITY_ENTITY = "ACTIVITY"
export const ACTIVITY_CREATED = "ACTIVITY_CREATED"
export const ACTIVITY_UPDATED = "ACTIVITY_UPDATED"
export const ACTIVITY_ARCHIVED = "ACTIVITY_ARCHIVED"
export const ACTIVITY_RESTORED = "ACTIVITY_RESTORED"
export const ACTIVITY_DELETED = "ACTIVITY_DELETED"

export const ACTIVITY_MAX_NAME = 80
export const ACTIVITY_MAX_SCORE = 999
export const ACTIVITY_MAX_ORDER = 10_000

const ACTIVITY_ROLES = [...PUBLIC_REGISTRATION_ROLES] as readonly AppRole[]

export type ActivityInput = {
  name: string
  for_role: AppRole
  attendance_type: "CHURCH" | "SERVICE" | null
  input_type: "checkbox" | "score"
  min_score: number
  max_score: number
  icon: string | null
  sort_order: number
}

export type ActivityValidation =
  | { ok: true; value: ActivityInput }
  | { ok: false; message: string }

/** Validates + normalizes the editable fields of an activity. */
export function validateActivity(raw: unknown): ActivityValidation {
  const r = (raw ?? {}) as Record<string, unknown>

  const name = String(r.name ?? "").replace(/\s+/g, " ").trim()
  if (!name) return { ok: false, message: "مطلوب اسم النشاط" }
  if (name.length > ACTIVITY_MAX_NAME) {
    return { ok: false, message: "اسم النشاط أطول من المسموح به" }
  }

  const for_role = r.for_role as AppRole
  if (!for_role || !(ACTIVITY_ROLES as readonly string[]).includes(for_role)) {
    return { ok: false, message: "الدور غير صحيح" }
  }

  const min_score = Number(r.min_score)
  if (!Number.isFinite(min_score) || min_score < 0 || min_score > ACTIVITY_MAX_SCORE) {
    return { ok: false, message: "الحد الأدنى للدرجة غير صحيح" }
  }

  const max_score = Number(r.max_score)
  if (
    !Number.isFinite(max_score) ||
    max_score < 0 ||
    max_score > ACTIVITY_MAX_SCORE ||
    max_score < min_score
  ) {
    return { ok: false, message: "الحد الأقصى للدرجة غير صحيح" }
  }

  let icon: string | null = null
  if (r.icon !== null && r.icon !== undefined && String(r.icon).trim() !== "") {
    icon = String(r.icon).trim().slice(0, 40)
  }

  let sort_order = Number(r.sort_order)
  if (!Number.isInteger(sort_order) || sort_order < 0 || sort_order > ACTIVITY_MAX_ORDER) {
    sort_order = 0
  }

  let attendance_type: "CHURCH" | "SERVICE" | null = null
  if (r.attendance_type === "CHURCH" || r.attendance_type === "SERVICE") {
    attendance_type = r.attendance_type
  }

  let input_type: "checkbox" | "score" = "score"
  if (r.input_type === "checkbox") {
    input_type = "checkbox"
  }

  return {
    ok: true,
    value: {
      name,
      for_role,
      attendance_type,
      input_type,
      min_score: Math.round(min_score * 100) / 100,
      max_score: Math.round(max_score * 100) / 100,
      icon,
      sort_order,
    },
  }
}

function activityEditableFields(a: Activity): ActivityInput {
  return {
    name: a.name,
    for_role: a.for_role,
    attendance_type: a.attendance_type,
    input_type: a.input_type,
    min_score: Number(a.min_score),
    max_score: Number(a.max_score),
    icon: a.icon,
    sort_order: Number(a.sort_order),
  }
}

/** Turns a normalized arabic name into a stable machine code. */
function codeFromName(name: string): string {
  const latin = name
    .replace(/[\u0600-\u06FF]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 30)
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase()
  const base = latin || "ACTIVITY"
  return `${base}_${suffix}`
}

/** Full activity list (active + archived) ordered for the settings screen. */
export async function listActivitiesForSettings(
  admin: SupabaseAdminClient
): Promise<Activity[]> {
  const { data } = await admin
    .from("activities")
    .select("*")
    .order("sort_order", { ascending: true })
  return (data ?? []) as Activity[]
}

export type ActivityMutationResult = { ok: boolean; message: string }

export async function createActivity(
  admin: SupabaseAdminClient,
  params: { actorId: string; activity: ActivityInput }
): Promise<ActivityMutationResult> {
  const { actorId, activity } = params

  const { data: max } = await admin
    .from("activities")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
  const nextOrder = Number((max?.[0]?.sort_order as number | undefined) ?? 0) + 10

  let code = codeFromName(activity.name)
  // The unique `code` column can collide (e.g. the same name twice) — re-roll.
  for (let attempt = 0; attempt < 4; attempt++) {
    const { error } = await admin.from("activities").insert({
      ...activity,
      code,
      sort_order: nextOrder,
    })
    if (!error) {
      await logAudit(admin, {
        actorId,
        action: ACTIVITY_CREATED,
        entity: ACTIVITY_ENTITY,
        next: { ...activity, code },
      })
      return { ok: true, message: "تمت إضافة النشاط ✓" }
    }
    code = codeFromName(activity.name)
  }
  return { ok: false, message: "تعذر إضافة النشاط" }
}

export async function updateActivity(
  admin: SupabaseAdminClient,
  params: { actorId: string; activityId: string; activity: ActivityInput }
): Promise<ActivityMutationResult> {
  const { actorId, activityId, activity } = params

  const { data: current, error: readError } = await admin
    .from("activities")
    .select("*")
    .eq("id", activityId)
    .maybeSingle()
  if (readError || !current) return { ok: false, message: "النشاط غير موجود" }

  const { error } = await admin
    .from("activities")
    .update({
      name: activity.name,
      for_role: activity.for_role,
      attendance_type: activity.attendance_type,
      input_type: activity.input_type,
      min_score: activity.min_score,
      max_score: activity.max_score,
      icon: activity.icon,
      sort_order: activity.sort_order,
    })
    .eq("id", activityId)
  if (error) return { ok: false, message: "تعذر تحديث النشاط" }

  await logAudit(admin, {
    actorId,
    action: ACTIVITY_UPDATED,
    entity: ACTIVITY_ENTITY,
    entityId: activityId,
    previous: activityEditableFields(current as Activity),
    next: { ...activity },
  })
  return { ok: true, message: "تم تحديث النشاط ✓" }
}

/** Archive = soft-delete (is_active = false); the activity stays in history. */
export async function archiveActivity(
  admin: SupabaseAdminClient,
  params: { actorId: string; activityId: string }
): Promise<ActivityMutationResult> {
  return setActivityActive(admin, {
    ...params,
    active: false,
    action: ACTIVITY_ARCHIVED,
    successMessage: "تمت أرشفة النشاط",
  })
}

/** Restores an archived activity back into the active set. */
export async function restoreActivity(
  admin: SupabaseAdminClient,
  params: { actorId: string; activityId: string }
): Promise<ActivityMutationResult> {
  return setActivityActive(admin, {
    ...params,
    active: true,
    action: ACTIVITY_RESTORED,
    successMessage: "تمت استعادة النشاط ✓",
  })
}

async function setActivityActive(
  admin: SupabaseAdminClient,
  params: {
    actorId: string
    activityId: string
    active: boolean
    action: string
    successMessage: string
  }
): Promise<ActivityMutationResult> {
  const { actorId, activityId, active, action, successMessage } = params

  const { data: current, error: readError } = await admin
    .from("activities")
    .select("*")
    .eq("id", activityId)
    .maybeSingle()
  if (readError || !current) return { ok: false, message: "النشاط غير موجود" }

  const { error } = await admin
    .from("activities")
    .update({ is_active: active })
    .eq("id", activityId)
  if (error) return { ok: false, message: "تعذر تحديث النشاط" }

  await logAudit(admin, {
    actorId,
    action,
    entity: ACTIVITY_ENTITY,
    entityId: activityId,
    previous: { is_active: current.is_active },
    next: { is_active: active },
  })
  return { ok: true, message: successMessage }
}