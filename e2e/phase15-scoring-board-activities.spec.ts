import { test, expect, type Page } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"
import { config as loadEnv } from "dotenv"
import { createClient } from "@supabase/supabase-js"

loadEnv({ path: ".env.local" })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const SUPER_PHONE = "+201000000081"
const SERVANT_PHONE = "+201000000082"
const MEMBER_PHONE = "+201000000083"
const SUPER_PASSWORD = "Phase15Super9!"
const SERVANT_PASSWORD = "Phase15Servant9!"
const MEMBER_PASSWORD = "Phase15Member9!"

type Seed = { userId: string; phone: string; password: string; displayName: string }

const cleaned: string[] = []
let memorizationActivityId = ""
let addedActivityId = ""

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date())
const yesterday = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})
  .format(new Date(Date.now() - 86_400_000))
  .slice(0, 10)

let superAdmin: Seed
let servant: Seed
let member: Seed

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
  cleaned.push(userId)

  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    role,
    full_name: name,
    phone,
    status: "ACTIVE",
  })
  if (profileError) throw new Error(`seed profile: ${profileError.message}`)

  if (role === "SUPER_ADMIN") {
    const { error: adminError } = await admin.from("admin_profiles").insert({ profile_id: userId })
    if (adminError) throw new Error(`seed admin_profiles: ${adminError.message}`)
  }

  return { userId, phone, password, displayName: name }
}

test.beforeAll(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Cleanup leftover users from prior crashed runs
  for (const phone of [SUPER_PHONE, SERVANT_PHONE, MEMBER_PHONE]) {
    const { data } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle()
    if (data) await admin.auth.admin.deleteUser(data.id)
  }

  superAdmin = await createUser(admin, "SUPER_ADMIN", SUPER_PHONE, SUPER_PASSWORD, "رئيس شمامسة اختبار التقييم")
  servant = await createUser(admin, "SERVANT", SERVANT_PHONE, SERVANT_PASSWORD, "خادم اختبار التقييم")
  member = await createUser(admin, "SERVED_MEMBER", MEMBER_PHONE, MEMBER_PASSWORD, "مخدوم اختبار التقييم")

  // Fetch the seeded حفظ المزامير activity id (SERVED_MEMBER)
  const { data: mem } = await admin
    .from("activities")
    .select("id")
    .eq("code", "MEMBER_MEMORIZATION")
    .eq("is_active", true)
    .maybeSingle()
  memorizationActivityId = mem?.id ?? ""
})

test.afterAll(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Cleanup added test activity
  if (addedActivityId) {
    await admin.from("activities").delete().eq("id", addedActivityId)
  }

  // Cleanup member activity scores + attendance records/sessions + audit logs for our users
  await admin.from("member_activity_scores").delete().eq("profile_id", member.userId)
  await admin
    .from("audit_logs")
    .delete()
    .in("actor_id", [superAdmin.userId, servant.userId, member.userId])
  await admin
    .from("audit_logs")
    .delete()
    .filter("metadata->>profile_id", "in", `(${member.userId})`)
  for (const action of ["ATTENDANCE_MANUAL", "ATTENDANCE_CHECKIN", "ATTENDANCE_REMOVED"]) {
    await admin
      .from("audit_logs")
      .delete()
      .eq("action", action)
      .filter("metadata->>profile_id", "in", `(${member.userId})`)
  }
  const { data: sessions } = await admin.from("attendance_sessions").select("id")
  const sessionIds = (sessions ?? []).map((s) => s.id as string)
  if (sessionIds.length) {
    await admin
      .from("attendance_records")
      .delete()
      .in("profile_id", [member.userId, servant.userId])
      .in("session_id", sessionIds)
    await admin
      .from("attendance_sessions")
      .delete()
      .eq("session_date", today)
      .in("created_by", [servant.userId])
  }

  // Delete users (cascades to profiles via FK)
  for (const id of cleaned) {
    await admin.auth.admin.deleteUser(id)
  }
})

