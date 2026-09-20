"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isStaffRole } from "@/lib/roles"
import { isUuid } from "@/lib/validation"
import {
  grantMonthlyActivity,
  getWeeklyEntryState,
  saveWeeklyScores,
  getActiveScoringRules,
  rulesByCategory,
  ScoreError,
  type WeeklyEntryState,
} from "@/services/scoring-service"
import {
  categoryPeriodKind,
  periodForDate,
  toDateString,
} from "@/services/scoring-rules"
import { type ScoringCategory } from "@/lib/constants"
import { logAudit } from "@/services/auth-service"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isDateString(value: unknown): value is string {
  return typeof value === "string" && DATE_RE.test(value)
}

function toNum(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : Number.NaN
}

async function requireAdminActor(): Promise<{ adminId: string; role: string } | null> {
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

  if (!profile || !isStaffRole(profile.role)) return null
  return { adminId: user.id, role: profile.role }
}

function wrap(err: unknown): { ok: false; message: string } {
  if (err instanceof ScoreError) return { ok: false, message: err.message }
  console.error("scoring action error", err)
  return { ok: false, message: "حدث خطأ غير متوقع" }
}

export type ScoreEntryViewResult = { ok: true; state: WeeklyEntryState } | { ok: false; message: string }

/** Admin only: current weekly scoring state for a member (attendance auto). */
export async function getScoreEntryViewAction(
  profileId: string,
  weekDate: string
): Promise<ScoreEntryViewResult> {
  const actor = await requireAdminActor()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (!isUuid(profileId) || !isDateString(weekDate)) {
    return { ok: false, message: "بيانات غير صحيحة" }
  }
  const admin = createAdminClient()
  try {
    const state = await getWeeklyEntryState(admin, profileId, weekDate)
    return { ok: true, state }
  } catch (err) {
    return wrap(err)
  }
}

export type SaveWeeklyScoresResult = { ok: boolean; changed?: boolean; message?: string }

export type WeeklyScoresActionInput = {
  profileId: string
  weekDate: string
  commitment: number
  tunic: boolean
  communion: boolean
  serviceCommitment: number
  bonus: boolean
}

/** Admin / Super Admin: save a member's weekly card. Attendance is read-only. */
export async function saveWeeklyScoresAction(
  input: WeeklyScoresActionInput
): Promise<SaveWeeklyScoresResult> {
  const actor = await requireAdminActor()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (!isUuid(input.profileId) || !isDateString(input.weekDate)) {
    return { ok: false, message: "بيانات غير صحيحة" }
  }

  const admin = createAdminClient()
  try {
    const res = await saveWeeklyScores(admin, {
      actorId: actor.adminId,
      profileId: input.profileId,
      weekRef: input.weekDate,
      scores: {
        commitment: toNum(input.commitment),
        tunic: !!input.tunic,
        communion: !!input.communion,
        serviceCommitment: toNum(input.serviceCommitment),
        bonus: !!input.bonus,
      },
    })
    return res
  } catch (err) {
    return wrap(err)
  }
}

/** Admin / Super Admin: grant the monthly activity (30-day rule enforced). */
export async function grantMonthlyActivityAction(input: {
  profileId: string
  activityDate: string
}): Promise<SaveWeeklyScoresResult> {
  const actor = await requireAdminActor()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (!isUuid(input.profileId) || !isDateString(input.activityDate)) {
    return { ok: false, message: "بيانات غير صحيحة" }
  }

  const admin = createAdminClient()
  try {
    return await grantMonthlyActivity(admin, {
      actorId: actor.adminId,
      profileId: input.profileId,
      activityDate: input.activityDate,
    })
  } catch (err) {
    return wrap(err)
  }
}

export type AddAttendanceScoreResult = { ok: boolean; message: string }

/**
 * Manually add an attendance score (CHURCH_ATTENDANCE or SERVICE_ATTENDANCE)
 * using the fixed point value from scoring rules. Only adds if no score
 * exists for that category in the same period.
 */
export async function addManualAttendanceScoreAction(input: {
  profileId: string
  category: "CHURCH_ATTENDANCE" | "SERVICE_ATTENDANCE"
  sessionDate: string
}): Promise<AddAttendanceScoreResult> {
  const actor = await requireAdminActor()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (!isUuid(input.profileId) || !isDateString(input.sessionDate)) {
    return { ok: false, message: "بيانات غير صحيحة" }
  }

  const category = input.category as ScoringCategory
  const admin = createAdminClient()

  const rules = rulesByCategory(await getActiveScoringRules(admin, [category]))
  const rule = rules[category as ScoringCategory]
  if (!rule) {
    return { ok: false, message: "لا توجد قاعدة نشطة لهذه الفئة" }
  }

  const points = Number(rule.point_value)
  const kind = categoryPeriodKind(category)
  const period = periodForDate(kind, input.sessionDate)
  const sessionDate = toDateString(input.sessionDate)

  const { data: existing } = await admin
    .from("score_records")
    .select("id")
    .eq("profile_id", input.profileId)
    .eq("category", category)
    .eq("period_key", period.key)
    .eq("is_voided", false)
    .maybeSingle()

  if (existing) {
    return { ok: false, message: "يوجد درجة مسجلة بالفعل لهذه الفئة في نفس الفترة" }
  }

  const { data: inserted, error } = await admin
    .from("score_records")
    .insert({
      profile_id: input.profileId,
      category,
      points,
      rule_id: rule.id,
      session_date: sessionDate,
      recorded_by: actor.adminId,
      period_key: period.key,
    })
    .select("id")
    .single()

  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "يوجد درجة مسجلة بالفعل لهذه الفئة" }
    }
    return { ok: false, message: "تعذر حفظ الدرجة" }
  }

  await logAudit(admin, {
    actorId: actor.adminId,
    action: "SCORE_CREATED",
    entity: "SCORE",
    entityId: inserted.id,
    next: { points, category, period_key: period.key, profile_id: input.profileId },
    metadata: { category, period_key: period.key, profile_id: input.profileId, points, manual_attendance: true },
  })

  return { ok: true, message: `تم إضافة ${points} نقطة ✓` }
}