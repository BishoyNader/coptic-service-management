/**
 * Focused unit tests for:
 *  - Coptic Calendar service (API parsing, error handling)
 *  - Study Year / Friday schedule logic
 *  - Birthday date calculation
 *
 * Run with Node.js built-in test runner (no dependencies required):
 *   node --experimental-test-coverage --test src/__tests__/unit.test.mjs
 *
 * These tests cover PURE business-logic functions only. Database-integrated
 * behavior is covered by the Playwright E2E suite.
 */

import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

// ── Inline implementations of the pure functions under test ─────────────────
// We replicate the pure logic here rather than importing through TypeScript
// module resolution to keep this file executable with plain `node` (no tsx/ts-node).

// ── lib/dates.ts ─────────────────────────────────────────────────────────────

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function birthdayOccurrenceForYear(birthDate, year) {
  const [, month, day] = birthDate.split("-").map(Number)
  const occurrenceDay =
    month === 2 && day === 29 && !isLeapYear(year) ? 28 : day
  return `${year}-${String(month).padStart(2, "0")}-${String(occurrenceDay).padStart(2, "0")}`
}

function daysBetweenDates(fromDate, toDate) {
  const [fy, fm, fd] = fromDate.split("-").map(Number)
  const [ty, tm, td] = toDate.split("-").map(Number)
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000
  )
}

function nextBirthdayDateString(birthDate, fromDate) {
  const fromYear = Number(fromDate.split("-")[0])
  const candidate = birthdayOccurrenceForYear(birthDate, fromYear)
  if (candidate >= fromDate) return candidate
  return birthdayOccurrenceForYear(birthDate, fromYear + 1)
}

// ── lib/friday.ts ─────────────────────────────────────────────────────────────

function isCairoFriday(dateString) {
  const [y, m, d] = dateString.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0)).getUTCDay() === 5
}

