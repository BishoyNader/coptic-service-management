"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminRole } from "@/lib/roles"
import { isUuid } from "@/lib/validation"
import {
  grantMonthlyActivity,
  getWeeklyEntryState,
  saveWeeklyScores,
  ScoreError,
  type WeeklyEntryState,
} from "@/services/scoring-service"

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

  if (!profile || !isAdminRole(profile.role)) return null
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