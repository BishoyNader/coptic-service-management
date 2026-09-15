import { test, expect } from "@playwright/test"
import {
  resolveAttendanceBand,
  attendanceCategory,
} from "../src/services/attendance-rules"
import type { AttendanceType, ScoringRule } from "../src/lib/types"

/**
 * Deterministic tests for the attendance scoring engine.
 *
 * The engine is a pure function of (type, exact instant, SIMPLE rules, role),
 * so we drive every time window with a FIXED clock instead of the real one.
 * The production check-in path keeps using verified DB-backed server time.
 */

function makeRule(
  id: string,
  category: ScoringRule["category"],
  pointValue: number,
  start: string | null,
  end: string | null,
  sortOrder: number
): ScoringRule {
  return {
    id,
    category,
    name: `rule-${id}`,
    point_value: pointValue,
    applicable_role: ["SERVED_MEMBER"],
    start_time: start,
    end_time: end,
    requires_min_days: null,
    is_active: true,
    sort_order: sortOrder,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  }
}

/** Mirror of the production seeding (see 20260920000000_attendance_divisions.sql). */
const RULES: ScoringRule[] = [
  makeRule("c1", "CHURCH_ATTENDANCE", 10, "07:00", "07:45", 10),
  makeRule("c2", "CHURCH_ATTENDANCE", 8, "07:45", "08:15", 20),
  makeRule("c3", "CHURCH_ATTENDANCE", 6, "08:15", "08:40", 30),
  makeRule("c4", "CHURCH_ATTENDANCE", 4, "08:40", "09:40", 40),
  makeRule("s1", "SERVICE_ATTENDANCE", 10, "10:30", "11:00", 10),
  makeRule("s2", "SERVICE_ATTENDANCE", 5, "11:00", null, 20),
]

/**
 * Cairo is permanently UTC+2, but we derive the offset at runtime so the
 * fixture instants are exact regardless of any (hypothetical) DST shift.
 */
const cairoOffsetMs = (() => {
  const probe = new Date(Date.UTC(2026, 0, 15, 12, 0, 0)) // noon UTC
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(probe)
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0")
  return (hour - 12) * 3_600_000
})()

/** The UTC instant whose Cairo wall clock reads HH:MM on 2026-01-15. */
function cairoInstant(hour: number, minute: number): Date {
  return new Date(Date.UTC(2026, 0, 15, hour, minute, 0) - cairoOffsetMs)
}

function expectWindow(
  type: AttendanceType,
  hour: number,
  minute: number,
  expectedPoints: number
) {
  const { points, rule } = resolveAttendanceBand(type, cairoInstant(hour, minute), RULES, "SERVED_MEMBER")
  expect(
    points,
    `Cairo ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} (${type})`
  ).toBe(expectedPoints)
  if (expectedPoints > 0) {
    expect(rule).not.toBeNull()
  } else {
    expect(rule).toBeNull()
  }
}

test.describe("Attendance scoring bands (Cairo wall clock)", () => {
  test("church: باكر 07:00-07:45 → 10 points", () => {
    expectWindow("CHURCH", 7, 0, 10)
    expectWindow("CHURCH", 7, 30, 10)
    expectWindow("CHURCH", 7, 44, 10)
  })

  test("church: تقديم الحمل 07:45-08:15 → 8 points", () => {
    expectWindow("CHURCH", 7, 45, 8)
    expectWindow("CHURCH", 8, 0, 8)
    expectWindow("CHURCH", 8, 14, 8)
  })

  test("church: تحليل الخدام 08:15-08:40 → 6 points", () => {
    expectWindow("CHURCH", 8, 15, 6)
    expectWindow("CHURCH", 8, 30, 6)
    expectWindow("CHURCH", 8, 39, 6)
  })

  test("church: الإنجيل 08:40-09:40 → 4 points", () => {
    expectWindow("CHURCH", 8, 40, 4)
    expectWindow("CHURCH", 9, 0, 4)
    expectWindow("CHURCH", 9, 39, 4)
  })

  test("church: before 07:00 and after 09:40 → 0 points", () => {
    expectWindow("CHURCH", 6, 59, 0)
    expectWindow("CHURCH", 5, 0, 0)
    expectWindow("CHURCH", 9, 40, 0)
    expectWindow("CHURCH", 12, 0, 0)
    expectWindow("CHURCH", 18, 0, 0)
  })

  test("service: 10:30-11:00 → 10 points", () => {
    expectWindow("SERVICE", 10, 30, 10)
    expectWindow("SERVICE", 10, 59, 10)
  })

  test("service: from 11:00 on → 5 points", () => {
    expectWindow("SERVICE", 11, 0, 5)
    expectWindow("SERVICE", 13, 0, 5)
    expectWindow("SERVICE", 23, 59, 5)
  })

  test("service: before 10:30 → 0 points", () => {
    expectWindow("SERVICE", 10, 29, 0)
    expectWindow("SERVICE", 8, 0, 0)
  })

  test("servants NEVER receive attendance points (no applicable rule)", () => {
    for (const [h, m] of [
      [7, 30],
      [8, 10],
      [10, 45],
      [12, 0],
    ] as const) {
      const { points, rule } = resolveAttendanceBand("CHURCH", cairoInstant(h, m), RULES, "SERVANT")
      expect(points).toBe(0)
      expect(rule).toBeNull()
    }
  })

  test("category mapping covers the current attendance types", () => {
    expect(attendanceCategory("CHURCH")).toBe("CHURCH_ATTENDANCE")
    expect(attendanceCategory("SERVICE")).toBe("SERVICE_ATTENDANCE")
  })
})