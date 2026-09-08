/**
 * Centralized scoring engine — pure rules & period logic.
 *
 * This module owns ALL scoring semantics that do not need a database handle:
 *   - what a scoring period is (WEEKLY / MONTHLY, Cairo calendar arithmetic)
 *   - which categories belong to which aggregation (weekly vs monthly)
 *   - the manual-entry model (commitment 0–10, checkbox categories, the
 *     30-day monthly-activity window)
 *
 * It intentionally imports nothing from the Supabase/Next.js stack so it can
 * also run inside Node-only tests with fully deterministic dates. Points are
 * NEVER computed inside React components — the client only renders whatever
 * the server-side scoring service (see `scoring-service.ts`) decides.
 *
 * Week boundaries are pinned to SATURDAY (the start of the Egyptian week).
 * All date arithmetic is done on plain "YYYY-MM-DD" calendar strings (Cairo
 * wall dates), never on browser/server local time.
 */
import { SCORING_CATEGORY_LABELS, type ScoringCategory } from "../lib/constants"

export type ScorePeriodKind = "WEEKLY" | "MONTHLY"

export const WEEKLY = "WEEKLY"
export const MONTHLY = "MONTHLY"

/** Cairo/calendar day of week the scoring week starts on (0 = Sunday). */
export const WEEK_START_DAY = 6 // Saturday

export type ScorePeriod = {
  kind: ScorePeriodKind
  /** Stable identity, e.g. "WEEKLY:2026-09-12" or "MONTHLY:2026-09-01". */
  key: string
  /** Arabic label for the UI, e.g. "أسبوع 12 – 18 سبتمبر ٢٠٢٦". */
  label: string
  /** Inclusive Cairo calendar bounds "YYYY-MM-DD". */
  startDate: string
  endDate: string
}

// --- Calendar helpers (pure string arithmetic, no timezone drift) -----------

function toUtcMid(date: string): Date {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0))
}

function fromUtcMid(dt: Date): string {
  return dt.toISOString().slice(0, 10)
}

/** Advances a "YYYY-MM-DD" string by `n` calendar days (positive or negative). */
export function addDaysDate(date: string, n: number): string {
  const dt = toUtcMid(date)
  dt.setUTCDate(dt.getUTCDate() + n)
  return fromUtcMid(dt)
}

/** Whole calendar days from `a` (inclusive) to `b` (exclusive): b - a. */
export function daysBetweenDates(a: string, b: string): number {
  return Math.round((toUtcMid(b).getTime() - toUtcMid(a).getTime()) / 86_400_000)
}

/** Day of week (0 = Sunday … 6 = Saturday) of a Cairo calendar date. */
export function cairoWeekday(date: string): number {
  return toUtcMid(date).getUTCDay()
}

export function toDateString(ref: Date | string): string {
  if (typeof ref === "string") return ref
  const p = `${ref.toISOString()}`.slice(0, 10)
  return p
}

// --- Period construction ----------------------------------------------------

