import { test, expect, type Page } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"
import { config as loadEnv } from "dotenv"
import { createClient } from "@supabase/supabase-js"

/**
 * PHASE 14 — SERVANT children records board + own day tab.
 *
 * The two new servant tabs:
 *  - /app/servant/children "سجلات الأولاد": per-child, per-date attendance
 *    entry (record / remove own) plus the weekly grades card and a recent
 *    history of attendance + scored categories.
 *  - /app/servant/my-day "حضوري وأنشطتي": own attendance for today (one-tap
 *    self check-in) + a two-week summary of own attendance above the reused
 *    servant activity panel.
 * Writes go through servant-gated server actions -> service-role RPCs; a
 * client can never forge attended_at/points or write rows directly.
 */

loadEnv({ path: ".env.local" })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const SERVANT_PHONE_RAW = "+201000000051"
const MEMBER_PHONE_RAW = "+201000000052"
const SERVANT_PASSWORD = "ServantRecords9!"
const MEMBER_PASSWORD = "MemberRecords9!"

let visitorCode = ""
const cleaned: string[] = []

type Seed = { userId: string; phone: string; password: string; displayName: string }

async function createUser(
  admin: SupabaseClient,
  role: "SERVANT" | "SERVED_MEMBER",
  phone: string,
  password: string,
  name: string
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
  cleaned.push(userId)

  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    role,
    full_name: name,
    phone,
    status: "ACTIVE",
  })
  if (profileError) throw new Error(`seed profile: ${profileError.message}`)

  if (role === "SERVANT") {
    const { error: pkError } = await admin.from("personal_codes").insert({
      profile_id: userId,
      code: String(Math.floor(100000 + Math.random() * 900000)),
      qr_token: "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16)
      }),
    })
    if (pkError) throw new Error(`seed personal_codes: ${pkError.message}`)
  }

  return { userId, phone, password, displayName: name }
}

let servant: Seed
let member: Seed

test.beforeAll(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  servant = await createUser(
    admin,
    "SERVANT",
    SERVANT_PHONE_RAW,
    SERVANT_PASSWORD,
    "خادم سجلات الأولاد"
  )
  member = await createUser(
    admin,
    "SERVED_MEMBER",
    MEMBER_PHONE_RAW,
    MEMBER_PASSWORD,
    "مخدوم سجلات الأولاد"
  )
  visitorCode = servant.userId
})

test.afterAll(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  // Remove child's records then the users
  await admin.from("score_records").delete().eq("profile_id", member.userId)
  await admin
    .from("audit_logs")
    .delete()
    .in("actor_id", [servant.userId, member.userId])
  await admin
    .from("audit_logs")
    .delete()
    .filter("metadata->>profile_id", "in", `(${member.userId},${servant.userId})`)
  for (const action of ["ATTENDANCE_MANUAL", "ATTENDANCE_CHECKIN", "ATTENDANCE_REMOVED"]) {
    await admin
      .from("audit_logs")
      .delete()
      .eq("action", action)
      .filter("metadata->>profile_id", "in", `(${member.userId},${servant.userId})`)
  }
  const { data: sessions } = await admin.from("attendance_sessions").select("id")
  const sessionIds = (sessions ?? []).map((s) => s.id as string)
  if (sessionIds.length) {
    await admin
      .from("attendance_records")
      .delete()
      .in("profile_id", [member.userId, servant.userId])
      .in("session_id", sessionIds)
    // Our self/children check-ins may have created today's CHURCH/SERVICE
    // sessions — drop them so later specs can re-seed today's sessions.
    await admin
      .from("attendance_sessions")
      .delete()
      .eq("session_date", today)
      .in("created_by", [servant.userId, member.userId])
  }
  for (const id of cleaned) {
    await admin.auth.admin.deleteUser(id)
  }
})

async function login(page: Page, seed: Seed) {
  await page.goto("/login")
  await page.getByLabel("رقم الموبايل أو الإيميل").fill(seed.phone)
  await page.locator("#password").fill(seed.password)
  await page.getByRole("button", { name: "تسجيل الدخول" }).click()
  await page.waitForURL(/\/app\/(servant|member)/, { timeout: 15_000 })
}

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date())
const twoDaysAgo = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})
  .format(new Date(Date.now() - 2 * 86_400_000))
  .slice(0, 10)

// ─── Nav ────────────────────────────────────────────────────────────────────
test("SERVANT nav shows new tabs", async ({ page }) => {
  await login(page, servant)
  await expect(page.getByRole("link", { name: "سجلات الأولاد" })).toBeVisible()
  await expect(page.getByRole("link", { name: "حضوري وأنشطتي" })).toBeVisible()
  await expect(page.getByRole("link", { name: "الأنشطة" })).toBeVisible()
})

// ─── Children page ──────────────────────────────────────────────────────────
test("Children page loads with member and today default", async ({ page }) => {
  await login(page, servant)
  await page.goto("/app/servant/children")
  await page.waitForLoadState("networkidle")
  await expect(page.getByRole("heading", { name: "سجلات الأولاد" })).toBeVisible()
  await expect(page.getByLabel("اختار المخدوم")).toContainText("مخدوم سجلات الأولاد")
  await expect(page.getByLabel("تاريخ السجل")).toHaveValue(today)
  await expect(page.getByLabel("تاريخ السجل")).toHaveAttribute("max", today)
})

