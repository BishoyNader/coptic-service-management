/**
 * Africa/Cairo time handling.
 *
 * The application targets Egypt. All attendance business rules (scoring
 * windows, calendar days) run on Cairo time, never on the browser's or the
 * server host's local timezone. `Date` instants stay timezone-agnostic UTC
 * values; these helpers convert between an instant and Cairo wall time.
 */

export const CAIRO_TZ = "Africa/Cairo"

export type CairoParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CAIRO_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
})

/** Decomposes an instant into its Cairo wall-clock parts. */
export function cairoParts(date: Date): CairoParts {
  const parts = new Map<string, string>(
    partsFormatter
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value] as [string, string])
  )

  const num = (t: string) => Number(parts.get(t) ?? "0")

  return {
    year: num("year"),
    month: num("month"),
    day: num("day"),
    hour: num("hour"),
    minute: num("minute"),
    second: num("second"),
  }
}

/** Cairo calendar date as "YYYY-MM-DD" (e.g. the date a session belongs to). */
export function cairoDateString(date: Date): string {
  const p = cairoParts(date)
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
}

/** Cairo wall-clock time as "HH:MM" (used to match scoring bands). */
export function cairoTimeString(date: Date): string {
  const p = cairoParts(date)
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`
}

/** The UTC instant of Cairo midnight on the day containing `date`. */
export function cairoDayStart(date: Date): Date {
  const p = cairoParts(date)
  return new Date(Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0, 0))
}

/** The UTC instant of Cairo midnight on the day AFTER the one containing `date`. */
export function cairoDayEnd(date: Date): Date {
  const p = cairoParts(date)
  return new Date(Date.UTC(p.year, p.month - 1, p.day + 1, 0, 0, 0, 0))
}

/** Formats an instant as Cairo time in Arabic numerals, e.g. "٠٧:٣٢". */
export function formatCairoTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date
  return new Intl.DateTimeFormat("ar-EG", {
    timeZone: CAIRO_TZ,
    hour: "2-digit",
    minute: "2-digit",
  }).format(d)
}

/** Formats an instant as "الشهر اليوم — HH:MM" in Cairo time. */
export function formatCairoDateTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date
  const day = new Intl.DateTimeFormat("ar-EG", {
    timeZone: CAIRO_TZ,
    day: "numeric",
    month: "long",
  }).format(d)
  return `${day} — ${formatCairoTime(d)}`
}

/** ISO instant `days` days before the current moment (UTC). */
export function daysAgoUtcISO(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString()
}