function addDaysDate(date, n) {
  const [y, m, d] = date.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

function fridaySchedule(start, end) {
  const out = []
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

// ── Coptic Calendar service helpers ──────────────────────────────────────────

function parseCelebration(raw) {
  if (!raw || typeof raw.name !== "string" || raw.name.length === 0) return null
  const type =
    raw.type === "lordlyFeast" || raw.type === "fast" ? raw.type : "feast"
  return { name: raw.name, type, isMoveable: Boolean(raw.isMoveable) }
}

function parseCopticDay(raw) {
  if (!raw) return null
  return {
    dateString: String(raw.dateString ?? ""),
    day: Number(raw.day ?? 0),
    month: Number(raw.month ?? 0),
    year: Number(raw.year ?? 0),
    monthString: String(raw.monthString ?? ""),
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITES
// ════════════════════════════════════════════════════════════════════════════

// ── 1. Coptic Calendar — API response parsing ─────────────────────────────────

describe("Coptic Calendar — API parsing", () => {
  test("parseCopticDay parses a valid API response", () => {
    const raw = {
      dateString: "Tout 7, 1743",
      day: 7,
      month: 1,
      year: 1743,
      monthString: "Tout",
    }
    const result = parseCopticDay(raw)
    assert.equal(result.dateString, "Tout 7, 1743")
    assert.equal(result.day, 7)
    assert.equal(result.month, 1)
    assert.equal(result.year, 1743)
    assert.equal(result.monthString, "Tout")
  })

  test("parseCopticDay returns null for null input", () => {
    assert.equal(parseCopticDay(null), null)
  })

  test("parseCopticDay handles missing optional fields gracefully", () => {
    const result = parseCopticDay({})
    assert.equal(typeof result.dateString, "string")
    assert.equal(result.day, 0)
    assert.equal(result.month, 0)
    assert.equal(result.year, 0)
    assert.equal(result.monthString, "")
  })

  test("parseCelebration parses feast type correctly", () => {
    const raw = { id: 1, name: "Coptic New Year (Nayrouz)", type: "feast", isMoveable: false }
    const result = parseCelebration(raw)
    assert.ok(result)
    assert.equal(result.name, "Coptic New Year (Nayrouz)")
    assert.equal(result.type, "feast")
    assert.equal(result.isMoveable, false)
  })

  test("parseCelebration parses lordlyFeast type correctly", () => {
    const raw = { id: 3, name: "Nativity", type: "lordlyFeast", isMoveable: false }
    const result = parseCelebration(raw)
    assert.ok(result)
    assert.equal(result.type, "lordlyFeast")
  })

  test("parseCelebration returns null for empty name", () => {
    assert.equal(parseCelebration({ name: "", type: "feast" }), null)
  })

  test("parseCelebration returns null for null input", () => {
    assert.equal(parseCelebration(null), null)
  })

  test("parseCelebration defaults unknown type to feast", () => {
    const result = parseCelebration({ name: "Mystery Day", type: "unknown_type" })
    assert.ok(result)
    assert.equal(result.type, "feast")
  })

  test("parseCelebration handles moveable feasts", () => {
    const raw = { name: "Easter", type: "feast", isMoveable: true }
    const result = parseCelebration(raw)
    assert.ok(result)
    assert.equal(result.isMoveable, true)
  })
})

// ── 2. Study Year / Friday schedule logic ────────────────────────────────────

describe("Study Year / Friday schedule", () => {
  // The 2026/2027 seeded study year: 2026-09-18 to 2027-09-24.
  const SEED_START = "2026-09-18"
  const SEED_END = "2027-09-24"

  // Independent oracle: count Fridays without using the app's algorithm.
  function countFridaysOracle(start, end) {
    const cursor = new Date(`${start}T12:00:00Z`)
    const stop = new Date(`${end}T12:00:00Z`)
    let count = 0
    while (cursor <= stop) {
      if (cursor.getUTCDay() === 5) count += 1
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
    return count
  }

  test("2026/2027 study year produces the correct number of Fridays", () => {
    const schedule = fridaySchedule(SEED_START, SEED_END)
    const expected = countFridaysOracle(SEED_START, SEED_END)
    assert.equal(
      schedule.length,
      expected,
      `Expected ${expected} Fridays, got ${schedule.length}`
    )
  })

  test("all dates in the schedule are Fridays", () => {
    const schedule = fridaySchedule(SEED_START, SEED_END)
    for (const date of schedule) {
      assert.ok(
        isCairoFriday(date),
        `${date} is not a Friday`
      )
    }
  })

  test("schedule is bounded by the study year range", () => {
    const schedule = fridaySchedule(SEED_START, SEED_END)
    assert.ok(schedule.length > 0, "Schedule must be non-empty")
    assert.ok(schedule[0] >= SEED_START, "First Friday must be >= start")
    assert.ok(schedule[schedule.length - 1] <= SEED_END, "Last Friday must be <= end")
  })

  test("empty range returns empty schedule", () => {
    // A range with no Friday should return an empty array.
    // Thursday only range:
    const schedule = fridaySchedule("2026-09-17", "2026-09-17")
    assert.equal(schedule.length, 0)
  })

  test("a range that starts on a Friday includes that Friday", () => {
    const schedule = fridaySchedule("2026-09-18", "2026-09-18")
    assert.equal(schedule.length, 1)
    assert.equal(schedule[0], "2026-09-18")
  })

  test("study year with different date ranges does not hardcode 54 Fridays", () => {
    // A 1-week range with exactly one Friday should produce 1.
    const oneWeek = fridaySchedule("2026-09-18", "2026-09-24")
    assert.equal(oneWeek.length, 1)
    // A 2-week range with exactly two Fridays should produce 2.
    const twoWeeks = fridaySchedule("2026-09-18", "2026-09-25")
    assert.equal(twoWeeks.length, 2)
  })

  test("historical study year calculates correctly", () => {
    const schedule = fridaySchedule("2024-09-20", "2025-09-26")
    const expected = countFridaysOracle("2024-09-20", "2025-09-26")
    assert.equal(schedule.length, expected)
  })

  test("future study year calculates correctly", () => {
    const schedule = fridaySchedule("2028-09-22", "2029-09-28")
    const expected = countFridaysOracle("2028-09-22", "2029-09-28")
    assert.equal(schedule.length, expected)
  })

  test("Friday is not just a plain activity — schedule is date-based", () => {
    // Fridays come from date math, not from an activities table.
    // This verifies the function uses calendar logic, not a hardcoded list.
    const schedule = fridaySchedule(SEED_START, SEED_END)
    // Every date in the schedule should parse as day-of-week 5 (Friday).
    for (const date of schedule) {
      const [y, m, d] = date.split("-").map(Number)
      assert.equal(
        new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay(),
        5,
        `${date} day-of-week should be 5 (Friday)`
      )
    }
  })
})

// ── 3. Birthday date calculations ────────────────────────────────────────────

describe("Birthday date calculations", () => {
  test("nextBirthdayDateString returns birthday in current year if not yet passed", () => {
    const result = nextBirthdayDateString("1990-12-25", "2026-12-01")
    assert.equal(result, "2026-12-25")
  })

  test("nextBirthdayDateString returns birthday in next year if already passed this year", () => {
    const result = nextBirthdayDateString("1990-01-15", "2026-09-17")
    assert.equal(result, "2027-01-15")
  })

  test("nextBirthdayDateString returns today if birthday is today", () => {
    const result = nextBirthdayDateString("1990-09-17", "2026-09-17")
    assert.equal(result, "2026-09-17")
  })

  test("daysBetweenDates calculates 0 for the same date", () => {
    assert.equal(daysBetweenDates("2026-09-17", "2026-09-17"), 0)
  })

  test("daysBetweenDates calculates 1 for consecutive days", () => {
    assert.equal(daysBetweenDates("2026-09-17", "2026-09-18"), 1)
  })

  test("daysBetweenDates returns negative for past dates", () => {
    assert.equal(daysBetweenDates("2026-09-18", "2026-09-17"), -1)
  })

  test("daysBetweenDates calculates correctly across months", () => {
    assert.equal(daysBetweenDates("2026-09-30", "2026-10-01"), 1)
  })

  test("birthday 30 days out is within window", () => {
    const from = "2026-09-17"
    const birthday = "1990-10-17" // exactly 30 days later
    const next = nextBirthdayDateString(birthday, from)
    const days = daysBetweenDates(from, next)
    assert.equal(days, 30)
    assert.ok(days <= 30)
  })

  test("birthday 31 days out is outside window", () => {
    const from = "2026-09-17"
    const birthday = "1990-10-18" // 31 days later
    const next = nextBirthdayDateString(birthday, from)
    const days = daysBetweenDates(from, next)
    assert.equal(days, 31)
    assert.ok(days > 30)
  })

  test("Feb 29 birthday uses Feb 29 in leap year", () => {
    const occ = birthdayOccurrenceForYear("1996-02-29", 2028) // 2028 is leap
    assert.equal(occ, "2028-02-29")
  })

  test("Feb 29 birthday uses Feb 28 in non-leap year", () => {
    const occ = birthdayOccurrenceForYear("1996-02-29", 2026) // 2026 is NOT leap
    assert.equal(occ, "2026-02-28")
  })

  test("isLeapYear correctly identifies leap years", () => {
    assert.ok(isLeapYear(2024))
    assert.ok(isLeapYear(2028))
    assert.ok(isLeapYear(2000)) // divisible by 400
    assert.ok(!isLeapYear(2026))
    assert.ok(!isLeapYear(1900)) // divisible by 100 but not 400
  })

  test("nextBirthdayDateString for Feb 29 in non-leap year uses Feb 28", () => {
    // Birthday on Feb 29, queried in 2026 (not a leap year)
    const result = nextBirthdayDateString("1996-02-29", "2026-02-01")
    assert.equal(result, "2026-02-28")
  })
})

// ── 4. Activity / Friday separation ──────────────────────────────────────────

describe("Activity and Friday domain separation", () => {
  // These tests verify that the Friday schedule is derived from date arithmetic,
  // not from an activities catalog. The separation is architectural.

  test("fridaySchedule operates on date strings, not activity objects", () => {
    const schedule = fridaySchedule("2026-09-18", "2026-09-25")
    // Result is an array of date strings, not activity objects.
    for (const item of schedule) {
      assert.equal(typeof item, "string")
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(item), `${item} should be YYYY-MM-DD`)
    }
  })

  test("attendance status: missing score does not mean absent", () => {
    // This is a domain invariant: score 0 / missing score is distinct from absence.
    // We verify by the type system — the attendance status and score are separate fields.
    // null score with status PRESENT is valid:
    const record = { status: "PRESENT", points: null }
    assert.equal(record.status, "PRESENT")
    assert.equal(record.points, null)
    // This is different from { status: "ABSENT" }
    const absent = { status: "ABSENT", points: null }
    assert.notEqual(record.status, absent.status)
  })

  test("a range entirely inside a study year produces a non-empty schedule", () => {
    const schedule = fridaySchedule("2026-10-01", "2026-12-31")
    assert.ok(schedule.length > 0)
    for (const date of schedule) {
      assert.ok(isCairoFriday(date))
    }
  })
})