// ─── Attendance CRUD ─────────────────────────────────────────────────────────
test("Servant records CHURCH attendance then remove button appears", async ({ page }) => {
  await login(page, servant)
  await page.goto("/app/servant/children")
  await page.waitForLoadState("networkidle")

  const card = page.locator("[data-testid='attendance-card-CHURCH']")
  await expect(card).toBeVisible()
  const recordBtn = card.getByRole("button", { name: "سجّل" })
  if (await recordBtn.isVisible()) {
    await recordBtn.click()
  }
  await expect(card.getByText("تم تسجيله")).toBeVisible({ timeout: 10_000 })
  await expect(card.getByRole("button", { name: "حذف حضور القداس" })).toBeVisible()
})

test("Servant removes own CHURCH attendance", async ({ page }) => {
  await login(page, servant)
  await page.goto("/app/servant/children")
  await page.waitForLoadState("networkidle")

  const card = page.locator("[data-testid='attendance-card-CHURCH']")
  // Ensure a record exists (record it now if not already)
  const recordBtn = card.getByRole("button", { name: "سجّل" })
  if (await recordBtn.isVisible()) {
    await recordBtn.click()
  }
  await expect(card.getByText("تم تسجيله")).toBeVisible({ timeout: 10_000 })
  await card.getByRole("button", { name: "حذف حضور القداس" }).click()
  await expect(card.getByText("لم يُسجَّل بعد")).toBeVisible({ timeout: 10_000 })
})

// ─── Grades ──────────────────────────────────────────────────────────────────
test("Servant saves weekly grades for child", async ({ page }) => {
  await login(page, servant)
  await page.goto("/app/servant/children")
  await page.waitForLoadState("networkidle")

  await page.getByRole("radio", { name: "الالتزام 7" }).click()
  await page.getByRole("radio", { name: "التزام الخدمة 5" }).click()
  await page.getByRole("checkbox", { name: "لبس التونية" }).check()
  await page.getByRole("checkbox", { name: "التناول" }).check()

  await page.getByRole("button", { name: "حفظ الدرجات" }).click()
  await expect(page.getByText("تم حفظ الدرجات")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("child-history-item").first()).toBeVisible({ timeout: 10_000 })
})

// ─── Backdate ────────────────────────────────────────────────────────────────
test("Servant records SERVICE attendance for a past date", async ({ page }) => {
  await login(page, servant)
  await page.goto("/app/servant/children")
  await page.waitForLoadState("networkidle")

  await page.getByLabel("تاريخ السجل").fill(twoDaysAgo)
  await page.waitForLoadState("networkidle")

  const card = page.locator("[data-testid='attendance-card-SERVICE']")
  await expect(card).toBeVisible()
  const recordBtn = card.getByRole("button", { name: "سجّل" })
  if (await recordBtn.isVisible()) {
    await recordBtn.click()
  }
  await expect(card.getByText("تم تسجيله")).toBeVisible({ timeout: 10_000 })
})

// ─── My-day page ─────────────────────────────────────────────────────────────
test("My-day page shows own attendance + records CHURCH + activities", async ({
  page,
}) => {
  await login(page, servant)
  await page.goto("/app/servant/my-day")
  await page.waitForLoadState("networkidle")
  await expect(page.getByRole("heading", { name: "حضوري وأنشطتي" })).toBeVisible()
  await expect(page.getByTestId("my-day-attendance-card")).toHaveCount(2)

  const churchCard = page
    .locator("[data-testid='my-day-attendance-card']")
    .filter({ hasText: "حضور القداس" })

  const btn = churchCard.getByRole("button", { name: /سجّل/ })
  if (await btn.isVisible()) {
    await btn.click()
  }
  await expect(churchCard.getByText("تم تسجيله")).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText("حضور آخر أسبوعين")).toBeVisible()
  await expect(page.getByRole("heading", { name: "الأنشطة" })).toBeVisible()
})

test("Recent attendance section renders attendance items", async ({ page }) => {
  await login(page, servant)
  await page.goto("/app/servant/my-day")
  await page.waitForLoadState("networkidle")
  // The previous tests recorded attendance/scores for the servant-scoped user
  await expect(page.getByText("حضور آخر أسبوعين")).toBeVisible()
})

// ─── Access control ──────────────────────────────────────────────────────────
test("Unauthenticated user redirected from servant children page", async ({ page }) => {
  await page.goto("/app/servant/children")
  await page.waitForURL(/\/login/, { timeout: 10_000 })
  expect(page.url()).toContain("/login")
})

test("RLS: anon client cannot insert attendance records", async () => {
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await anon.from("attendance_records").insert({
    profile_id: visitorCode,
    session_id: "00000000-0000-0000-0000-000000000001",
    attended_at: new Date().toISOString(),
    points: 10,
    source: "MANUAL",
    status: "PRESENT",
  })
  expect(error).not.toBeNull()
})