/**
 * Attendance scoring rules engine.
 *
 * Pure, side-effect free: given an attendance type, the exact attendance
 * instant, the stored SIMPLE rules, and the person's role, it decides which
 * rule (if any) applies and how many points are earned.
 *
 * It intentionally imports nothing from the Supabase/Next.js stack so it can
 * also run inside Node-only tests with a deterministic clock.
 *
 * Points are NEVER computed inside React components — the client only renders
 * whatever this engine (driven server-side) decides.
 */
import type { AttendanceType, ScoringRule } from "../lib/types"
import type { ScoringCategory } from "../lib/constants"
import { cairoTimeString } from "../lib/cairo"

export const CATEGORY_BY_ATTENDANCE: Record<AttendanceType, ScoringCategory> = {
  CHURCH: "CHURCH_ATTENDANCE",
  SERVICE: "SERVICE_ATTENDANCE",
}

export function attendanceCategory(type: AttendanceType): ScoringCategory {
  return CATEGORY_BY_ATTENDANCE[type]
}

export type AttendanceRuleResolution = {
  /** Points for the check-in (0 = outside any scoring window). */
  points: number
  /** The matching rule, or null when the check-in is outside scoring windows. */
  rule: Pick<
    ScoringRule,
    "id" | "category" | "name" | "point_value" | "start_time" | "end_time"
  > | null
}

/**
 * Resolves the applicable scoring band for a given attendance instant.
 *
 * Rule semantics (bands are half-open [start, end)):
 *   - start + end            → start <= t < end
 *   - start only             → t >= start
 *   - end only               → t < end
 *   - neither (flat rule)    → always applies
 *
 * Only the earliest matching band matters (sort_order ascending). When no
 * band matches the person either checked in outside the scoring window or
 * the category carries no rules for their role → 0 points.
 */
export function resolveAttendanceBand(
  type: AttendanceType,
  attendedAt: Date,
  rules: ScoringRule[],
  role: string
): AttendanceRuleResolution {
  const category = CATEGORY_BY_ATTENDANCE[type]
  const time = cairoTimeString(attendedAt)

  const candidates = rules
    .filter(
      (r) =>
        r.category === category &&
        r.is_active &&
        ((r.applicable_role as string[]) ?? []).includes(role)
    )
    .slice()
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        (a.start_time ?? "").localeCompare(b.start_time ?? "")
    )

  for (const rule of candidates) {
    const start = rule.start_time
    const end = rule.end_time
    let matches: boolean
    if (start === null && end === null) {
      matches = true
    } else if (start !== null && end !== null) {
      matches = time >= start && time < end
    } else if (start !== null) {
      matches = time >= start
    } else {
      matches = time < (end as string)
    }

    if (matches) {
      return {
        points: Number(rule.point_value),
        rule: {
          id: rule.id,
          category: rule.category,
          name: rule.name,
          point_value: rule.point_value,
          start_time: rule.start_time,
          end_time: rule.end_time,
        },
      }
    }
  }

  return { points: 0, rule: null }
}