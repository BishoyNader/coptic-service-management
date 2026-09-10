import { test, expect, type Page } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"
import { config as loadEnv } from "dotenv"
import { createAdminClient } from "../src/lib/supabase/admin"
import { cairoDateString } from "../src/lib/cairo"
import { addDaysDate } from "../src/services/scoring-rules"
import { buildAttendanceReport, validateRange } from "../src/services/reports-service"
import { LIST_PAGE_SIZE } from "../src/lib/pagination"

/**
 * PHASE 8 — Scale, reporting & data operations, end to end.
 *
 * Numbering starts at 151. Covers: server-side pagination on the members
 * list (page reset + search + empty state), audit-log pagination, admin-level
 * reports access, CSV export authorization/columns, pagination bounds, and
 * security checks around the report builders.
 */

loadEnv({ path: ".env.local" })

function randomPhone(): string {
  return "01" + String(Math.floor(100000000 + Math.random() * 900000000)).padStart(9, "0")
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

async function login(page: Page, phone: string, password: string) {
  await page.goto("/login")
  await page.getByLabel("رقم الموبايل أو الإيميل").fill(phone)
  await page.locator("#password").fill(password)
  await page.getByRole("button", { name: "تسجيل الدخول" }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function createUser(
  admin: SupabaseClient,
  role: "SERVED_MEMBER" | "SERVANT",
  phone: string,
  password: string,
  opts: { name?: string; status?: string } = {}
) {
  const normalized = normalizePhone(phone)
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    phone: normalized,
    password,
    phone_confirm: true,
    email_confirm: true,
    user_metadata: { full_name: opts.name ?? "مخدوم اختبار", role },
  })
  if (authError) throw new Error(`seed auth: ${authError.message}`)
  const userId = authData.user.id

  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    role,
    full_name: opts.name ?? (role === "SERVANT" ? "خادم اختبار" : "مخدوم اختبار"),
    phone: normalized,
    ...(opts.status ? { status: opts.status } : {}),
  })
  if (profileError) throw new Error(`seed profile: ${profileError.message}`)

  return { userId, phone: normalized, phoneRaw: phone, password, displayName: opts.name }
}

