/**
 * Centralized scoring service.
 *
 * The engine is the ONLY place that reads `scoring_rules` and persists /
 * recomputes manual score records. UI components receive ready-made
 * breakdowns and configured values; they never run a scoring formula.
 *
 * Every persisted change is audited (SCORE_CREATED / SCORE_CORRECTED) with
 * previous+next values. The actor is always the authenticated admin that was
 * verified by the server action — never something forwarded from the browser.
 */
import type { ScoreRecord, ScoringRule } from "../lib/types"
import type { ScoringCategory } from "../lib/constants"
import { ROLES } from "../lib/roles"
import type { SupabaseAdminClient } from "../lib/supabase/admin"
import { logAudit } from "./auth-service"
import { toDateString } from "./scoring-rules"
import {
  aggregateScoreRows,
  categoryPeriodKind,
  daysBetweenDates,
  MANUAL_SCORE_CATEGORIES,
  MONTHLY,
  periodForDate,
  periodKeyForDate,
  type ScoreBreakdown,
  type ScorePeriod,
  type ScorePeriodKind,
  type ScoreRow,
  type AttendanceSlice,
  validateCommitmentScore,
  WEEKLY,
} from "./scoring-rules"

export type ScoreClient = SupabaseAdminClient

export function toScoreRow(r: {
  category: string
  points: number
  session_date: string
}): ScoreRow {
  return { category: r.category, points: Number(r.points), session_date: r.session_date }
}

// --- Rules (configuration) --------------------------------------------------

export async function getActiveScoringRules(
  admin: ScoreClient,
  categories?: readonly ScoringCategory[]
): Promise<ScoringRule[]> {
  let q = admin
    .from("scoring_rules")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
  if (categories && categories.length > 0) {
    q = q.in("category", categories)
  }
  const { data } = await q
  return (data ?? []) as ScoringRule[]
}

export function rulesByCategory(rules: ScoringRule[]): Partial<Record<ScoringCategory, ScoringRule>> {
  const map: Partial<Record<ScoringCategory, ScoringRule>> = {}
  for (const r of rules) map[r.category as ScoringCategory] = r
  return map
}

// --- Breakdowns (the member + admin views both rely on this) ----------------

/** Aggregates the persisted, non-voided score rows for one member + period. */
export async function calculateScoreBreakdown(
  admin: ScoreClient,
  profileId: string,
  kind: ScorePeriodKind,
  ref: Date | string
): Promise<ScoreBreakdown> {
  const period = periodForDate(kind, ref)
  const { data } = await admin
    .from("score_records")
    .select("category, points, session_date")
    .eq("profile_id", profileId)
    .eq("is_voided", false)
    .gte("session_date", period.startDate)
    .lte("session_date", period.endDate)
  return aggregateScoreRows((data ?? []).map(toScoreRow), period, kind)
}

export type MemberScoreView = {
  week: ScoreBreakdown
  month: ScoreBreakdown
}

/** Both periods for the member-facing scores page. */
export async function getMemberScoreView(
  admin: ScoreClient,
  profileId: string,
  ref: Date | string = new Date()
): Promise<MemberScoreView> {
  const [week, month] = await Promise.all([
    calculateScoreBreakdown(admin, profileId, WEEKLY, ref),
    calculateScoreBreakdown(admin, profileId, MONTHLY, ref),
  ])
  return { week, month }
}

// --- Weekly entry state (admin fast-entry UI) -------------------------------

export type WeeklyEntryState = {
  period: ScorePeriod
  attendance: AttendanceSlice
  /** Current persisted manual points per category (0 = nothing recorded). */
  existing: Partial<Record<ScoringCategory, number>>
  /** The exact configured point values for checkbox categories. */
  configured: Partial<Record<ScoringCategory, number>>
  /** Date of the latest qualifying monthly activity (null if none). */
  latestMonthlyActivity: string | null
  /** Weekly total from persisted records (attendance + manual so far). */
  weeklyTotal: number
  /** Monthly total from persisted records (attendance + manual + activity). */
  monthlyTotal: number
}