function arabicRange(start: string, end: string): string {
  const s = new Intl.DateTimeFormat("ar-EG", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(toUtcMid(start))
  const e = new Intl.DateTimeFormat("ar-EG", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(toUtcMid(end))
  return `${s} – ${e}`
}

export function periodForDate(kind: ScorePeriodKind, ref: Date | string): ScorePeriod {
  const date = toDateString(ref)

  if (kind === WEEKLY) {
    const wd = cairoWeekday(date)
    const diff = (wd - WEEK_START_DAY + 7) % 7
    const startDate = addDaysDate(date, -diff)
    const endDate = addDaysDate(startDate, 6)
    return {
      kind,
      key: `${WEEKLY}:${startDate}`,
      label: `أسبوع ${arabicRange(startDate, endDate)}`,
      startDate,
      endDate,
    }
  }

  const [y, m] = date.split("-").map(Number)
  const startDate = `${y}-${String(m).padStart(2, "0")}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const endDate = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
  const label = new Intl.DateTimeFormat("ar-EG", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(toUtcMid(startDate))
  return { kind, key: `${MONTHLY}:${startDate}`, label, startDate, endDate }
}

export function periodKeyForDate(kind: ScorePeriodKind, ref: Date | string): string {
  return periodForDate(kind, ref).key
}

// --- Category model ----------------------------------------------------------

/** Categories that are entered manually by an admin (never by a member). */
export const MANUAL_SCORE_CATEGORIES: readonly ScoringCategory[] = [
  "WEEKLY_COMMITMENT",
  "TUNIC",
  "COMMUNION",
  "SERVICE_COMMITMENT",
  "BONUS",
  "MONTHLY_ACTIVITY",
]

/** Checkbox categories: +configured rule value when checked, else 0. */
export const CHECKBOX_SCORE_CATEGORIES: readonly ScoringCategory[] = [
  "TUNIC",
  "COMMUNION",
  "BONUS",
]

/** Integer 0–10 categories entered with a picker. */
export const ADMIN_INPUT_SCORE_CATEGORIES: readonly ScoringCategory[] = [
  "WEEKLY_COMMITMENT",
  "SERVICE_COMMITMENT",
]

/** Categories that make up a WEEKLY total (monthly activity is monthly-only). */
export const WEEKLY_TOTAL_CATEGORIES: readonly ScoringCategory[] = [
  "CHURCH_ATTENDANCE",
  "WEEKLY_COMMITMENT",
  "TUNIC",
  "COMMUNION",
  "SERVICE_ATTENDANCE",
  "SERVICE_COMMITMENT",
  "BONUS",
]

/** Categories that make up a MONTHLY total (includes monthly activities). */
export const MONTHLY_TOTAL_CATEGORIES: readonly ScoringCategory[] = [
  "CHURCH_ATTENDANCE",
  "WEEKLY_COMMITMENT",
  "TUNIC",
  "COMMUNION",
  "SERVICE_ATTENDANCE",
  "SERVICE_COMMITMENT",
  "BONUS",
  "MONTHLY_ACTIVITY",
]

/** The scoring period manual categories belong to. */
export function categoryPeriodKind(category: ScoringCategory): ScorePeriodKind {
  return category === "MONTHLY_ACTIVITY" ? MONTHLY : WEEKLY
}

/** Validates a commitment-style score (integer 0–10); returns null if invalid. */
export function validateCommitmentScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null
  if (value < 0 || value > 10) return null
  return value
}

/** Arabic label for a category (from the shared constants table). */
export function categoryLabel(category: ScoringCategory): string {
  return SCORING_CATEGORY_LABELS[category] ?? category
}

/**
 * Icon key per category — mapped to actual lucide icons by UI components so
 * this module stays renderer-free.
 */
export const SCORE_CATEGORY_ICONS: Record<ScoringCategory, string> = {
  CHURCH_ATTENDANCE: "church",
  WEEKLY_COMMITMENT: "heart",
  TUNIC: "shirt",
  COMMUNION: "bread",
  SERVICE_ATTENDANCE: "flame",
  SERVICE_COMMITMENT: "hand",
  BONUS: "star",
  MONTHLY_ACTIVITY: "calendar",
}

// --- Aggregation ------------------------------------------------------------

export type ScoreBreakdownEntry = {
  category: ScoringCategory
  label: string
  icon: string
  points: number
  count: number
}

export type AttendanceSlice = {
  church: { points: number; count: number }
  service: { points: number; count: number }
}

export type ScoreBreakdown = {
  period: ScorePeriod
  entries: ScoreBreakdownEntry[]
  attendance: AttendanceSlice
  total: number
  /** True when at least one non-voided score record fell inside the period. */
  hasAny: boolean
}

export type ScoreRow = {
  category: ScoreRowCategory
  points: number
  session_date: string
}

type ScoreRowCategory = string

/**
 * Aggregates non-voided score rows (already bounded to `period`) into a
 * friendly breakdown. WEEKLY totals never include MONTHLY_ACTIVITY.
 */
export function aggregateScoreRows(
  rows: ScoreRow[],
  period: ScorePeriod,
  kind: ScorePeriodKind
): ScoreBreakdown {
  const included =
    kind === WEEKLY ? new Set(WEEKLY_TOTAL_CATEGORIES as string[]) : new Set(MONTHLY_TOTAL_CATEGORIES as string[])

  const sums = new Map<string, { points: number; count: number }>()
  for (const r of rows) {
    if (!included.has(r.category)) continue
    const cur = sums.get(r.category) ?? { points: 0, count: 0 }
    cur.points += Number(r.points)
    cur.count += 1
    sums.set(r.category, cur)
  }

  const ordered =
    kind === WEEKLY ? WEEKLY_TOTAL_CATEGORIES : MONTHLY_TOTAL_CATEGORIES

  const entries: ScoreBreakdownEntry[] = ordered
    .filter((c) => (sums.get(c)?.count ?? 0) > 0)
    .map((c) => {
      const s = sums.get(c)!
      return {
        category: c as ScoringCategory,
        label: categoryLabel(c as ScoringCategory),
        icon: SCORE_CATEGORY_ICONS[c as ScoringCategory],
        points: s.points,
        count: s.count,
      }
    })

  const church = sums.get("CHURCH_ATTENDANCE") ?? { points: 0, count: 0 }
  const service = sums.get("SERVICE_ATTENDANCE") ?? { points: 0, count: 0 }

  return {
    period,
    entries,
    attendance: { church, service },
    total: entries.reduce((s, e) => s + e.points, 0),
    hasAny: entries.length > 0,
  }
}