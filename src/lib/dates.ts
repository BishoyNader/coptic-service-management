import { cairoDateString } from "./cairo"

/** Start of the current week (Monday 00:00) in local time. */
export function startOfWeek(now = new Date()): Date {
  const d = new Date(now)
  const day = d.getDay() // 0=Sunday … 6=Saturday
  const diff = (day === 0 ? -6 : 1) - day // move back to Monday
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + diff)
  return d
}

/** Start of the current month (1st, 00:00) in local time. */
export function startOfMonth(now = new Date()): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(1)
  return d
}

export function toDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function todayString(): string {
  return toDateString(new Date())
}

/** Arabic short name of today (e.g. الإثنين). */
const AR_DAYS = [
  "الأحد",
  "الإثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
]

export function arabicWeekday(date = new Date()): string {
  return AR_DAYS[date.getDay()]
}

const AR_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
]

/** Formats a date like "٥ سبتمبر". */
export function formatArabicDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date
  return `${d.getDate()} ${AR_MONTHS[d.getMonth()]}`
}

export function formatArabicDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date
  return `${formatArabicDate(d)} — ${d.toLocaleTimeString("ar-EG", {
    hour: "2-digit",
    minute: "2-digit",
  })}`
}

/** True for leap years (Gregorian). */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** The birthday for a given year, clamping Feb 29 in non-leap years to Feb 28. */
export function birthdayOccurrenceForYear(birthDate: string, year: number): string {
  const [, month, day] = birthDate.split("-").map(Number)
  const occurrenceDay = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day
  return `${year}-${String(month).padStart(2, "0")}-${String(occurrenceDay).padStart(2, "0")}`
}

/** Whole days between two YYYY-MM-DD dates (fromDate → toDate, signed). */
export function daysBetweenDates(fromDate: string, toDate: string): number {
  const [fy, fm, fd] = fromDate.split("-").map(Number)
  const [ty, tm, td] = toDate.split("-").map(Number)
  const fromUtc = Date.UTC(fy, fm - 1, fd)
  const toUtc = Date.UTC(ty, tm - 1, td)
  return Math.round((toUtc - fromUtc) / 86_400_000)
}

/**
 * Next occurrence of a birth date on or after an anchor YYYY-MM-DD date.
 * Compares month/day (rolled into a calendar date string), never a timestamp.
 */
export function nextBirthdayDateString(birthDate: string, fromDate: string): string {
  const fromYear = Number(fromDate.split("-")[0])
  const candidate = birthdayOccurrenceForYear(birthDate, fromYear)
  if (candidate >= fromDate) return candidate
  return birthdayOccurrenceForYear(birthDate, fromYear + 1)
}

/** Days remaining until the next occurrence of a birth date (Cairo calendar). */
export function daysUntilBirthday(birthDate: string, now = new Date()): number {
  return daysBetweenDates(cairoDateString(now), nextBirthdayDateString(birthDate, cairoDateString(now)))
}