export async function getWeeklyEntryState(
  admin: ScoreClient,
  profileId: string,
  weekRef: Date | string
): Promise<WeeklyEntryState> {
  const period = periodForDate(WEEKLY, weekRef)
  const rules = rulesByCategory(await getActiveScoringRules(admin, MANUAL_SCORE_CATEGORIES))

  const [rowsResult, latestResult, breakdown, monthlyBreakdown] = await Promise.all([
    admin
      .from("score_records")
      .select("category, points")
      .eq("profile_id", profileId)
      .eq("is_voided", false)
      .gte("session_date", period.startDate)
      .lte("session_date", period.endDate),
    admin
      .from("score_records")
      .select("session_date")
      .eq("profile_id", profileId)
      .eq("category", "MONTHLY_ACTIVITY")
      .eq("is_voided", false)
      .order("session_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    calculateScoreBreakdown(admin, profileId, WEEKLY, weekRef),
    calculateScoreBreakdown(admin, profileId, MONTHLY, weekRef),
  ])

  const existing: Partial<Record<ScoringCategory, number>> = {}
  for (const r of rowsResult.data ?? []) {
    const category = r.category as ScoringCategory
    if ((MANUAL_SCORE_CATEGORIES as readonly ScoringCategory[]).includes(category)) {
      existing[category] = Number(r.points)
    }
  }

  const configured: Partial<Record<ScoringCategory, number>> = {}
  for (const r of Object.values(rules)) {
    if (r) configured[r.category as ScoringCategory] = Number(r.point_value)
  }

  return {
    period,
    attendance: breakdown.attendance,
    existing,
    configured,
    latestMonthlyActivity: latestResult.data?.session_date ?? null,
    weeklyTotal: breakdown.total,
    monthlyTotal: monthlyBreakdown.total,
  }
}

// --- Manual score persistence (audited) -------------------------------------

export type UpsertScoreResult = {
  ok: boolean
  changed?: boolean
  message?: string
}

async function assertScorableMember(
  admin: ScoreClient,
  profileId: string
): Promise<{ role: string; status: string } | null> {
  const { data: profile } = await admin
    .from("profiles")
    .select("role, status")
    .eq("id", profileId)
    .maybeSingle()
  if (!profile) return null
  if (profile.role !== ROLES.SERVED_MEMBER) {
    throw new ScoreError("الدرجات تُسجَّل للمخدومين فقط")
  }
  if ((profile.status as string) !== "ACTIVE") {
    throw new ScoreError("هذا الحساب غير نشط")
  }
  return profile as { role: string; status: string }
}

export class ScoreError extends Error {}

/**
 * Persists (or voids) a single manual score for a served member. Commits only
 * configured point values — never arbitrary numbers for checkbox categories.
 * A change to an existing value is audited as a correction.
 */
export async function upsertManualScore(
  admin: ScoreClient,
  params: {
    actorId: string
    profileId: string
    category: ScoringCategory
    refDate: Date | string
    points: number
    note?: string | null
  }
): Promise<UpsertScoreResult> {
  const { actorId, profileId, category, refDate, points, note } = params
  const member = await assertScorableMember(admin, profileId)
  if (!member) return { ok: false, message: "لم يتم العثور على هذا العضو" }

  if (!(MANUAL_SCORE_CATEGORIES as readonly ScoringCategory[]).includes(category)) {
    return { ok: false, message: "فئة الدرجات غير مدعومة" }
  }
  if (category === "MONTHLY_ACTIVITY") {
    return { ok: false, message: "استخدم نشاط شهري لتسجيل النشاط" }
  }

  const rules = rulesByCategory(await getActiveScoringRules(admin, [category]))
  const rule = rules[category]
  if (!rule) return { ok: false, message: "لا توجد قاعدة نشطة لهذه الفئة" }

  // Derive the exact persisted point value from the rules (never the client).
  let finalPoints: number
  const ruleValue = Number(rule.point_value)
  if (category === "TUNIC" || category === "COMMUNION" || category === "BONUS") {
    if (points === 0) finalPoints = 0
    else if (points === ruleValue) finalPoints = ruleValue
    else return { ok: false, message: `قيمة هذه الفئة ثابتة (+${ruleValue})` }
  } else {
    const v = validateCommitmentScore(points)
    if (v === null) return { ok: false, message: "الالتزام لازم يكون رقم من 0 لـ 10" }
    finalPoints = v
  }

  const kind = categoryPeriodKind(category)
  const period = periodForDate(kind, refDate)
  const key = period.key
  const sessionDate = toDateString(refDate)

  const { data: existing } = await admin
    .from("score_records")
    .select("id, points, note, period_key")
    .eq("profile_id", profileId)
    .eq("category", category)
    .eq("period_key", key)
    .eq("is_voided", false)
    .maybeSingle()

  if (!existing) {
    if (finalPoints === 0) return { ok: true, changed: false }
    const { data: inserted, error } = await admin
      .from("score_records")
      .insert({
        profile_id: profileId,
        category,
        points: finalPoints,
        rule_id: rule.id,
        session_date: sessionDate,
        note: note ?? null,
        recorded_by: actorId,
        period_key: key,
      })
      .select("id")
      .single()
    if (error) {
      // The (profile_id, category, period_key) unique index is the backstop.
      if (error.code === "23505") {
        return { ok: false, message: "يوجد تسجيل بالفعل لهذه الفئة في نفس الفترة" }
      }
      return { ok: false, message: "تعذر حفظ الدرجة" }
    }
    await logAudit(admin, {
      actorId,
      action: "SCORE_CREATED",
      entity: "SCORE",
      entityId: inserted.id,
      next: { points: finalPoints, category, period_key: key, profile_id: profileId },
      metadata: { category, period_key: key, profile_id: profileId, points: finalPoints },
    })
    return { ok: true, changed: true }
  }

  if (Number(existing.points) === finalPoints) {
    return { ok: true, changed: false }
  }

  const previous = { points: Number(existing.points), note: existing.note ?? null }
  if (finalPoints === 0) {
    await admin
      .from("score_records")
      .update({ is_voided: true, recorded_by: actorId })
      .eq("id", existing.id)
    await logAudit(admin, {
      actorId,
      action: "SCORE_CORRECTED",
      entity: "SCORE",
      entityId: existing.id,
      previous,
      next: { points: 0, is_voided: true, profile_id: profileId },
      metadata: { category, period_key: key, profile_id: profileId },
    })
  } else {
    await admin
      .from("score_records")
      .update({
        points: finalPoints,
        rule_id: rule.id,
        note: note ?? existing.note ?? null,
        recorded_by: actorId,
      })
      .eq("id", existing.id)
    await logAudit(admin, {
      actorId,
      action: "SCORE_CORRECTED",
      entity: "SCORE",
      entityId: existing.id,
      previous,
      next: { points: finalPoints, category, period_key: key, profile_id: profileId },
      metadata: { category, period_key: key, profile_id: profileId, from: previous.points, to: finalPoints },
    })
  }

  return { ok: true, changed: true }
}

export type WeeklyScoresInput = {
  commitment: number
  tunic: boolean
  communion: boolean
  serviceCommitment: number
  bonus: boolean
  note?: string | null
}

/**
 * The whole weekly card in one call. Attendance is never part of the input —
 * it is always recomputed from the attendance engine downstream.
 */
export async function saveWeeklyScores(
  admin: ScoreClient,
  params: {
    actorId: string
    profileId: string
    weekRef: Date | string
    scores: WeeklyScoresInput
  }
): Promise<UpsertScoreResult> {
  const { actorId, profileId, weekRef, scores } = params
  const member = await assertScorableMember(admin, profileId)
  if (!member) return { ok: false, message: "لم يتم العثور على هذا العضو" }

  if (validateCommitmentScore(scores.commitment) === null) {
    return { ok: false, message: "الالتزام لازم يكون رقم من 0 لـ 10" }
  }
  if (validateCommitmentScore(scores.serviceCommitment) === null) {
    return { ok: false, message: "التزام الخدمة لازم يكون رقم من 0 لـ 10" }
  }

  let changedAny = false
  const results = await Promise.all([
    upsertManualScore(admin, {
      actorId,
      profileId,
      category: "WEEKLY_COMMITMENT",
      refDate: weekRef,
      points: scores.commitment,
      note: scores.note,
    }),
    upsertManualScore(admin, {
      actorId,
      profileId,
      category: "TUNIC",
      refDate: weekRef,
      points: scores.tunic ? await checkboxValue(admin, "TUNIC") : 0,
      note: scores.note,
    }),
    upsertManualScore(admin, {
      actorId,
      profileId,
      category: "COMMUNION",
      refDate: weekRef,
      points: scores.communion ? await checkboxValue(admin, "COMMUNION") : 0,
      note: scores.note,
    }),
    upsertManualScore(admin, {
      actorId,
      profileId,
      category: "SERVICE_COMMITMENT",
      refDate: weekRef,
      points: scores.serviceCommitment,
      note: scores.note,
    }),
    upsertManualScore(admin, {
      actorId,
      profileId,
      category: "BONUS",
      refDate: weekRef,
      points: scores.bonus ? await checkboxValue(admin, "BONUS") : 0,
      note: scores.note,
    }),
  ])

  for (const r of results) {
    if (!r.ok) return r
    if (r.changed) changedAny = true
  }
  return { ok: true, changed: changedAny }
}

async function checkboxValue(admin: ScoreClient, category: ScoringCategory): Promise<number> {
  const rules = rulesByCategory(await getActiveScoringRules(admin, [category]))
  return Number(rules[category]?.point_value ?? 0)
}

// --- Monthly activity (30-day eligibility, server-side) ---------------------

export async function grantMonthlyActivity(
  admin: ScoreClient,
  params: { actorId: string; profileId: string; activityDate: Date | string }
): Promise<UpsertScoreResult> {
  const { actorId, profileId, activityDate } = params
  const member = await assertScorableMember(admin, profileId)
  if (!member) return { ok: false, message: "لم يتم العثور على هذا العضو" }

  const rules = rulesByCategory(await getActiveScoringRules(admin, ["MONTHLY_ACTIVITY"]))
  const rule = rules.MONTHLY_ACTIVITY
  if (!rule) return { ok: false, message: "لا توجد قاعدة نشطة للنشاط الشهري" }

  const value = Number(rule.point_value)
  const minDays = rule.requires_min_days ?? 30
  const date = toDateString(activityDate)

  const { data: latest } = await admin
    .from("score_records")
    .select("id, session_date")
    .eq("profile_id", profileId)
    .eq("category", "MONTHLY_ACTIVITY")
    .eq("is_voided", false)
    .order("session_date", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latest && daysBetweenDates(latest.session_date, date) < minDays) {
    return {
      ok: false,
      message: `النشاط الشهري غير متاح: لازم يعدي ${minDays} يوم على الأقل من آخر نشاط`,
    }
  }

  const key = periodKeyForDate(MONTHLY, date)
  const { data: existing } = await admin
    .from("score_records")
    .select("id")
    .eq("profile_id", profileId)
    .eq("category", "MONTHLY_ACTIVITY")
    .eq("period_key", key)
    .eq("is_voided", false)
    .maybeSingle()
  if (existing) return { ok: false, message: "يوجد نشاط مسجل بالفعل هذا الشهر" }

  const { data: inserted, error } = await admin
    .from("score_records")
    .insert({
      profile_id: profileId,
      category: "MONTHLY_ACTIVITY",
      points: value,
      rule_id: rule.id,
      session_date: date,
      recorded_by: actorId,
      period_key: key,
    })
    .select("id")
    .single()
  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "يوجد نشاط مسجل بالفعل هذا الشهر" }
    }
    return { ok: false, message: "تعذر تسجيل النشاط" }
  }

  await logAudit(admin, {
    actorId,
    action: "SCORE_CREATED",
    entity: "SCORE",
    entityId: inserted.id,
    next: { points: value, category: "MONTHLY_ACTIVITY", period_key: key, profile_id: profileId },
    metadata: { category: "MONTHLY_ACTIVITY", period_key: key, profile_id: profileId, points: value },
  })
  return { ok: true, changed: true }
}

// --- Admin member list ------------------------------------------------------

export type ScorableMember = { id: string; full_name: string }

export async function listScorableMembers(admin: ScoreClient): Promise<ScorableMember[]> {
  const { data } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("role", ROLES.SERVED_MEMBER)
    .eq("status", "ACTIVE")
    .order("full_name")
  return (data ?? []) as ScorableMember[]
}

export type { ScoreBreakdown, ScorePeriod, ScorePeriodKind, AttendanceSlice }

export type ManualScoreCategory = (typeof MANUAL_SCORE_CATEGORIES)[number]
export type { ScoreRecord }