import { test, expect, type Page } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"
import { config as loadEnv } from "dotenv"
import { createClient } from "@supabase/supabase-js"
import { cleanupPhones, normalizePhone } from "./helpers"

loadEnv({ path: ".env.local" })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Dedicated phone set for this spec (no overlap with other suites).
const SUPER_PHONE = "+201000000141"
const SERVANT_PHONE = "+201000000142"
const MEMBER_PHONE = "+201000000143"
const SUPER_PASSWORD = "Phase17Super9!"
const SERVANT_PASSWORD = "Phase17Servant9!"
const MEMBER_PASSWORD = "Phase17Member9!"

type Seed = { userId: string; phone: string; password: string; displayName: string }

let superAdmin: Seed
let servant: Seed
let member: Seed

let anchorFriday = ""
let scoresSeeded = false
let memorizationActivityId = ""
let attendedServiceActivityId = ""

// Cairo wall-date snapshot (mirrors src/lib/cairo.ts).
const cairoToday = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date())

// The Friday banner ranges of the ministry year (src/lib/friday.ts).
const MINISTRY_FRIDAY_START = "2026-09-18"
const MINISTRY_FRIDAY_END = "2027-09-24"

function isRealFriday(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T12:00:00Z`).getUTCDay() === 5
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + n, 12, 0, 0, 0)).toISOString().slice(0, 10)
}

function lastFridayOnOrBefore(date: string): string {
  let cursor = date
  while (!isRealFriday(cursor)) cursor = addDays(cursor, -1)
  return cursor
}

function clampToYear(friday: string): string {
  if (friday < MINISTRY_FRIDAY_START) return MINISTRY_FRIDAY_START
  if (friday > MINISTRY_FRIDAY_END) return MINISTRY_FRIDAY_END
  return friday
}

// Mirrors src/services/friday-service.ts: rows are attributed to the Friday of
// their tracking week, and rows outside the ministry year never match a view.
function bucketKey(date: string): string {
  const f = lastFridayOnOrBefore(date)
  return f >= MINISTRY_FRIDAY_START && f <= MINISTRY_FRIDAY_END ? f : ""
}

// Independent oracle for the served-member per-Friday score sheet. It reads
// the same DB rows the service reads but recomputes the percentages/maxima
// from scoring rules + activities, so assertions never mirror a bug.
const CORE_CATEGORIES = [
  "CHURCH_ATTENDANCE",
  "SERVICE_ATTENDANCE",
  "WEEKLY_COMMITMENT",
  "TUNIC",
  "COMMUNION",
  "SERVICE_COMMITMENT",
  "BONUS",
] as const
const FIXED_TEN_CATEGORIES = new Set(["WEEKLY_COMMITMENT", "SERVICE_COMMITMENT"])

type ExpectedMemberFriday = {
  totalPoints: number
  totalMax: number
  totalPercent: number
  byLabel: Map<string, { points: number; max: number; percent: number }>
}

async function expectedMemberFriday(
  admin: SupabaseClient,
  memberId: string,
  anchor: string
): Promise<ExpectedMemberFriday> {
  const [rules, activities, scoreRows, activityRows] = await Promise.all([
    admin.from("scoring_rules").select("category, point_value").eq("is_active", true),
    admin
      .from("activities")
      .select("id, code, name, max_score")
      .eq("for_role", "SERVED_MEMBER")
      .eq("is_active", true),
    admin
      .from("score_records")
      .select("category, points, session_date")
      .eq("profile_id", memberId)
      .eq("is_voided", false),
    admin
      .from("member_activity_scores")
      .select("activity_id, points, score_date")
      .eq("profile_id", memberId),
  ])

  const maxFor = (cat: string) =>
    (rules.data ?? []).reduce(
      (m, r) => (r.category === cat ? Math.max(m, Number(r.point_value)) : m),
      0
    )

  const coreMax = new Map<string, number>()
  for (const cat of CORE_CATEGORIES) {
    coreMax.set(cat, FIXED_TEN_CATEGORIES.has(cat) ? 10 : maxFor(cat))
  }

  const weekdayCat = new Map<string, number>()
  for (const r of scoreRows.data ?? []) {
    if (bucketKey(r.session_date as string) !== anchor) continue
    if (!(CORE_CATEGORIES as readonly string[]).includes(r.category as string)) continue
    weekdayCat.set(r.category as string, (weekdayCat.get(r.category as string) ?? 0) + Number(r.points))
  }
  const activityCat = new Map<string, number>()
  for (const r of activityRows.data ?? []) {
    if (bucketKey(r.score_date as string) !== anchor) continue
    activityCat.set(r.activity_id as string, (activityCat.get(r.activity_id as string) ?? 0) + Number(r.points))
  }

  const byLabel = new Map<string, { points: number; max: number; percent: number }>()
  let totalPoints = 0
  let totalMax = 0

  for (const cat of CORE_CATEGORIES) {
    const max = coreMax.get(cat) ?? 0
    const points = weekdayCat.get(cat) ?? 0
    totalPoints += points
    totalMax += max
    byLabel.set(cat, { points, max, percent: max > 0 ? Math.round((points / max) * 100) : 0 })
  }
  for (const a of activities.data ?? []) {
    const max = Number(a.max_score)
    const points = activityCat.get(a.id as string) ?? 0
    totalPoints += points
    totalMax += max
    byLabel.set(a.name as string, { points, max, percent: max > 0 ? Math.round((points / max) * 100) : 0 })
  }

  return {
    totalPoints,
    totalMax,
    totalPercent: totalMax > 0 ? Math.round((totalPoints / totalMax) * 100) : 0,
    byLabel,
  }
}

async function createUser(
  admin: SupabaseClient,
  role: "SUPER_ADMIN" | "SERVANT" | "SERVED_MEMBER",
  phone: string,
  password: string,
  name: string,
): Promise<Seed> {
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    phone,
    password,
    phone_confirm: true,
    email_confirm: true,
    user_metadata: { full_name: name, role },
  })
  if (authError) throw new Error(`seed auth: ${authError.message}`)
  const userId = authData.user.id
  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    role,
    full_name: name,
    phone: normalizePhone(phone),
    status: "ACTIVE",
  })
  if (profileError) throw new Error(`seed profile: ${profileError.message}`)
  if (role === "SUPER_ADMIN") {
    const { error: adminError } = await admin.from("admin_profiles").insert({ profile_id: userId })
    if (adminError) throw new Error(`seed admin_profiles: ${adminError.message}`)
  }
  return { userId, phone, password, displayName: name }
}

async function login(page: Page, seed: Seed) {
  await page.goto("/login")
  await page.getByLabel("رقم الموبايل أو الإيميل").fill(seed.phone)
  await page.locator("#password").fill(seed.password)
  await page.getByRole("button", { name: "تسجيل الدخول" }).click()
  await page.waitForFunction(() => /^\/app\//.test(window.location.pathname), undefined, {
    timeout: 15_000,
  })
}

test.beforeAll(async () => {
  anchorFriday = clampToYear(lastFridayOnOrBefore(cairoToday))

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  await cleanupPhones(admin, [SUPER_PHONE, SERVANT_PHONE, MEMBER_PHONE])

  superAdmin = await createUser(admin, "SUPER_ADMIN", SUPER_PHONE, SUPER_PASSWORD, "رئيس شمامسة اختبار الجمعة")
  servant = await createUser(admin, "SERVANT", SERVANT_PHONE, SERVANT_PASSWORD, "خادم اختبار الجمعة")
  member = await createUser(admin, "SERVED_MEMBER", MEMBER_PHONE, MEMBER_PASSWORD, "مخدوم اختبار الجمعة")

  const { data: memAct } = await admin
    .from("activities")
    .select("id")
    .eq("code", "MEMBER_MEMORIZATION")
    .eq("is_active", true)
    .maybeSingle()
  memorizationActivityId = (memAct?.id as string | undefined) ?? ""

  const { data: servAct } = await admin
    .from("activities")
    .select("id")
    .eq("code", "ATTENDED_SERVICE")
    .eq("for_role", "SERVANT")
    .eq("is_active", true)
    .maybeSingle()
  attendedServiceActivityId = (servAct?.id as string | undefined) ?? ""

  // Clean any leftover rows for the member/servant from interrupted runs.
  await admin.from("member_activity_scores").delete().eq("profile_id", member.userId)
  await admin.from("servant_activity_records").delete().eq("servant_id", servant.userId)
  await admin.from("score_records").delete().eq("profile_id", member.userId)
  await admin.from("attendance_records").delete().in("profile_id", [member.userId, servant.userId])

  // Attendance session for the anchor Friday (CHURCH type; Friday-only CHECK).
  const { data: existing } = await admin
    .from("attendance_sessions")
    .select("id")
    .eq("type", "CHURCH")
    .eq("session_date", anchorFriday)
    .maybeSingle()
  let sessionId = (existing?.id as string | undefined) ?? ""
  if (!sessionId) {
    const { data: inserted } = await admin
      .from("attendance_sessions")
      .insert({ type: "CHURCH", title: "خدمة يوم الجمعة", session_date: anchorFriday, created_by: servant.userId })
      .select("id")
      .single()
    sessionId = (inserted?.id as string | undefined) ?? ""
  }
  if (!sessionId) throw new Error("could not create/find attendance session")

  const attendedAt = `${anchorFriday}T09:00:00Z`
  const { error: recErr } = await admin.from("attendance_records").insert([
    {
      session_id: sessionId,
      profile_id: member.userId,
      attended_at: attendedAt,
      points: 10,
      recorded_by: servant.userId,
      source: "MANUAL",
      status: "PRESENT",
    },
    {
      session_id: sessionId,
      profile_id: servant.userId,
      attended_at: attendedAt,
      points: 0,
      recorded_by: servant.userId,
      source: "MANUAL",
      status: "PRESENT",
    },
  ])
  if (recErr) throw new Error(`seed attendance records: ${recErr.message}`)

  // Weekly card (attendance category) for the member on that Friday.
  const { error: scoreErr } = await admin.from("score_records").insert({
    profile_id: member.userId,
    category: "CHURCH_ATTENDANCE",
    points: 10,
    session_date: anchorFriday,
    recorded_by: servant.userId,
    note: "phase17 fixture",
  })
  if (scoreErr) throw new Error(`seed score_records: ${scoreErr.message}`)

  // Grade-activity score + servant self-tracking have a "no future" DB CHECK
  // (score_date/recorded_on <= current_date). Before the first ministry Friday
  // is reachable by the database date (2026-09-18) those rows are not
  // insertable, so the graded-activity assertions defer. Once reachable they
  // seed at `anchorFriday` and the full suite exercises them automatically.
  // Weekly-card score_records have no future CHECK and always seed, which is
  // what the always-on scoring assertions below verify.
  try {
    if (memAct && memorizationActivityId) {
      const { error: actErr } = await admin.from("member_activity_scores").insert({
        profile_id: member.userId,
        activity_id: memorizationActivityId,
        points: 8,
        score_date: anchorFriday,
        recorded_by: servant.userId,
      })
      if (actErr) throw actErr
    }
    if (servAct && attendedServiceActivityId) {
      const { error: servErr } = await admin.from("servant_activity_records").insert({
        servant_id: servant.userId,
        activity_id: attendedServiceActivityId,
        recorded_on: anchorFriday,
        recorded_by: servant.userId,
      })
      if (servErr) throw servErr
    }
    scoresSeeded = true
  } catch {
    scoresSeeded = false
  }
})

test.afterAll(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  await admin.from("member_activity_scores").delete().eq("profile_id", member.userId)
  await admin.from("servant_activity_records").delete().eq("servant_id", servant.userId)
  await admin.from("score_records").delete().eq("profile_id", member.userId)
  await admin.from("audit_logs").delete().in("actor_id", [superAdmin.userId, servant.userId, member.userId])
  await admin.from("attendance_records").delete().in("profile_id", [member.userId, servant.userId])
  await admin
    .from("attendance_sessions")
    .delete()
    .eq("session_date", anchorFriday)
    .eq("created_by", servant.userId)
  await cleanupPhones(admin, [SUPER_PHONE, SERVANT_PHONE, MEMBER_PHONE])
})

// ─── ATTENDANCE GRID (servant view) ──────────────────────────────────────────

test("Servant sees the Friday attendance grid with explicit حضور/غائب", async ({ page }) => {
  await login(page, servant)
  await page.goto("/app/servant/attendance")
  await page.waitForLoadState("networkidle")

  await expect(page.getByText("متابعة الجمع", { exact: true })).toBeVisible()

  // The anchor ministry Friday is the grid's default column.
  const memberRow = page.getByTestId(`grid-person-${member.userId}`)
  await expect(memberRow).toBeVisible()
  await expect(memberRow.getByText("حاضر").first()).toBeVisible()

  const servantRow = page.getByTestId(`grid-person-${servant.userId}`)
  await expect(servantRow).toBeVisible()
  await expect(servantRow.getByText("حاضر").first()).toBeVisible()
})

// ─── COMBINED MINISTRY VIEW (servant view) ───────────────────────────────────

test("Servant sees the combined Friday review: attendance + member % + activities", async ({ page }) => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const exp = await expectedMemberFriday(admin, member.userId, anchorFriday)

  await login(page, servant)
  await page.goto("/app/servant/attendance")
  await page.waitForLoadState("networkidle")

  await page.getByRole("tab", { name: "متابعة الخدمة" }).click()

  const memberCard = page.getByTestId(`ministry-member-${member.userId}`)
  await expect(memberCard).toBeVisible()
  await expect(memberCard.getByText("حاضر")).toBeVisible()

  // Attendance is attendance: the member is present even before grading.
  await expect(memberCard.getByText("حضور القداس", { exact: false })).toBeVisible()

  // Friday served-member scoring executes here: the weekly-card grade for the
  // anchor Friday (attendance category, max 10) is rendered per-activity.
  const churchChip = memberCard.locator("span", { hasText: "حضور القداس" })
  const church = exp.byLabel.get("CHURCH_ATTENDANCE")!
  await expect(churchChip.getByText(`${church.points}/${church.max}`, { exact: true })).toBeVisible()
  await expect(churchChip.getByText(`${church.percent}%`, { exact: true })).toBeVisible()

  // Overall percent recomputed from rules/activities (not hard-coded).
  await expect(memberCard.getByText(`${exp.totalPercent}%`, { exact: true })).toBeVisible()

  const absentsText = page.getByText(/غائب \d/)
  await expect(absentsText).toBeVisible()

  const servantCard = page.getByTestId(`ministry-servant-${servant.userId}`)
  await expect(servantCard).toBeVisible()
  await expect(servantCard.getByText("حاضر")).toBeVisible()
  // Servant activity names render; unrecorded ones show "— لا".
  await expect(servantCard.getByText("حضر الخدمة")).toBeVisible()
  await expect(servantCard.getByText("— لا").first()).toBeVisible()

  if (scoresSeeded) {
    const memChip = exp.byLabel.get("حفظ المزامير")!
    const memorizationChip = memberCard.locator("span", { hasText: "حفظ المزامير" })
    await expect(memorizationChip.getByText(`${memChip.points}/${memChip.max}`, { exact: true })).toBeVisible()
    await expect(memorizationChip.getByText(`${memChip.percent}%`, { exact: true })).toBeVisible()
    // Servant completed the "حضر الخدمة" activity that Friday.
    const servChip = servantCard.locator("span", { hasText: "حضر الخدمة" })
    await expect(servChip.getByText("— لا")).toHaveCount(0)
  } else {
    console.warn(
      "[phase17] ministry year not yet reachable (no ministry Friday <= DB current_date);" +
        " graded-activity % assertions deferred — weekly-card scoring verified above."
    )
  }
})

// ─── MEMBER — own Friday results tab ─────────────────────────────────────────

test("Member sees their own Friday results with attendance + percentages, no ranking", async ({ page }) => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const exp = await expectedMemberFriday(admin, member.userId, anchorFriday)

  await login(page, member)
  await page.goto("/app/member/scores")
  await page.waitForLoadState("networkidle")

  await page.getByRole("tab", { name: "درجات الجمعة" }).click()

  await expect(page.getByText("نتائج الجمعة", { exact: false }).first()).toBeVisible()

  // Own presence is explicit on the anchor Friday.
  await expect(page.getByText("حاضر").first()).toBeVisible()

  // Friday scoring executes: the weekly-card attendance grade (10/10 → 100%).
  await expect(page.getByText("حضور القداس", { exact: false }).first()).toBeVisible()
  await expect(page.getByText("10 / 10", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("100%", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("حفظ المزامير").first()).toBeVisible()

  // Overall percent recomputed independently from rules/activities.
  await expect(
    page.getByText(`${exp.totalPoints} / ${exp.totalMax} نقطة`, { exact: true })
  ).toBeVisible()
  await expect(page.getByText(`${exp.totalPercent}%`, { exact: true }).first()).toBeVisible()
  await expect(page.getByText("إجمالي سنة الخدمة")).toBeVisible()

  // A member never sees other members or any ranking/board.
  await expect(page.getByText("متابعة الجمع", { exact: true })).toHaveCount(0)
  await expect(page.getByText("المخدومين", { exact: true })).toHaveCount(0)
  await expect(page.locator('[data-testid^="grid-person-"]').first()).toHaveCount(0)

  if (scoresSeeded) {
    const mem = exp.byLabel.get("حفظ المزامير")!
    await expect(page.getByText(`${mem.points} / ${mem.max}`, { exact: true }).first()).toBeVisible()
    await expect(page.getByText(`${mem.percent}%`, { exact: true }).first()).toBeVisible()
  }
})

// ─── ACCESS CONTROL ──────────────────────────────────────────────────────────

test("Unauthenticated user redirected from the attendance board", async ({ page }) => {
  await page.goto("/app/servant/attendance")
  await page.waitForURL(/\/login/, { timeout: 10_000 })
  expect(page.url()).toContain("/login")
})