async function login(page: Page, seed: Seed) {
  await page.goto("/login")
  await page.getByLabel("رقم الموبايل أو الإيميل").fill(seed.phone)
  await page.locator("#password").fill(seed.password)
  await page.getByRole("button", { name: "تسجيل الدخول" }).click()
  await page.waitForURL(/\/app\//, { timeout: 15_000 })
}

// ─── SUPER ADMIN — Activities settings ───────────────────────────────────────

test("SUPER_ADMIN nav shows الأنشطة link", async ({ page }) => {
  await login(page, superAdmin)
  await expect(page.getByRole("link", { name: "الأنشطة", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "تسجيل الأنشطة" })).toBeVisible()
})

test("SUPER_ADMIN activities page loads with seeded SERVED_MEMBER activities", async ({
  page,
}) => {
  await login(page, superAdmin)
  await page.goto("/app/super-admin/activities")
  await page.waitForLoadState("networkidle")
  await expect(page.getByRole("heading", { name: "الأنشطة والدرجات" })).toBeVisible()
  await expect(page.getByText("حفظ المزامير")).toBeVisible()
  await expect(page.getByText("السلوك الحسن")).toBeVisible()
})

test("SUPER_ADMIN adds a new SERVED_MEMBER activity", async ({ page }) => {
  await login(page, superAdmin)
  await page.goto("/app/super-admin/activities")
  await page.waitForLoadState("networkidle")

  await page.getByTestId("add-activity").click()
  await page.getByTestId("activity-form-name").fill("نشاط اختبار التقييم")
  await page.getByTestId("activity-form-role").selectOption("SERVED_MEMBER")
  await page.getByTestId("activity-form-min").fill("0")
  await page.getByTestId("activity-form-max").fill("5")
  await page.getByTestId("activity-form-submit").click()

  await expect(page.getByText("تمت إضافة النشاط")).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText("نشاط اختبار التقييم")).toBeVisible()

  // Fetch the id for later tests
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data } = await admin
    .from("activities")
    .select("id")
    .eq("name", "نشاط اختبار التقييم")
    .eq("is_active", true)
    .maybeSingle()
  addedActivityId = data?.id ?? ""
})

test("SUPER_ADMIN edits activity name and range", async ({ page }) => {
  await login(page, superAdmin)
  await page.goto("/app/super-admin/activities")
  await page.waitForLoadState("networkidle")

  await page.getByTestId(`edit-activity-${addedActivityId}`).click()
  await page.getByTestId("activity-form-name").fill("نشاط اختبار معدل")
  await page.getByTestId("activity-form-max").fill("8")
  await page.getByTestId("activity-form-submit").click()

  await expect(page.getByText("تم تحديث النشاط")).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText("نشاط اختبار معدل")).toBeVisible()
  await expect(page.getByText("0–8")).toBeVisible()
})

test("SUPER_ADMIN archives then restores activity", async ({ page }) => {
  await login(page, superAdmin)
  await page.goto("/app/super-admin/activities")
  await page.waitForLoadState("networkidle")

  await page.getByTestId(`archive-activity-${addedActivityId}`).click()
  await page.getByTestId("archive-activity-confirm").click()
  await expect(page.getByText("تم حذف النشاط")).toBeVisible({ timeout: 10_000 })

  const row = page.getByTestId(`activity-row-${addedActivityId}`)
  await expect(row.getByText("محذوف")).toBeVisible()
  await expect(page.getByTestId(`restore-activity-${addedActivityId}`)).toBeVisible()

  await page.getByTestId(`restore-activity-${addedActivityId}`).click()
  await expect(page.getByText("تم استرجاع النشاط")).toBeVisible({ timeout: 10_000 })
  await expect(row.getByText("محذوف")).not.toBeVisible()
})

// ─── SERVANT — Unified scoring board ─────────────────────────────────────────

test("SERVANT nav shows الأنشطة link", async ({ page }) => {
  await login(page, servant)
  await expect(page.getByRole("link", { name: "الأنشطة" })).toBeVisible()
  await expect(page.getByRole("link", { name: "التقييم" })).not.toBeVisible()
})

