import { test, expect, type Page } from "@playwright/test"
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"
import { config as loadEnv } from "dotenv"
import { periodForDate, WEEKLY } from "../src/services/scoring-rules"
import {
  calculateScoreBreakdown,
  getActiveScoringRules,
  grantMonthlyActivity,
  upsertManualScore,
} from "../src/services/scoring-service"

/**
 * PHASE 4 — Centralized scoring engine, end to end against a real dev server.
 *
 * Numbering starts at 41 (phase 3 ended at 40). The pure rules are covered
 * deterministically in `e2e/attendance-points.spec.ts`; here we drive the real
 * scoring UI (admin fast entry + member scores page) and assert through THREE
 * layers:
 *
 *   - UI: an admin enters weekly commitment / tunic / communion / service
 *     commitment / bonus and the member sees ready-made breakdowns + totals.
 *   - Service: `upsertManualScore` / `grantMonthlyActivity` enforce the
 *     configured values and the 30-day monthly-activity window with FIXED dates.
 *   - DB/RLS: members can only ever read their own score records; writes are
 *     denied by policy.
 *
 * Test ordering inside this file matters — earlier tests build up the weekly
 * card of the "main member" that later tests verify. Attendance is seeded with
 * times inside the CURRENT Cairo week (never a hardcoded weekday), matching
 * the production attendance engine's banding (church 07:30 → 10pts, service
 * 10:45 → 10pts).
 */

loadEnv({ path: ".env.local" })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function randomPhone(): string {
  return "01" + String(Math.floor(100000000 + Math.random() * 900000000)).padStart(9, "0")
}

function randomCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function randomUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function normalizePhone(phone: string): string {
  const trimmed = phone.trim()
  if (/^\d+$/.test(trimmed)) {
    if (trimmed.startsWith("0")) return trimmed.replace(/^0/, "+20")
    if (trimmed.startsWith("20") && trimmed.length >= 11) return `+${trimmed}`
    return `+${trimmed}`
  }
  return trimmed
}

function cairoToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

async function login(page: Page, phone: string, password: string) {
  await page.goto("/login")
  await page.getByLabel("رقم الموبايل أو الإيميل").fill(phone)
  await page.locator("#password").fill(password)
  await page.getByRole("button", { name: "تسجيل الدخول" }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function logout(page: Page) {
  const btn = page.getByRole("button", { name: /خروج/ })
  if (await btn.first().isVisible()) {
    await btn.first().click()
  }
}

async function createUser(
  admin: SupabaseClient,
  role: "SERVED_MEMBER" | "SERVANT",
  phone: string,
  password: string,
  displayName?: string
) {
  const normalized = normalizePhone(phone)
  const name = displayName ?? (role === "SERVANT" ? "خادم سكور اختبار" : "مخدوم سكور اختبار")

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    phone: normalized,
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
    phone: normalized,
  })
  if (profileError) throw new Error(`seed profile: ${profileError.message}`)

  let code = ""
  for (let attempt = 0; attempt < 5; attempt++) {
    const c = randomCode()
    const { error: pcError } = await admin.from("personal_codes").insert({
      profile_id: userId,
      code: c,
      qr_token: randomUuid(),
    })
    if (!pcError) {
      code = c
      break
    }
    if (attempt === 4) throw new Error(`seed personal_codes: ${pcError.message}`)
  }

  return { userId, phone: normalized, phoneRaw: phone, password, displayName: name, code }
}

async function createAdmin(
  admin: SupabaseClient,
  role: "ADMIN" | "SUPER_ADMIN",
  phone: string,
  password: string
) {
  const normalized = normalizePhone(phone)
  const displayName = role === "SUPER_ADMIN" ? "رئيس سكور اختبار" : "مشرف سكور اختبار"
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    phone: normalized,
    password,
    phone_confirm: true,
    email_confirm: true,
    user_metadata: { full_name: displayName, role },
  })
  if (authError) throw new Error(`seed admin auth: ${authError.message}`)
  const userId = authData.user.id
  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    role,
    full_name: displayName,
    phone: normalized,
  })
  if (profileError) throw new Error(`seed admin profile: ${profileError.message}`)
  const { error: apError } = await admin
    .from("admin_profiles")
    .insert({ profile_id: userId })
  if (apError) throw new Error(`seed admin_profiles: ${apError.message}`)
  return { userId, phone: normalized, phoneRaw: phone, password, displayName }
}

