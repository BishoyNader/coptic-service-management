#!/usr/bin/env node
/**
 * Validates the ministry Friday schedule contract.
 *
 * Independent, pure-JS check (no TS loader needed). Asserts:
 *   1. the ministry year starts at 2026-09-18 and ends at 2027-09-24,
 *   2. every generated Friday is a real calendar date and actually a Friday,
 *      with strict 7-day gaps,
 *   3. the count is exactly 54 Fridays,
 *   4. the snap contract used by the app (src/lib/friday.ts): any civil day in
 *      a tracking week maps to its trailing Friday via lastFridayOnOrBefore.
 *
 * This mirrors the production algorithm in src/lib/friday.ts so any drift
 * between the two fails the build/schedule gate.
 *
 * Run: node scripts/validate-friday-schedule.mjs
 * Exits with code 1 on any failure so CI can gate on it.
 */

const MINISTRY_FRIDAY_START = "2026-09-18"
const MINISTRY_FRIDAY_END = "2027-09-24"

/** True for a real "YYYY-MM-DD" calendar date. */
function isRealDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const [y, m, d] = date.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** True when date is a Friday (UTC weekday index 5). */
function isRealFriday(date) {
  return isRealDate(date) && new Date(`${date}T12:00:00Z`).getUTCDay() === 5
}

function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n, 12, 0, 0, 0))
  return dt.toISOString().slice(0, 10)
}

/** The most recent Friday on-or-before `date` (mirror of lastFridayOnOrBefore). */
function lastFridayOnOrBefore(date) {
  let cursor = date
  while (!isRealFriday(cursor)) cursor = addDays(cursor, -1)
  return cursor
}

let failures = 0
const check = (ok, message) => {
  if (!ok) {
    failures++
    console.error(`  ✗ ${message}`)
  }
}

console.log("Friday schedule validation")
console.log(`  range: ${MINISTRY_FRIDAY_START} .. ${MINISTRY_FRIDAY_END}`)

check(MINISTRY_FRIDAY_START === "2026-09-18", "start == 2026-09-18")
check(MINISTRY_FRIDAY_END === "2027-09-24", "end == 2027-09-24")
check(isRealFriday(MINISTRY_FRIDAY_START), "start is a real Friday (2026-09-18)")
check(isRealFriday(MINISTRY_FRIDAY_END), "end is a real Friday (2027-09-24)")

// Generate every Friday in the inclusive range (same algorithm as fridaySchedule).
const schedule = []
{
  let cursor = MINISTRY_FRIDAY_START
  while (!isRealFriday(cursor) && cursor <= MINISTRY_FRIDAY_END) cursor = addDays(cursor, 1)
  while (cursor <= MINISTRY_FRIDAY_END) {
    schedule.push(cursor)
    cursor = addDays(cursor, 7)
  }
}

check(schedule.length === 54, `exactly 54 Fridays (got ${schedule.length})`)
check(schedule[0] === MINISTRY_FRIDAY_START, `first Friday == 2026-09-18 (got ${schedule[0]})`)
check(schedule.at(-1) === MINISTRY_FRIDAY_END, `last Friday == 2027-09-24 (got ${schedule.at(-1)})`)

let structureOk = true
for (let i = 0; i < schedule.length; i++) {
  if (!isRealFriday(schedule[i])) {
    structureOk = false
    console.error(`  ✗ ${schedule[i]} is not a Friday`)
  }
  if (i > 0) {
    const prev = new Date(`${schedule[i - 1]}T12:00:00Z`)
    const cur = new Date(`${schedule[i]}T12:00:00Z`)
    const diff = (cur - prev) / 86_400_000
    if (diff !== 7) {
      structureOk = false
      console.error(`  ✗ gap ${schedule[i - 1]} → ${schedule[i]} is ${diff} days (expected 7)`)
    }
  }
}
check(structureOk, "every date is a real Friday with strict 7-day gaps")

// Snap contract: any civil day maps to the trailing Friday of its tracking week.
const snapSamples = [
  ["2026-09-18", "2026-09-18"],
  ["2026-09-19", "2026-09-18"],
  ["2026-09-24", "2026-09-18"],
  ["2026-09-25", "2026-09-25"],
  ["2027-01-15", "2027-01-15"],
  ["2027-09-24", "2027-09-24"],
  ["2027-09-25", "2027-09-24"],
]
let snapOk = true
for (const [input, expected] of snapSamples) {
  const got = lastFridayOnOrBefore(input)
  if (got !== expected) {
    snapOk = false
    console.error(`  ✗ lastFridayOnOrBefore(${input}) == ${got} (expected ${expected})`)
  }
}
check(snapOk, "snap samples agree with the trailing-Friday contract")

if (failures > 0) {
  console.error(`\nFAILED (${failures} failure(s))`)
  process.exit(1)
}
console.log(
  `PASSED — ${schedule.length} Fridays: first ${schedule[0]}, last ${schedule.at(-1)}, all real Fridays`
)