test("Servant scoring board shows today tab with all members and activity inputs", async ({
  page,
}) => {
  await login(page, servant)
  await page.goto("/app/servant/activities")
  await page.waitForLoadState("networkidle")

  await page.getByTestId("hub-tab-members").click()
  await expect(page.getByTestId("board-tab-today")).toBeVisible()
  await expect(page.getByTestId("board-tab-history")).toBeVisible()

  // Member card should be visible
  const memberCard = page.getByTestId(`board-member-${member.userId}`)
  await expect(memberCard).toBeVisible()

  // Activity input for حفظ المزامير should be visible
  await expect(
    page.getByTestId(`activity-input-${memorizationActivityId}-${member.userId}`),
  ).toBeVisible()

  // Attendance chips should be visible
  await expect(
    page.getByTestId(`attendance-chip-CHURCH-${member.userId}`),
  ).toBeVisible()
  await expect(
    page.getByTestId(`attendance-chip-SERVICE-${member.userId}`),
  ).toBeVisible()
})

test("Servant records attendance and saves scores for member", async ({ page }) => {
  await login(page, servant)
  await page.goto("/app/servant/activities")
  await page.waitForLoadState("networkidle")

  await page.getByTestId("hub-tab-members").click()

  // Record CHURCH attendance for the member
  const churchChip = page.getByTestId(`attendance-chip-CHURCH-${member.userId}`)
  await churchChip.click()
  await expect(churchChip.getByText("اضغط للإلغاء")).toBeVisible({ timeout: 10_000 })

  // Score the memorization activity with 8 points
  const input = page.getByTestId(`activity-input-${memorizationActivityId}-${member.userId}`)
  await input.fill("8")

  // Save
  await page.getByTestId(`save-scores-${member.userId}`).click()
  await expect(page.getByText("تم حفظ")).toBeVisible({ timeout: 15_000 })

  // Input value should persist
  await expect(input).toHaveValue("8")
})

test("Servant history tab shows past dates read-only", async ({ page }) => {
  await login(page, servant)
  await page.goto("/app/servant/activities")
  await page.waitForLoadState("networkidle")

  await page.getByTestId("hub-tab-members").click()
  await page.getByTestId("board-tab-history").click()

  const dateInput = page.getByTestId("board-history-date")
  await expect(dateInput).toBeVisible()
  await expect(dateInput).toHaveValue(yesterday)

  // No save buttons (read-only) in history tab
  // activity inputs should NOT exist (history renders span, not input)
  await expect(
    page.getByTestId(`activity-input-${memorizationActivityId}-${member.userId}`),
  ).not.toBeVisible()
})

// ─── MEMBER — My scores with activity breakdown ──────────────────────────────

test("Member scores page shows activity tab with today's scores and percentages", async ({
  page,
}) => {
  await login(page, member)
  await page.goto("/app/member/scores")
  await page.waitForLoadState("networkidle")

  await expect(page.getByRole("heading", { name: "درجاتي" })).toBeVisible()

  // Activity tab should be selected by default (entries exist)
  await expect(page.getByRole("tab", { name: "نشاط اليوم" })).toBeVisible()

  // Today's score card
  await expect(page.getByText("درجة اليوم")).toBeVisible()
  // Activity row for حفظ المزامير with saved 8/10
  await expect(page.getByText("حفظ المزامير")).toBeVisible()
  await expect(page.getByText("8 / 10")).toBeVisible()
  // Percent badge: 80%
  await expect(page.getByText("80%")).toBeVisible()

  // Total card
  await expect(page.getByText("الإجمالي الكلي")).toBeVisible()
})

// ─── Access control ───────────────────────────────────────────────────────────

test("Unauthenticated user redirected from servant activities hub", async ({ page }) => {
  await page.goto("/app/servant/activities")
  await page.waitForURL(/\/login/, { timeout: 10_000 })
  expect(page.url()).toContain("/login")
})

test("Unauthenticated user redirected from super-admin activities page", async ({ page }) => {
  await page.goto("/app/super-admin/activities")
  await page.waitForURL(/\/login/, { timeout: 10_000 })
  expect(page.url()).toContain("/login")
})