test.describe("PHASE 4 — Centralized scoring engine", () => {
  const createdPhones: string[] = []
  let admin: SupabaseClient
  let adminSeed: Awaited<ReturnType<typeof createAdmin>>
  let superSeed: Awaited<ReturnType<typeof createAdmin>>
  let member: Awaited<ReturnType<typeof createUser>>
  let member2: Awaited<ReturnType<typeof createUser>>
  let servant: Awaited<ReturnType<typeof createUser>>

  const today = cairoToday()
  let weekKey = ""

  async function ensureSession(
    type: "CHURCH" | "SERVICE",
    sessionDate: string
  ): Promise<string> {
    const { data: existing } = await admin
      .from("attendance_sessions")
      .select("id")
      .eq("type", type)
      .eq("session_date", sessionDate)
      .maybeSingle()
    if (existing) return existing.id as string
    const { data, error } = await admin
      .from("attendance_sessions")
      .insert({
        type,
        title: type === "CHURCH" ? "قداس السكور" : "خدمة السكور",
        session_date: sessionDate,
        created_by: superSeed.userId,
      })
      .select("id")
      .single()
    if (error) throw new Error(`ensureSession: ${error.message}`)
    return data.id as string
  }

  /** Mirrors one attendance-engine write (church 10pt / service 10pt). */
  async function seedAttendance(type: "CHURCH" | "SERVICE", profileId: string) {
    const sessionId = await ensureSession(type, today)
    const at =
      type === "CHURCH"
        ? new Date(`${today}T07:30:00+02:00`)
        : new Date(`${today}T10:45:00+02:00`)
    const category = type === "CHURCH" ? "CHURCH_ATTENDANCE" : "SERVICE_ATTENDANCE"

    const { data: rec, error: recError } = await admin
      .from("attendance_records")
      .insert({
        session_id: sessionId,
        profile_id: profileId,
        attended_at: at.toISOString(),
        points: 10,
        recorded_by: superSeed.userId,
        source: "CODE",
        status: "PRESENT",
      })
      .select("id")
      .single()
    if (recError) throw new Error(`seedAttendance record: ${recError.message}`)
    const { error: scoreError } = await admin.from("score_records").insert({
      profile_id: profileId,
      category,
      points: 10,
      attendance_record_id: rec.id as string,
      session_date: today,
      recorded_by: superSeed.userId,
      period_key: weekKey,
    })
    if (scoreError) throw new Error(`seedAttendance score: ${scoreError.message}`)
  }

  async function currentScore(
    profileId: string,
    category: string,
    key = weekKey
  ) {
    const { data } = await admin
      .from("score_records")
      .select("*")
      .eq("profile_id", profileId)
      .eq("category", category)
      .eq("period_key", key)
      .eq("is_voided", false)
    return data ?? []
  }

  async function openScoring(page: Page, url: string, displayName: string) {
    await page.goto(url)
    await expect(page.getByLabel("اختار المخدوم")).toBeVisible()
    await page.getByLabel("اختار المخدوم").selectOption({ label: displayName })
    await expect(page.getByRole("radiogroup", { name: "الالتزام", exact: true })).toBeVisible()
    await expect(page.getByText("حضور القداس (تلقائي)")).toBeVisible()
  }

  async function saveScoring(page: Page) {
    await page.getByRole("button", { name: "حفظ الدرجات" }).click()
    await expect(page.getByText("تم حفظ درجات الأسبوع")).toBeVisible({ timeout: 15_000 })
  }

  test.beforeAll(async () => {
    admin = createSupabaseClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    weekKey = periodForDate(WEEKLY, today).key

    const phones = [randomPhone(), randomPhone(), randomPhone(), randomPhone(), randomPhone()]
    createdPhones.push(...phones)
    const [a, sa, m, m2, s] = await Promise.all([
      createAdmin(admin, "ADMIN", phones[0], "adminpass123"),
      createAdmin(admin, "SUPER_ADMIN", phones[1], "adminpass123"),
      createUser(admin, "SERVED_MEMBER", phones[2], "testpass123", "مخدوم سكور أ"),
      createUser(admin, "SERVED_MEMBER", phones[3], "testpass123", "مخدوم سكور ب"),
      createUser(admin, "SERVANT", phones[4], "testpass123", "خادم سكور اختبار"),
    ])
    adminSeed = a
    superSeed = sa
    member = m
    member2 = m2
    servant = s
  })

  test.afterAll(async () => {
    if (process.env.KEEP_PHASE4_DATA === "1") return
    await cleanupTestData()
  })

  async function cleanupTestData() {
    for (const phone of createdPhones.map(normalizePhone)) {
      const { data } = await admin
        .from("profiles")
        .select("id")
        .eq("phone", phone)
        .maybeSingle()
      if (data) {
        await admin.from("attendance_records").delete().eq("profile_id", data.id)
        await admin.from("score_records").delete().eq("profile_id", data.id)
        await admin.from("audit_logs").delete().eq("actor_id", data.id)
        await admin.auth.admin.deleteUser(data.id)
      }
    }
    const { data: sessions } = await admin
      .from("attendance_sessions")
      .select("id")
      .in("type", ["CHURCH", "SERVICE"])
    const sessionIds = (sessions ?? []).map((s) => s.id as string)
    if (sessionIds.length) {
      const { data: used } = await admin
        .from("attendance_records")
        .select("session_id")
        .in("session_id", sessionIds)
      const usedIds = new Set((used ?? []).map((u) => u.session_id as string))
      const orphans = sessionIds.filter((id) => !usedIds.has(id))
      if (orphans.length) {
        await admin.from("attendance_sessions").delete().in("id", orphans)
      }
    }
  }

  // 41. A member without any scores sees the exact empty state (no fake data).
  test("41. Member scores page shows empty states before any scoring", async ({ page }) => {
    await login(page, member2.phone, member2.password)
    await page.goto("/app/member/scores")
    await expect(page.getByText("درجاتي")).toBeVisible()
    await expect(page.getByText("لسه مفيش درجات للأسبوع ده")).toBeVisible()
    await expect(page.getByText("لم يتم تسجيل التقييم بعد")).toBeVisible()
    await page.getByRole("tab", { name: "هذا الشهر" }).click()
    await expect(page.getByText("لسه مفيش درجات للشهر ده")).toBeVisible()
  })

  // 42. Member views the weekly breakdown an admin entered.
  test("42. Admin enters a commitment and the member sees the weekly score", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await openScoring(page, "/app/admin/scores", member.displayName)
    await page.getByRole("radio", { name: "الالتزام 3", exact: true }).click()
    await saveScoring(page)
    await expect
      .poll(
        async () => {
          const rows = await currentScore(member.userId, "WEEKLY_COMMITMENT")
          return rows.length ? Number(rows[0].points) : null
        },
        { timeout: 10_000 }
      )
      .toBe(3)

    await logout(page)
    await login(page, member.phone, member.password)
    await page.goto("/app/member/scores")
    await expect(page.getByText("الالتزام", { exact: true })).toBeVisible()
    await expect(page.getByText("3 نقطة")).toBeVisible()
  })

  // 43. Monthly activity shows up on the MONTH tab only (never the weekly one).
  test("43. Monthly activity appears in the monthly view and is excluded from weekly", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await openScoring(page, "/app/admin/scores", member.displayName)
    await page.getByRole("button", { name: /تسجيل نشاط شهري/ }).click()
    await expect(page.getByText("تم تسجيل النشاط الشهري")).toBeVisible({ timeout: 15_000 })

    await logout(page)
    await login(page, member.phone, member.password)
    await page.goto("/app/member/scores")
    await page.getByRole("tab", { name: "هذا الشهر" }).click()
    await expect(page.getByText("نشاط", { exact: true })).toBeVisible()
    await expect(page.getByText("+20")).toBeVisible()
    await page.getByRole("tab", { name: "هذا الأسبوع" }).click()
    await expect(page.getByText("نشاط", { exact: true })).toHaveCount(0)
  })

  // 44. Admin fast entry: commitment values persist (0–10).
  test("44. Admin sets a commitment of 7 for the week", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await openScoring(page, "/app/admin/scores", member.displayName)
    await page.getByRole("radio", { name: "الالتزام 7", exact: true }).click()
    await saveScoring(page)
    await expect
      .poll(
        async () => {
          const rows = await currentScore(member.userId, "WEEKLY_COMMITMENT")
          return rows.length ? Number(rows[0].points) : null
        },
        { timeout: 10_000 }
      )
      .toBe(7)
  })

  // 45. The engine refuses commitments outside 0–10 (service + UI check).
  test("45. Commitment values outside 0-10 are rejected by the engine", async ({ page }) => {
    const tooHigh = await upsertManualScore(admin, {
      actorId: superSeed.userId,
      profileId: member.userId,
      category: "WEEKLY_COMMITMENT",
      refDate: today,
      points: 11,
    })
    expect(tooHigh.ok).toBe(false)
    expect(tooHigh.message).toContain("0 لـ 10")
    const negative = await upsertManualScore(admin, {
      actorId: superSeed.userId,
      profileId: member.userId,
      category: "WEEKLY_COMMITMENT",
      refDate: today,
      points: -1,
    })
    expect(negative.ok).toBe(false)

    await login(page, adminSeed.phone, adminSeed.password)
    await openScoring(page, "/app/admin/scores", member.displayName)
    await expect(
      page.getByRole("radiogroup", { name: "الالتزام", exact: true }).getByRole("radio")
    ).toHaveCount(11)
  })

  // 46. Tunic checkbox grants the exact configured value (5).
  test("46. Admin checks tunic and it persists the configured value", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await openScoring(page, "/app/admin/scores", member.displayName)
    await page.getByRole("checkbox", { name: "لبس التونية" }).check()
    await saveScoring(page)
    await expect
      .poll(
        async () => {
          const rows = await currentScore(member.userId, "TUNIC")
          return rows.length ? Number(rows[0].points) : null
        },
        { timeout: 10_000 }
      )
      .toBe(5)
  })

  // 47. Checkbox categories are configurable — the engine derives values from
  // scoring_rules and refuses arbitrary numbers.
  test("47. Checkbox categories use configured values (never client numbers)", async () => {
    const rules = await getActiveScoringRules(admin)
    const pointValue = (cat: string) =>
      Number(rules.find((r) => r.category === cat && r.is_active)!.point_value)
    expect(pointValue("TUNIC")).toBe(5)
    expect(pointValue("COMMUNION")).toBe(5)
    expect(pointValue("BONUS")).toBe(3)
    expect(pointValue("MONTHLY_ACTIVITY")).toBe(20)
    const monthly = rules.find((r) => r.category === "MONTHLY_ACTIVITY")!
    expect(Number(monthly.requires_min_days)).toBe(30)

    const wrongValue = await upsertManualScore(admin, {
      actorId: superSeed.userId,
      profileId: member.userId,
      category: "TUNIC",
      refDate: today,
      points: 6,
    })
    expect(wrongValue.ok).toBe(false)
    expect(wrongValue.message).toContain("ثابتة")
  })

  // 48. Communion checkbox persists its configured value.
  test("48. Admin checks communion and it persists the configured value", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await openScoring(page, "/app/admin/scores", member.displayName)
    await page.getByRole("checkbox", { name: "التناول" }).check()
    await saveScoring(page)
    await expect
      .poll(
        async () => {
          const rows = await currentScore(member.userId, "COMMUNION")
          return rows.length ? Number(rows[0].points) : null
        },
        { timeout: 10_000 }
      )
      .toBe(5)
  })

  // 49. Communion follows the configured value too (wrong number refused).
  test("49. Communion values are fixed to the configured rule", async () => {
    const wrong = await upsertManualScore(admin, {
      actorId: superSeed.userId,
      profileId: member.userId,
      category: "COMMUNION",
      refDate: today,
      points: 6,
    })
    expect(wrong.ok).toBe(false)
    expect(wrong.message).toContain("ثابتة")
  })

  // 50. Service commitment picker persists its 0–10 value.
  test("50. Admin sets service commitment of 5", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await openScoring(page, "/app/admin/scores", member.displayName)
    await page.getByRole("radio", { name: "التزام الخدمة 5", exact: true }).click()
    await saveScoring(page)
    await expect
      .poll(
        async () => {
          const rows = await currentScore(member.userId, "SERVICE_COMMITMENT")
          return rows.length ? Number(rows[0].points) : null
        },
        { timeout: 10_000 }
      )
      .toBe(5)
  })

  // 51. Service commitment is range-checked too.
  test("51. Service commitment out of range is rejected", async () => {
    const tooHigh = await upsertManualScore(admin, {
      actorId: superSeed.userId,
      profileId: member.userId,
      category: "SERVICE_COMMITMENT",
      refDate: today,
      points: 12,
    })
    expect(tooHigh.ok).toBe(false)
    expect(tooHigh.message).toContain("0 لـ 10")
  })

  // 52. Bonus checkbox persists its configured value (3).
  test("52. Admin checks the bonus and it persists the configured value", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await openScoring(page, "/app/admin/scores", member.displayName)
    await page.getByRole("checkbox", { name: "Bonus ⭐" }).check()
    await saveScoring(page)
    await expect
      .poll(
        async () => {
          const rows = await currentScore(member.userId, "BONUS")
          return rows.length ? Number(rows[0].points) : null
        },
        { timeout: 10_000 }
      )
      .toBe(3)
  })

  // 53. Attendance points come from the attendance records (engine), read-only.
  test("53. Admin sees attendance results pulled from the attendance engine", async ({ page }) => {
    await seedAttendance("CHURCH", member.userId)
    await seedAttendance("SERVICE", member.userId)

    await login(page, adminSeed.phone, adminSeed.password)
    await openScoring(page, "/app/admin/scores", member.displayName)
    const churchCard = page.locator("div").filter({ hasText: /حضور القداس \(تلقائي\)\s*\+10/ }).first()
    await expect(churchCard).toBeVisible()
    const serviceCard = page.locator("div").filter({ hasText: /حضور الخدمة \(تلقائي\)\s*\+10/ }).first()
    await expect(serviceCard).toBeVisible()
  })

  // 54. Attendance is never a manual input — a save cannot change it.
  test("54. Attendance cannot be edited by an admin", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await openScoring(page, "/app/admin/scores", member.displayName)
    await expect(page.getByRole("spinbutton")).toHaveCount(0)
    await saveScoring(page)

    await expect
      .poll(
        async () => {
          const rows = await currentScore(member.userId, "CHURCH_ATTENDANCE")
          return rows.length ? Number(rows[0].points) : null
        },
        { timeout: 10_000 }
      )
      .toBe(10)
  })

  // 55. Weekly total = attendance + commitment cards only (activity excluded).
  test("55. Weekly total is the sum of the weekly categories", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await openScoring(page, "/app/admin/scores", member.displayName)
    await expect(page.getByText("45 نقطة")).toBeVisible()

    await logout(page)
    await login(page, member.phone, member.password)
    await page.goto("/app/member/scores")
    await expect(page.getByText("45 نقطة")).toBeVisible()
  })

  // 56. Monthly total includes the monthly activity; weekly does not.
  test("56. Monthly total aggregates activity + weekly categories", async () => {
    const week = await calculateScoreBreakdown(admin, member.userId, WEEKLY, today)
    const month = await calculateScoreBreakdown(admin, member.userId, "MONTHLY", today)
    expect(week.total).toBe(45)
    expect(month.total).toBe(65)
    expect(month.entries.find((e) => e.category === "MONTHLY_ACTIVITY")?.points).toBe(20)
    expect(week.entries.find((e) => e.category === "MONTHLY_ACTIVITY")).toBeUndefined()
  })

  // 57. Monthly activity enforces the 30-day window (deterministic dates).
  test("57. Monthly activity is blocked inside the 30-day window", async () => {
    const first = await grantMonthlyActivity(admin, {
      actorId: superSeed.userId,
      profileId: member2.userId,
      activityDate: "2026-01-01",
    })
    expect(first.ok).toBe(true)

    const tooSoon = await grantMonthlyActivity(admin, {
      actorId: superSeed.userId,
      profileId: member2.userId,
      activityDate: "2026-01-15",
    })
    expect(tooSoon.ok).toBe(false)
    expect(tooSoon.message).toContain("30 يوم")
  })

  // 58. A second same-month activity is still blocked (30 days pass, month dup),
  // and 30+ days later a new month is allowed.
  test("58. Monthly activity is granted again after 30 days; same month is blocked", async () => {
    const sameMonth30Days = await grantMonthlyActivity(admin, {
      actorId: superSeed.userId,
      profileId: member2.userId,
      activityDate: "2026-01-31",
    })
    expect(sameMonth30Days.ok).toBe(false)
    expect(sameMonth30Days.message).toContain("بالفعل هذا الشهر")

    const second = await grantMonthlyActivity(admin, {
      actorId: superSeed.userId,
      profileId: member2.userId,
      activityDate: "2026-02-15",
    })
    expect(second.ok).toBe(true)

    const { count } = await admin
      .from("score_records")
      .select("id", { count: "exact" })
      .eq("profile_id", member2.userId)
      .eq("category", "MONTHLY_ACTIVITY")
      .eq("is_voided", false)
    expect(count).toBe(2)
  })

  // 59. Servants are excluded from numerical scoring entirely.
  test("59. Servants get no numerical scores anywhere", async ({ page }) => {
    let errorMessage = ""
    try {
      await upsertManualScore(admin, {
        actorId: superSeed.userId,
        profileId: servant.userId,
        category: "BONUS",
        refDate: today,
        points: 3,
      })
    } catch (e) {
      errorMessage = (e as Error).message
    }
    expect(errorMessage).toContain("مخدومين")

    await login(page, servant.phone, servant.password)
    await page.goto("/app/member/scores")
    await expect(page).not.toHaveURL(/app\/member\/scores/)

    await logout(page)
    await login(page, adminSeed.phone, adminSeed.password)
    await page.goto("/app/admin/scores")
    const options = await page.getByLabel("اختار المخدوم").locator("option").allTextContents()
    expect(options).toContain(member.displayName)
    expect(options).not.toContain(servant.displayName)
  })

  // 60. Members can never modify their own scores from the member page.
  test("60. Member scores page exposes no editing controls", async ({ page }) => {
    await login(page, member.phone, member.password)
    await page.goto("/app/member/scores")
    await expect(page.getByRole("radio")).toHaveCount(0)
    await expect(page.getByRole("checkbox")).toHaveCount(0)
    await expect(page.getByRole("spinbutton")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "حفظ الدرجات" })).toHaveCount(0)
  })

  // 61. Admins can correct a weekly score (7 → 8); every change is audited.
  test("61. Admin corrects a weekly score and the change is audited", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await openScoring(page, "/app/admin/scores", member.displayName)
    await page.getByRole("radio", { name: "الالتزام 8", exact: true }).click()
    await saveScoring(page)

    await expect
      .poll(
        async () => {
          const rows = await currentScore(member.userId, "WEEKLY_COMMITMENT")
          return rows.length ? Number(rows[0].points) : null
        },
        { timeout: 10_000 }
      )
      .toBe(8)

    const { data: row } = await admin
      .from("score_records")
      .select("id")
      .eq("profile_id", member.userId)
      .eq("category", "WEEKLY_COMMITMENT")
      .eq("period_key", weekKey)
      .eq("is_voided", false)
      .maybeSingle()
    expect(row).not.toBeNull()

    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("audit_logs")
            .select("previous, actor_id")
            .eq("entity_id", row!.id)
            .eq("action", "SCORE_CORRECTED")
            .order("created_at", { ascending: false })
            .limit(1)
          const prev = data?.[0]?.previous
          return prev && Number(prev.points) === 7 ? Number(prev.points) : null
        },
        { timeout: 10_000 }
      )
      .toBe(7)
  })

  // 62. Super Admin can correct scores on the super-admin page too.
  test("62. Super Admin corrects a score to 9", async ({ page }) => {
    await login(page, superSeed.phone, superSeed.password)
    await openScoring(page, "/app/super-admin/scores", member.displayName)
    await page.getByRole("radio", { name: "الالتزام 9", exact: true }).click()
    await saveScoring(page)

    await expect
      .poll(
        async () => {
          const rows = await currentScore(member.userId, "WEEKLY_COMMITMENT")
          return rows.length ? Number(rows[0].points) : null
        },
        { timeout: 10_000 }
      )
      .toBe(9)
  })

  // 63. The correction audit carries previous/next and is written by the SA.
  test("63. Score corrections record before/after values with the actor", async ({ page }) => {
    const { data: row } = await admin
      .from("score_records")
      .select("id")
      .eq("profile_id", member.userId)
      .eq("category", "WEEKLY_COMMITMENT")
      .eq("period_key", weekKey)
      .eq("is_voided", false)
      .maybeSingle()
    expect(row).not.toBeNull()

    const { data: latest } = await admin
      .from("audit_logs")
      .select("previous, new, actor_id, entity")
      .eq("entity_id", row!.id)
      .eq("action", "SCORE_CORRECTED")
      .order("created_at", { ascending: false })
      .limit(1)
    expect(latest?.[0]).toBeTruthy()
    expect(Number(latest![0].previous.points)).toBe(8)
    expect(Number(latest![0].new.points)).toBe(9)
    expect(latest![0].actor_id).toBe(superSeed.userId)
    expect(latest![0].entity).toBe("SCORE")

    // Un-checking a checkbox voids the record (SCORE_CORRECTED, is_voided).
    await login(page, superSeed.phone, superSeed.password)
    await openScoring(page, "/app/super-admin/scores", member.displayName)
    await page.getByRole("checkbox", { name: "لبس التونية" }).uncheck()
    await saveScoring(page)
    await expect
      .poll(
        async () => (await currentScore(member.userId, "TUNIC")).length,
        { timeout: 10_000 }
      )
      .toBe(0)
  })

  // 64. RLS is watertight: own rows only, no writes for members.
  test("64. Members can only read their own score records and never write", async () => {
    const memberClient = createSupabaseClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error: signinError } = await memberClient.auth.signInWithPassword({
      phone: member.phone,
      password: member.password,
    })
    expect(signinError).toBeNull()

    const { data: own } = await memberClient
      .from("score_records")
      .select("id")
      .eq("profile_id", member.userId)
    expect((own ?? []).length).toBeGreaterThan(0)

    const { data: other } = await memberClient
      .from("score_records")
      .select("id")
      .eq("profile_id", member2.userId)
    expect(other).toHaveLength(0)

    const { error: insertError } = await memberClient.from("score_records").insert({
      profile_id: member.userId,
      category: "BONUS",
      points: 3,
      session_date: today,
    })
    expect(insertError).not.toBeNull()

    await memberClient.auth.signOut()

    const servantClient = createSupabaseClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    await servantClient.auth.signInWithPassword({
      phone: servant.phone,
      password: servant.password,
    })
    const { data: crossServant } = await servantClient
      .from("score_records")
      .select("id")
      .eq("profile_id", member.userId)
    expect(crossServant).toHaveLength(0)
  })

  // 65. No test scoring data may persist after the phase-4 run.
  test("65. No fake scoring data remains after the suite", async () => {
    await cleanupTestData()

    for (const phone of createdPhones.map(normalizePhone)) {
      const { data } = await admin
        .from("profiles")
        .select("id")
        .eq("phone", phone)
        .maybeSingle()
      expect(data).toBeNull()
    }

    const { count } = await admin.from("score_records").select("id", { count: "exact" })
    const { count: auditCount } = await admin
      .from("audit_logs")
      .select("id", { count: "exact" })
      .eq("entity", "SCORE")
    expect(count ?? 0).toBe(0)
    expect(auditCount ?? 0).toBe(0)
  })
})