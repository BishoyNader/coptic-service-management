/**
 * Coptic Calendar service — wraps https://api.coptic.io
 *
 * API endpoints (verified against the live API 2026-09-17):
 *
 *   GET /api/calendar/:date
 *     → { dateString, day, month, year, monthString }
 *     (flat coptic date object — NOT nested under "copticDate")
 *
 *   GET /api/celebrations/:date
 *     → [{ id, name, type, isMoveable }, ...]
 *     (array at the root — NOT nested under "celebrations")
 *
 *   GET /api/celebrations/upcoming/list?days=N
 *     → [{ date, copticDate: { dateString, day, month, year, monthString },
 *           celebrations: [{ id, name, type, isMoveable }] }, ...]
 *     days=1..365; only days that have celebrations are returned
 *
 * All functions return typed results; on any API failure they return
 * ok:false — they never throw, never fabricate feast data, and callers
 * display a graceful empty state.
 *
 * The COPTIC_CALENDAR_API_BASE_URL environment variable overrides the base
 * URL (useful in tests or proxied deployments).
 */

import { CAIRO_TZ } from "@/lib/cairo"

export const COPTIC_API_BASE =
  process.env.COPTIC_CALENDAR_API_BASE_URL ?? "https://api.coptic.io"

export const COPTIC_CALENDAR_TZ = CAIRO_TZ

// ─── Types ────────────────────────────────────────────────────────────────────

export type CopticCelebrationType = "feast" | "lordlyFeast" | "fast"

export type CopticCelebration = {
  /** English name as returned by the API. */
  name: string
  type: CopticCelebrationType
  isMoveable: boolean
}

export type CopticDay = {
  dateString: string
  day: number
  month: number
  year: number
  monthString: string
}

export type CopticCalendarDay = {
  copticDate: CopticDay
  celebrations: CopticCelebration[]
}

/** A single day in the upcoming-feasts list. */
export type UpcomingFeastDay = {
  /** Gregorian date string (YYYY-MM-DD). */
  date: string
  copticDate: CopticDay
  celebrations: CopticCelebration[]
}

export type CopticCalendarResult =
  | { ok: true; day: CopticCalendarDay }
  | { ok: false; message: string }

export type UpcomingFeastsResult =
  | { ok: true; days: UpcomingFeastDay[] }
  | { ok: false; message: string }

// ─── Internal fetch helpers ────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 5_000

function parseCelebration(raw: unknown): CopticCelebration | null {
  const c = raw as Record<string, unknown>
  if (!c || typeof c.name !== "string" || c.name.length === 0) return null
  const type =
    c.type === "lordlyFeast" || c.type === "fast"
      ? (c.type as CopticCelebrationType)
      : "feast"
  return { name: c.name, type, isMoveable: Boolean(c.isMoveable) }
}

function parseCopticDay(raw: unknown): CopticDay | null {
  const d = raw as Record<string, unknown>
  if (!d) return null
  return {
    dateString: String(d.dateString ?? ""),
    day: Number(d.day ?? 0),
    month: Number(d.month ?? 0),
    year: Number(d.year ?? 0),
    monthString: String(d.monthString ?? ""),
  }
}

/** Shared AbortController timeout for every fetch. */
function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms)
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetches the Coptic calendar data for a single Gregorian date (YYYY-MM-DD).
 * Makes TWO API calls — one for the coptic date, one for celebrations — and
 * merges them into a single `CopticCalendarDay`.
 *
 * Uses Next.js `next: { revalidate }` cache so repeated requests within the
 * same server-render are deduplicated and the result is cached for 1 hour.
 * Feast data changes at most once per day, so 1-hour revalidation is
 * appropriate.
 */
export async function getCopticCalendarDay(
  _: unknown,
  dateString: string
): Promise<CopticCalendarResult> {
  try {
    const [calRes, celRes] = await Promise.all([
      fetch(`${COPTIC_API_BASE}/api/calendar/${dateString}`, {
        headers: { accept: "application/json" },
        // Cache for 1 hour; feast data doesn't change within a day.
        next: { revalidate: 3600 },
      }),
      fetch(`${COPTIC_API_BASE}/api/celebrations/${dateString}`, {
        headers: { accept: "application/json" },
        next: { revalidate: 3600 },
      }),
    ])

    if (!calRes.ok || !celRes.ok) {
      return { ok: false, message: "تعذر تحميل التقويم القبطي" }
    }

    const calRaw = (await calRes.json()) as unknown
    const celRaw = (await celRes.json()) as unknown

    const copticDate = parseCopticDay(calRaw)
    if (!copticDate) {
      return { ok: false, message: "استجابة غير متوقعة من واجهة التقويم القبطي" }
    }

    const celebrations = Array.isArray(celRaw)
      ? (celRaw as unknown[]).map(parseCelebration).filter(Boolean) as CopticCelebration[]
      : []

    return { ok: true, day: { copticDate, celebrations } }
  } catch {
    return { ok: false, message: "تعذر الاتصال بخادم التقويم القبطي" }
  }
}

/**
 * Fetches upcoming feast days within `days` from today (max 365).
 * Only returns days that actually have celebrations.
 * Cached for 1 hour — feast schedules don't change within a day.
 */
export async function getUpcomingFeasts(days = 7): Promise<UpcomingFeastsResult> {
  const capped = Math.min(Math.max(1, days), 365)
  try {
    const res = await fetch(
      `${COPTIC_API_BASE}/api/celebrations/upcoming/list?days=${capped}`,
      {
        headers: { accept: "application/json" },
        next: { revalidate: 3600 },
        signal: withTimeout(FETCH_TIMEOUT_MS),
      }
    )

    if (!res.ok) {
      return { ok: false, message: "تعذر تحميل قائمة الأعياد القبطية القادمة" }
    }

    const raw = (await res.json()) as unknown
    if (!Array.isArray(raw)) {
      return { ok: false, message: "استجابة غير متوقعة من واجهة الأعياد القبطية" }
    }

    const days_: UpcomingFeastDay[] = (raw as unknown[])
      .map((item) => {
        const entry = item as Record<string, unknown>
        if (!entry || typeof entry.date !== "string") return null
        const copticDate = parseCopticDay(entry.copticDate)
        if (!copticDate) return null
        const celebrations = Array.isArray(entry.celebrations)
          ? (entry.celebrations as unknown[]).map(parseCelebration).filter(Boolean) as CopticCelebration[]
          : []
        if (celebrations.length === 0) return null
        return { date: entry.date, copticDate, celebrations } satisfies UpcomingFeastDay
      })
      .filter(Boolean) as UpcomingFeastDay[]

    return { ok: true, days: days_ }
  } catch {
    return { ok: false, message: "تعذر الاتصال بخادم التقويم القبطي" }
  }
}

/**
 * True when the argument is a Cairo Friday (the attendance occasion).
 * Exported for callers that need to check if a date is a ministry Friday.
 */
export function isCairoFriday(dateString: string): boolean {
  const [y, m, d] = dateString.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0)).getUTCDay() === 5
}
