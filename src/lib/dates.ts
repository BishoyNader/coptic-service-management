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

/** Days remaining until the next occurrence of a birth date. */
export function daysUntilBirthday(birthDate: string, now = new Date()): number {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const bd = new Date(birthDate)
  const next = new Date(today.getFullYear(), bd.getMonth(), bd.getDate())
  if (next < today) {
    next.setFullYear(next.getFullYear() + 1)
  }
  const diff = Math.round((next.getTime() - today.getTime()) / 86400000)
  return diff
}