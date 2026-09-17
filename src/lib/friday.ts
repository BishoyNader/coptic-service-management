/**
 * Pure Friday-based ministry calendar arithmetic.
 *
 * The ministry (attendance + served-member scoring + servant activities) runs
 * on FRIDAYS only. The set of valid ministry Fridays is *derived* from the
 * boundaries of a Study Year (see `src/services/study-year-service.ts`) — this
 * module deliberately contains NO hardcoded year or date constants.
 *
 * Everything here is pure "YYYY-MM-DD" (Cairo wall-date) string math resolved
 * at UTC noon, so it runs identically in a browser, a serverless runtime, or
 * a Node-only test.
 *
 * Schedule-based helpers take an explicit `schedule: string[]` (the Fridays of
 * a Study Year) so callers on the server and the client stay in sync with the
 * configured year instead of a baked-in constant.
 */
import { cairoDateString, isCairoFriday } from "./cairo"

function toUtcMid(date: string): Date {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0))
}

function fromUtcMid(dt: Date): string {
  return dt.toISOString().slice(0, 10)
}

/** Advances a "YYYY-MM-DD" string by `n` calendar days (signed). */
export function addDaysDate(date: string, n: number): string {
  const dt = toUtcMid(date)
  dt.setUTCDate(dt.getUTCDate() + n)
  return fromUtcMid(dt)
}

/**
 * Every Friday in the inclusive range [start, end]. Starts at the first Friday
 * on-or-after `start`. Empty when the range contains no Friday.
 */
export function fridaySchedule(start: string, end: string): string[] {
  const out: string[] = []
  let cursor = start
  while (!isCairoFriday(cursor) && cursor <= end) {
    cursor = addDaysDate(cursor, 1)
  }
  while (cursor <= end) {
    out.push(cursor)
    cursor = addDaysDate(cursor, 7)
  }
  return out
}

/** The most recent Friday on-or-before `date` (any civil date). */
export function lastFridayOnOrBefore(date: string): string {
  let cursor = date
  while (!isCairoFriday(cursor)) {
    cursor = addDaysDate(cursor, -1)
  }
  return cursor
}

/**
 * Snaps a civil `date` into `schedule`: the most recent Friday on-or-before it,
 * clamped so it is always a member of the schedule. Non-Friday civil dates fall
 * back to the start when before the year and the end when after it.
 */
export function clampToSchedule(schedule: string[], date: string): string | null {
  if (schedule.length === 0) return null
  const snap = lastFridayOnOrBefore(date)
  const idx = schedule.indexOf(snap)
  if (idx === -1) {
    return snap < schedule[0] ? schedule[0] : schedule[schedule.length - 1]
  }
  return snap
}

/** 0-based index of `date`'s tracking Friday within `schedule` (-1 when absent). */
export function fridayIndexIn(schedule: string[], date: string): number {
  return schedule.indexOf(lastFridayOnOrBefore(date))
}

/** The `index`-th Friday of `schedule` (null when out of range). */
export function fridayAtIn(schedule: string[], index: number): string | null {
  if (!Number.isInteger(index) || index < 0) return null
  return schedule[index] ?? null
}

/** The next Friday in `schedule` strictly after `date` (null when there is none). */
export function nextFridayIn(schedule: string[], date: string): string | null {
  const idx = fridayIndexIn(schedule, date)
  if (idx === -1) return null
  return schedule[idx + 1] ?? null
}

/** The previous Friday in `schedule` strictly before `date` (null when there is none). */
export function previousFridayIn(schedule: string[], date: string): string | null {
  const idx = fridayIndexIn(schedule, date)
  if (idx <= 0) return null
  return schedule[idx - 1]
}

/**
 * The ministry Friday for "now": the most recent Friday on-or-before the Cairo
 * date of `ref`, clamped into `schedule`. Every Friday-based view defaults to
 * this day instead of the (possibly non-Friday) civil "today".
 */
export function currentFridayIn(schedule: string[], ref: Date = new Date()): string | null {
  return clampToSchedule(schedule, cairoDateString(ref))
}

/** Arabic label for a Friday, e.g. "الجمعة 18 سبتمبر". */
export function fridayArabicLabel(date: string): string {
  const d = toUtcMid(date)
  return new Intl.DateTimeFormat("ar-EG", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d)
}