async function createAdmin(
  admin: SupabaseClient,
  role: "ADMIN" | "SUPER_ADMIN",
  phone: string,
  password: string
) {
  const normalized = normalizePhone(phone)
  const displayName = role === "SUPER_ADMIN" ? "رئيس عمليات اختبار" : "مشرف عمليات اختبار"
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

test.describe("PHASE 8 — Scale, reporting & data operations", () => {
  test.describe.configure({ mode: "serial" })
  const createdPhones: string[] = []
  const createdSessionIds: string[] = []
  let admin: SupabaseClient
  let adminSeed: Awaited<ReturnType<typeof createAdmin>>
  let superSeed: Awaited<ReturnType<typeof createAdmin>>
  let memberBase: Awaited<ReturnType<typeof createUser>>
  let memberSearchOne: Awaited<ReturnType<typeof createUser>>
  let servantSeed: Awaited<ReturnType<typeof createUser>>

  test.beforeAll(async () => {
    admin = createAdminClient()

    adminSeed = await createAdmin(admin, "ADMIN", randomPhone(), "AdminPhase8!")
    createdPhones.push(adminSeed.phoneRaw)
    superSeed = await createAdmin(admin, "SUPER_ADMIN", randomPhone(), "SuperPhase8!")
    createdPhones.push(superSeed.phoneRaw)
    memberBase = await createUser(admin, "SERVED_MEMBER", randomPhone(), "BasePhase8!", {
      name: "مخدوم العمليات",
    })
    createdPhones.push(memberBase.phoneRaw)
    memberSearchOne = await createUser(admin, "SERVED_MEMBER", randomPhone(), "SearchPhase8!", {
      name: "بحث ترتيبي واحد",
    })
    createdPhones.push(memberSearchOne.phoneRaw)
    servantSeed = await createUser(admin, "SERVANT", randomPhone(), "ServantPhase8!", {
      name: "خادم العمليات",
    })
    createdPhones.push(servantSeed.phoneRaw)

    // Seed one attendance session + record inside a window the export tests
    // query, so the export button is actually rendered.
    const today = cairoDateString(new Date())
    const { data: sessions, error: sessionError } = await admin
      .from("attendance_sessions")
      .insert([
        {
          type: "CHURCH",
          title: "قداس عمليات التصدير",
          session_date: today,
          created_by: superSeed.userId,
        },
      ])
      .select("id, type, session_date")
    if (sessionError) throw new Error(`seed sessions: ${sessionError.message}`)
    const session = (sessions ?? [])[0]
    if (!session) throw new Error("seed sessions: missing row")
    createdSessionIds.push(session.id as string)

    const { error: attendanceError } = await admin.from("attendance_records").insert([
      {
        session_id: session.id,
        profile_id: memberSearchOne.userId,
        attended_at: `${today}T10:00:00.000Z`,
        points: 10,
        source: "MANUAL",
        status: "PRESENT",
        recorded_by: superSeed.userId,
      },
    ])
    if (attendanceError) throw new Error(`seed attendance: ${attendanceError.message}`)
  })

  async function cleanupTestData() {
    const userIds: string[] = []
    for (const phone of createdPhones.map(normalizePhone)) {
      const { data } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle()
      if (data) userIds.push(data.id as string)
    }

    if (userIds.length) {
      await admin.from("attendance_records").delete().in("profile_id", userIds)
      await admin.from("score_records").delete().in("profile_id", userIds)
      await admin.from("audit_logs").delete().eq("entity", "TEST_REPORT")
      await admin.from("attendance_sessions").delete().in("id", createdSessionIds)
    }

    for (const uid of userIds) {
      await admin.auth.admin.deleteUser(uid)
    }

    createdSessionIds.length = 0
  }

  test.afterAll(async () => {
    if (process.env.KEEP_PHASE8_DATA === "1") return
    await cleanupTestData()
  })

  // ---------------------------------------------------------------------------
  // Pagination & search
  // ---------------------------------------------------------------------------

  test("151. Admin members list loads the first page with bounded rows", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await page.goto("/app/admin/members")
    await expect(page.getByRole("heading", { name: "المخدومين" })).toBeVisible()
    const rows = page.locator('a[href^="/app/admin/members/"]')
    expect(await rows.count()).toBeLessThanOrEqual(LIST_PAGE_SIZE)
  })

  test("152. Admin members search filters server-side and keeps a bounded page", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await page.goto("/app/admin/members?q=" + encodeURIComponent("بحث ترتيبي"))
    await expect(page.getByText("بحث ترتيبي واحد")).toBeVisible()
    await expect(page.getByText("مخدوم العمليات")).toHaveCount(0)
    await expect(page.locator('input[name="q"]')).toHaveValue("بحث ترتيبي")
  })

  test("153. Admin members empty state shows for a non-matching search", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await page.goto("/app/admin/members?q=" + encodeURIComponent("اسم غير موجود تماما"))
    await expect(page.getByText("لا توجد نتائج")).toBeVisible()
  })

  test("154. Super-admin audit log paginates beyond the first page", async ({ page }) => {
    await login(page, superSeed.phone, superSeed.password)

    const seeds: Record<string, string | null>[] = []
    for (let i = 0; i < LIST_PAGE_SIZE + 5; i++) {
      seeds.push({
        action: "TEST_AUDIT_ROW",
        entity: "TEST_REPORT",
        entity_id: randomUuid(),
        actor_id: adminSeed.userId,
      })
    }
    const { error: insertError } = await admin.from("audit_logs").insert(seeds as never[])
    if (insertError) throw new Error(`seed audit: ${insertError.message}`)

    await page.goto("/app/super-admin/audit-log")
    await expect(page.getByRole("heading", { name: "سجل العمليات" })).toBeVisible()
    // A single page never shows more than the standard page size.
    const pageOne = await page.locator("text=TEST_AUDIT_ROW").count()
    expect(pageOne).toBeLessThanOrEqual(LIST_PAGE_SIZE)

    const pager = page.getByText(/صفحة 1 من \d+/)
    await expect(pager).toBeVisible()
    await page.getByRole("link", { name: "التالي" }).first().click()
    await expect(page).toHaveURL(/page=2/)
  })

  test("155. Direct invoke of the attendance report builder validates ranges", async () => {
    expect(() => validateRange({ from: "2026-01-01", to: "2026-01-10" })).not.toThrow()
    expect(() => validateRange({ from: "2026-01-10", to: "2026-01-01" })).toThrow(
      /تاريخ البداية بعد تاريخ النهاية/
    )
    expect(() => validateRange({ from: "bad", to: "2026-01-01" })).toThrow(/نطاق التاريخ غير صحيح/)
    expect(() => validateRange({ from: "2026-02-30", to: "2026-02-30" })).toThrow(
      /نطاق التاريخ غير صحيح/
    )
  })

  test("156. Attendance report builder aggregates over an inclusive bounded range", async () => {
    const today = cairoDateString(new Date())
    const daysAgo = addDaysDate(today, -3)
    const report = await buildAttendanceReport(admin, { from: daysAgo, to: today })
    expect(report.range).toMatchObject({ from: daysAgo, to: today })
    expect(report.totals.records).toBeGreaterThanOrEqual(1)
    expect(Array.isArray(report.rows)).toBe(true)
  })

  // ---------------------------------------------------------------------------
  // Reports authorization (admin vs super-admin)
  // ---------------------------------------------------------------------------

  test("157. ADMIN can open the admin reports page", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await page.goto("/app/admin/reports")
    await expect(page.getByRole("heading", { name: "التقارير" })).toBeVisible()
    await expect(page.getByRole("tab")).toHaveCount(3)
  })

  test("158. ADMIN reports are not accessible from super-admin URLs", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await page.goto("/app/super-admin/reports")
    await expect(page).toHaveURL(/\/app\/admin/, { timeout: 15_000 })
    await expect(page.getByRole("heading", { name: "التقارير" })).toHaveCount(0)
  })

  test("159. SERVED_MEMBER cannot open admin reports", async ({ page }) => {
    await login(page, memberBase.phone, memberBase.password)
    await page.goto("/app/admin/reports")
    await expect(page).toHaveURL(/\/app\/member/, { timeout: 15_000 })
  })

  test("160. SERVANT cannot open admin reports", async ({ page }) => {
    await login(page, servantSeed.phone, servantSeed.password)
    await page.goto("/app/admin/reports")
    await expect(page).toHaveURL(/\/app\/servant/, { timeout: 15_000 })
  })

  // ---------------------------------------------------------------------------
  // CSV exports
  // ---------------------------------------------------------------------------

  test("161. Admin exports the members CSV with columns and no auth secrets", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await page.goto("/app/admin/members")

    const downloadPromise = page.waitForEvent("download")
    await page.getByRole("button", { name: /تصدير CSV/ }).first().click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe("members.csv")

    const stream = await download.createReadStream()
    let content = ""
    for await (const chunk of stream) content += chunk.toString()
    expect(content).toContain("الاسم")
    expect(content).toContain("الموبايل")
    expect(content).toContain("مخدوم العمليات")
    // No authentication columns or tokens leak into the export.
    expect(content).not.toContain("password")
    expect(content).not.toContain("auth")
    expect(content).not.toContain("qr_token")
  })

  test("162. Super Admin exports the attendance report CSV respecting the date range", async ({
    page,
  }) => {
    await login(page, superSeed.phone, superSeed.password)
    await page.goto("/app/super-admin/reports")

    // Wait for the initial report to finish loading (post-hydration) so the
    // controlled date inputs are live before we drive them.
    await expect(page.getByText("إجمالي الحضور")).toBeVisible()

    const today = cairoDateString(new Date())
    const from = addDaysDate(today, -15)
    await page.getByTestId("attendance-report-from").fill(from)
    await page.getByTestId("attendance-report-to").fill(today)
    await page.getByTestId("attendance-report-apply").click()

    const exportButton = page.getByRole("button", { name: /تصدير CSV/ })
    await expect(exportButton).toBeVisible()

    const downloadPromise = page.waitForEvent("download")
    await exportButton.click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe("attendance-report.csv")

    const stream = await download.createReadStream()
    let content = ""
    for await (const chunk of stream) content += chunk.toString()
    expect(content).toContain("الاسم")
    expect(content).toContain("النقاط")
    expect(content).toContain("المصدر")
    expect(content).toContain("بحث ترتيبي واحد")
  })

  test("163. Unauthorized member cannot download reports", async ({ page }) => {
    await login(page, memberBase.phone, memberBase.password)
    await page.goto("/app/super-admin/reports")
    await expect(page).toHaveURL(/\/app\/member/, { timeout: 15_000 })
    await expect(page.getByRole("button", { name: /تصدير CSV/ })).toHaveCount(0)
  })

  // ---------------------------------------------------------------------------
  // Max page size / bounded queries
  // ---------------------------------------------------------------------------

  test("164. Pagination library enforces bounded default and max sizes", () => {
    expect(LIST_PAGE_SIZE).toBe(25)
    expect(LIST_PAGE_SIZE).toBeLessThanOrEqual(200)
  })

  test("165. A page query with no search never over-renders", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await page.goto("/app/admin/members?page=2&q=")
    await expect(page.getByRole("heading", { name: "المخدومين" })).toBeVisible()
    const rows = page.locator('a[href^="/app/admin/members/"]')
    expect(await rows.count()).toBeLessThanOrEqual(LIST_PAGE_SIZE)
  })
})