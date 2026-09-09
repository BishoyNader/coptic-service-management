import { test, expect, type Page } from "@playwright/test"
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"
import { config as loadEnv } from "dotenv"
import { createAdminClient } from "../src/lib/supabase/admin"
import { cairoDateString } from "../src/lib/cairo"
import { addDaysDate } from "../src/services/scoring-rules"

/**
 * PHASE 5C — Reports + Settings, end to end.
 *
 * Numbering starts at 123. Covers: super-admin reports hub (attendance /
 * scores / servant-activities panels with date-range filters), the super-admin
 * scoring-rules settings screen (add / edit / archive-restore with audit
 * logging), access control for members / servants / admins / anonymous, RLS
 * read+write checks and a full cleanup back to the baseline.
 *
 * All dates come from the same Cairo helpers the app uses, so defaults and
 * seeded windows stay deterministic. Baseline scoring_rules count is 12.
 * Attendance seeds create real session rows (attendance_records.session_id
 * is NOT NULL) matching the canonical unique(type, session_date) session.
 */

loadEnv({ path: ".env.local" })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const BASELINE_RULES = 12

const REPORT_MEMBER_NAME = "مخدوم التقارير"
const ADDED_RULE_NAME = "قاعدة التقدير الجديدة"
const EDITED_RULE_NAME = "قاعدة التقدير المعدلة"

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

async function login(page: Page, phone: string, password: string) {
  await page.goto("/login")
  await page.getByLabel("رقم الموبايل أو الإيميل").fill(phone)
  await page.locator("#password").fill(password)
  await page.getByRole("button", { name: "تسجيل الدخول" }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function setDateInput(page: Page, testId: string, value: string) {
  await page.getByTestId(testId).evaluate((el, v) => {
    const input = el as HTMLInputElement
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, v)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }, value)
  await expect(page.getByTestId(testId)).toHaveValue(value)
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

  return { userId, phone: normalized, phoneRaw: phone, password, displayName: opts.name, code }
}

async function createAdmin(
  admin: SupabaseClient,
  role: "ADMIN" | "SUPER_ADMIN",
  phone: string,
  password: string
) {
  const normalized = normalizePhone(phone)
  const displayName = role === "SUPER_ADMIN" ? "رئيس تقارير اختبار" : "مشرف تقارير اختبار"
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

function anonClient(): SupabaseClient {
  return createSupabaseClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

test.describe("PHASE 5C — Reports & Settings", () => {
  test.describe.configure({ mode: "serial" })
  const createdPhones: string[] = []
  const createdSessionIds: string[] = []
  let admin: SupabaseClient
  let adminSeed: Awaited<ReturnType<typeof createAdmin>>
  let superSeed: Awaited<ReturnType<typeof createAdmin>>
  let memberBase: Awaited<ReturnType<typeof createUser>>
  let servantSeed: Awaited<ReturnType<typeof createUser>>
  let recordMember: Awaited<ReturnType<typeof createUser>>
  let addedRuleId: string | null = null
  let tribesId = ""
  let lessonId = ""

  test.beforeAll(async () => {
    admin = createAdminClient()

    adminSeed = await createAdmin(admin, "ADMIN", randomPhone(), "AdminSeed123!")
    createdPhones.push(adminSeed.phoneRaw)
    superSeed = await createAdmin(admin, "SUPER_ADMIN", randomPhone(), "SuperSeed123!")
    createdPhones.push(superSeed.phoneRaw)
    memberBase = await createUser(admin, "SERVED_MEMBER", randomPhone(), "BasePass123!", {
      name: "مخدوم بلاش صلاحية",
    })
    createdPhones.push(memberBase.phoneRaw)
    servantSeed = await createUser(admin, "SERVANT", randomPhone(), "ServantPass123!", {
      name: "خادم بلاش صلاحية",
    })
    createdPhones.push(servantSeed.phoneRaw)
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
      await admin.from("servant_activity_records").delete().in("servant_id", userIds)
      await admin.from("attendance_sessions").delete().in("id", createdSessionIds)
    }

    for (const uid of userIds) {
      await admin.auth.admin.deleteUser(uid)
    }

    await admin
      .from("scoring_rules")
      .delete()
      .in("name", [ADDED_RULE_NAME, EDITED_RULE_NAME])
    await admin.from("audit_logs").delete().eq("entity", "SCORING_RULE")
  }

  test.afterAll(async () => {
    if (process.env.KEEP_PHASE5C_DATA === "1") return
    await cleanupTestData()
  })

  test.describe("123-127 — Access control", () => {
    test("123. A served member cannot open the reports page", async ({ page }) => {
      await login(page, memberBase.phone, memberBase.password)
      await page.goto("/app/super-admin/reports")
      await expect(page).toHaveURL(/\/app\/member/, { timeout: 15_000 })
      await expect(page.getByRole("heading", { name: "التقارير" })).toHaveCount(0)
    })

    test("124. A servant cannot open the settings page", async ({ page }) => {
      await login(page, servantSeed.phone, servantSeed.password)
      await page.goto("/app/super-admin/settings")
      await expect(page).toHaveURL(/\/app\/servant/, { timeout: 15_000 })
      await expect(page.getByRole("heading", { name: "الإعدادات" })).toHaveCount(0)
    })

    test("125. Anonymous is sent to /login", async ({ page }) => {
      await page.goto("/app/super-admin/reports")
      await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
      await page.goto("/app/super-admin/settings")
      await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
    })

    test("126. An ADMIN cannot open super-admin reports or settings", async ({ page }) => {
      await login(page, adminSeed.phone, adminSeed.password)
      await page.goto("/app/super-admin/reports")
      await expect(page).toHaveURL(/\/app\/admin/, { timeout: 15_000 })
      await page.goto("/app/super-admin/settings")
      await expect(page).toHaveURL(/\/app\/admin/, { timeout: 15_000 })
    })

    test("127. Super Admin opens reports (3 tabs) and settings (rules + add button)", async ({
      page,
    }) => {
      await login(page, superSeed.phone, superSeed.password)

      await page.goto("/app/super-admin/reports")
      await expect(page.getByRole("heading", { name: "التقارير" })).toBeVisible()
      await expect(page.getByRole("tab")).toHaveCount(3)
      await expect(page.getByTestId("attendance-report")).toBeVisible()
      await expect(page.getByText("لا توجد سجلات حضور في هذه الفترة")).toBeVisible()

      await page.goto("/app/super-admin/settings")
      await expect(page.getByRole("heading", { name: "الإعدادات" })).toBeVisible()
      await expect(page.getByTestId("rule-settings-list")).toBeVisible()
      await expect(page.getByTestId("add-rule")).toBeVisible()
      await expect(page.locator('[data-testid^="rule-row-"]')).toHaveCount(BASELINE_RULES)
    })
  })

  test.describe("128-134 — Scoring rules settings", () => {
    test("128. Baseline is exactly 12 active+archived scoring rules", async () => {
      const { count } = await admin
        .from("scoring_rules")
        .select("id", { count: "exact" })
      expect(count ?? 0).toBe(BASELINE_RULES)
    })

    test("129. Add a new rule with confirmation dialog and audit trail", async ({ page }) => {
      await login(page, superSeed.phone, superSeed.password)
      await page.goto("/app/super-admin/settings")

      await page.getByTestId("add-rule").click()
      await expect(page.getByTestId("rule-form")).toBeVisible()

      await page.getByTestId("rule-form-category").selectOption("BONUS")
      await page.getByTestId("rule-form-name").fill(ADDED_RULE_NAME)
      await page.getByTestId("rule-form-points").fill("7")
      await page.getByTestId("rule-form-submit").click()

      await expect(page.getByText("تمت إضافة القاعدة ✓")).toBeVisible()
      await expect(page.getByText(ADDED_RULE_NAME)).toBeVisible()
      await expect(page.getByText("+7", { exact: true })).toBeVisible()

      const { data: rule } = await admin
        .from("scoring_rules")
        .select("id, category, point_value, is_active")
        .eq("name", ADDED_RULE_NAME)
        .maybeSingle()
      expect(rule).not.toBeNull()
      expect(rule?.category).toBe("BONUS")
      expect(Number(rule?.point_value)).toBe(7)
      expect(rule?.is_active).toBe(true)
      addedRuleId = rule?.id as string

      const { data: audits } = await admin
        .from("audit_logs")
        .select("action, entity")
        .eq("entity", "SCORING_RULE")
        .eq("action", "SCORING_RULE_CREATED")
      expect((audits ?? []).length).toBeGreaterThanOrEqual(1)
    })

    test("130. Invalid input is rejected by the server (empty name)", async ({ page }) => {
      await login(page, superSeed.phone, superSeed.password)
      await page.goto("/app/super-admin/settings")

      await page.getByTestId("add-rule").click()
      await page.getByTestId("rule-form-points").fill("-3")
      await page.getByTestId("rule-form-submit").click()

      await expect(page.getByText("مطلوب اسم القاعدة")).toBeVisible()
      await expect(page.getByTestId("rule-form")).toBeVisible()
    })

    test("131. Edit an existing rule and confirm the audit write", async ({ page }) => {
      await login(page, superSeed.phone, superSeed.password)
      await page.goto("/app/super-admin/settings")

      await page.getByTestId(`edit-rule-${addedRuleId}`).click()
      await expect(page.getByTestId("rule-form")).toBeVisible()

      await page.getByTestId("rule-form-name").fill(EDITED_RULE_NAME)
      await page.getByTestId("rule-form-points").fill("9")
      await page.getByTestId("rule-form-submit").click()

      await expect(page.getByText("تم تحديث القاعدة ✓")).toBeVisible()
      await expect(page.getByText(EDITED_RULE_NAME)).toBeVisible()
      await expect(page.getByText("+9", { exact: true })).toBeVisible()

      const { data: rule } = await admin
        .from("scoring_rules")
        .select("id, name, point_value")
        .eq("id", addedRuleId)
        .maybeSingle()
      expect(rule?.name).toBe(EDITED_RULE_NAME)
      expect(Number(rule?.point_value)).toBe(9)

      const { data: audits } = await admin
        .from("audit_logs")
        .select("id")
        .eq("entity", "SCORING_RULE")
        .eq("action", "SCORING_RULE_UPDATED")
        .eq("entity_id", addedRuleId)
      expect((audits ?? []).length).toBeGreaterThanOrEqual(1)
    })

    test("132. Archive soft-deletes the rule with confirmation", async ({ page }) => {
      await login(page, superSeed.phone, superSeed.password)
      await page.goto("/app/super-admin/settings")

      await page.getByTestId(`archive-rule-${addedRuleId}`).click()
      await expect(page.getByText("أرشفة القاعدة؟")).toBeVisible()
      await page.getByTestId("archive-confirm").click()

      await expect(page.getByText("تمت أرشفة القاعدة")).toBeVisible()
      await expect(page.getByText("مؤرشفة").first()).toBeVisible()

      const { data: rule } = await admin
        .from("scoring_rules")
        .select("is_active")
        .eq("id", addedRuleId)
        .maybeSingle()
      expect(rule?.is_active).toBe(false)

      const { data: audits } = await admin
        .from("audit_logs")
        .select("id")
        .eq("entity", "SCORING_RULE")
        .eq("action", "SCORING_RULE_ARCHIVED")
        .eq("entity_id", addedRuleId)
      expect((audits ?? []).length).toBeGreaterThanOrEqual(1)
    })

    test("133. Restore brings the archived rule back to active", async ({ page }) => {
      await login(page, superSeed.phone, superSeed.password)
      await page.goto("/app/super-admin/settings")

      await page.getByTestId(`restore-rule-${addedRuleId}`).click()
      await expect(page.getByText("تمت استعادة القاعدة ✓")).toBeVisible()

      const { data: rule } = await admin
        .from("scoring_rules")
        .select("is_active")
        .eq("id", addedRuleId)
        .maybeSingle()
      expect(rule?.is_active).toBe(true)
    })

    test("134. RLS blocks non-super-admin writes to scoring_rules", async () => {
      const memberClient = anonClient()
      await memberClient.auth.signInWithPassword({
        phone: memberBase.phone,
        password: memberBase.password,
      })
      const { error: memberError } = await memberClient
        .from("scoring_rules")
        .insert({ category: "BONUS", name: "قاعدة مرفوضة", point_value: 1 })
      expect(memberError).not.toBeNull()

      const adminClient = anonClient()
      await adminClient.auth.signInWithPassword({
        phone: adminSeed.phone,
        password: adminSeed.password,
      })
      const { error: adminError } = await adminClient
        .from("scoring_rules")
        .insert({ category: "BONUS", name: "قاعدة مرفوضة", point_value: 1 })
      expect(adminError).not.toBeNull()

      const { data: leaked } = await adminClient
        .from("scoring_rules")
        .select("id")
        .eq("name", "قاعدة مرفوضة")
      expect((leaked ?? []).length).toBe(0)
    })
  })

  test.describe("135-140 — Reports", () => {
    const REPORT_SESSION_TITLES = ["قداس تقرير", "قداس تقرير سابق", "خدمة تقرير"]

    async function seededMemberIds(): Promise<string[]> {
      const { data } = await admin
        .from("profiles")
        .select("id")
        .eq("full_name", REPORT_MEMBER_NAME)
      return (data ?? []).map((r) => r.id as string)
    }

    async function purgeReportsSeeds() {
      const memberIds = await seededMemberIds()
      if (memberIds.length) {
        await admin.from("attendance_records").delete().in("profile_id", memberIds)
        await admin.from("score_records").delete().in("profile_id", memberIds)
        await admin
          .from("servant_activity_records")
          .delete()
          .in("servant_id", memberIds)
        for (const uid of memberIds) {
          await admin.auth.admin.deleteUser(uid).catch(() => undefined)
        }
        await admin.from("profiles").delete().in("id", memberIds)
      }
      await admin
        .from("attendance_sessions")
        .delete()
        .in("title", REPORT_SESSION_TITLES)
      createdSessionIds.length = 0
    }

    test.beforeAll(async () => {
      await purgeReportsSeeds()
      recordMember = await createUser(
        admin,
        "SERVED_MEMBER",
        randomPhone(),
        "RecordPass123!",
        { name: REPORT_MEMBER_NAME }
      )
      createdPhones.push(recordMember.phoneRaw)

      const today = cairoDateString(new Date())
      const churchSecondDay = addDaysDate(today, -3)
      const churchFirstDay = addDaysDate(today, -4)
      const serviceDay = addDaysDate(today, -2)

      const { data: sessions, error: sessionError } = await admin
        .from("attendance_sessions")
        .insert([
          { type: "CHURCH", title: "قداس تقرير سابق", session_date: churchFirstDay, created_by: superSeed.userId },
          { type: "CHURCH", title: "قداس تقرير", session_date: churchSecondDay, created_by: superSeed.userId },
          { type: "SERVICE", title: "خدمة تقرير", session_date: serviceDay, created_by: superSeed.userId },
        ])
        .select("id, type, session_date")
      if (sessionError) throw new Error(`seed sessions: ${sessionError.message}`)
      const churchToday = (sessions ?? []).find((s) => s.type === "CHURCH" && s.session_date === churchSecondDay)
      const churchPrev = (sessions ?? []).find((s) => s.type === "CHURCH" && s.session_date === churchFirstDay)
      const service = (sessions ?? []).find((s) => s.type === "SERVICE")
      if (!churchToday || !churchPrev || !service) throw new Error("seed sessions: missing types")
      createdSessionIds.push(
        churchToday.id as string,
        churchPrev.id as string,
        service.id as string
      )

      const { error: attendanceError } = await admin.from("attendance_records").insert([
        {
          session_id: churchToday.id,
          profile_id: recordMember.userId,
          attended_at: `${churchSecondDay}T10:00:00.000Z`,
          points: 10,
          source: "MANUAL",
          status: "PRESENT",
          recorded_by: superSeed.userId,
        },
        {
          session_id: churchPrev.id,
          profile_id: recordMember.userId,
          attended_at: `${churchFirstDay}T10:00:00.000Z`,
          points: 10,
          source: "QR",
          status: "PRESENT",
          recorded_by: superSeed.userId,
        },
        {
          session_id: service.id,
          profile_id: recordMember.userId,
          attended_at: `${serviceDay}T12:00:00.000Z`,
          points: 5,
          source: "CODE",
          status: "PRESENT",
          recorded_by: superSeed.userId,
        },
      ])
      if (attendanceError) throw new Error(`seed attendance: ${attendanceError.message}`)

      const { error: scoreError } = await admin.from("score_records").insert([
        {
          profile_id: recordMember.userId,
          category: "WEEKLY_COMMITMENT",
          points: 7,
          session_date: churchSecondDay,
          recorded_by: superSeed.userId,
        },
        {
          profile_id: recordMember.userId,
          category: "TUNIC",
          points: 5,
          session_date: churchSecondDay,
          recorded_by: superSeed.userId,
        },
      ])
      if (scoreError) throw new Error(`seed scores: ${scoreError.message}`)

      const { data: activities } = await admin
        .from("activities")
        .select("id, code")
        .in("code", ["ATTENDED_TRIBES", "GAVE_LESSON"])
      tribesId = (activities ?? []).find((a) => a.code === "ATTENDED_TRIBES")?.id as string
      lessonId = (activities ?? []).find((a) => a.code === "GAVE_LESSON")?.id as string

      const { error: activityError } = await admin.from("servant_activity_records").insert([
        { servant_id: servantSeed.userId, activity_id: tribesId, recorded_on: churchSecondDay, recorded_by: superSeed.userId },
        { servant_id: servantSeed.userId, activity_id: lessonId, recorded_on: churchSecondDay, recorded_by: superSeed.userId },
      ])
      if (activityError) throw new Error(`seed activities: ${activityError.message}`)
    })

    test("135. Attendance report aggregates church/service and source", async ({ page }) => {
      await login(page, superSeed.phone, superSeed.password)
      await page.goto("/app/super-admin/reports")

      const row = page.getByTestId("attendance-report-row").filter({ hasText: REPORT_MEMBER_NAME })
      await expect(row).toBeVisible()
      await expect(row.getByText("قداس 2")).toBeVisible()
      await expect(row.getByText("خدمة 1")).toBeVisible()
      await expect(row.getByText("سجلات 3")).toBeVisible()
      await expect(row.getByText("25 نقطة")).toBeVisible()
      await expect(row.getByText("يدوي 1")).toBeVisible()
      await expect(page.getByText("إجمالي الحضور")).toBeVisible()
    })

    test("136. Narrowing the range to yesterday empties the attendance report", async ({
      page,
    }) => {
      await login(page, superSeed.phone, superSeed.password)
      await page.goto("/app/super-admin/reports")

      const yesterday = addDaysDate(cairoDateString(new Date()), -1)
      await setDateInput(page, "attendance-report-from", yesterday)
      await setDateInput(page, "attendance-report-to", yesterday)
      await page.getByTestId("attendance-report-apply").click()

      const narrowedRow = page
        .getByTestId("attendance-report-row")
        .filter({ hasText: REPORT_MEMBER_NAME })
      await expect(narrowedRow).not.toBeVisible()
      await expect(page.getByTestId("attendance-report")).toContainText("لا توجد سجلات حضور في هذه الفترة")
    })

    test("137. Scores report ranks the member with a category breakdown", async ({ page }) => {
      await login(page, superSeed.phone, superSeed.password)
      await page.goto("/app/super-admin/reports")

      await page.getByRole("tab", { name: "الدرجات" }).click()

      const row = page.getByTestId("scores-report-row").filter({ hasText: REPORT_MEMBER_NAME })
      await expect(row).toBeVisible()
      await expect(row.getByText("لبس التونية +5")).toBeVisible()
      await expect(row.getByText("الالتزام +7")).toBeVisible()
      await expect(page.getByTestId("scores-report")).toContainText("إجمالي الدرجات في الفترة")
    })

    test("138. Activities report splits by activity and by servant", async ({ page }) => {
      await login(page, superSeed.phone, superSeed.password)
      await page.goto("/app/super-admin/reports")

      await page.getByRole("tab", { name: "الأنشطة" }).click()

      await expect(page.getByTestId("activity-row").filter({ hasText: "حضر الأطراف" })).toBeVisible()
      await expect(page.getByTestId("activity-row").filter({ hasText: "شرح" })).toBeVisible()
      const servantRow = page
        .getByTestId("activity-servant-row")
        .filter({ hasText: "خادم بلاش صلاحية" })
      await expect(servantRow).toBeVisible()
      await expect(servantRow.getByText("2 نشاط")).toBeVisible()
    })

    test("139. Anonymous cannot read any reporting data", async () => {
      const anon = anonClient()
      const { data: attendance } = await anon.from("attendance_records").select("id")
      expect((attendance ?? []).length).toBe(0)
      const { data: scores } = await anon.from("score_records").select("id")
      expect((scores ?? []).length).toBe(0)
      const { data: activities } = await anon.from("servant_activity_records").select("id")
      expect((activities ?? []).length).toBe(0)
      const { data: rules } = await anon.from("scoring_rules").select("id")
      expect((rules ?? []).length).toBe(0)
    })

    test("140. A member cannot read another member's score records (RLS)", async () => {
      const memberClient = anonClient()
      await memberClient.auth.signInWithPassword({
        phone: memberBase.phone,
        password: memberBase.password,
      })
      const { data } = await memberClient
        .from("score_records")
        .select("id")
        .eq("profile_id", recordMember.userId)
      expect((data ?? []).length).toBe(0)
    })
  })

  test.describe("141-142 — Regression & final state", () => {
    test("141. Settings list still shows the test rule before cleanup", async ({ page }) => {
      await login(page, superSeed.phone, superSeed.password)
      await page.goto("/app/super-admin/settings")
      await expect(page.getByText(EDITED_RULE_NAME)).toBeVisible()
      await expect(page.locator('[data-testid^="rule-row-"]')).toHaveCount(BASELINE_RULES + 1)
    })

    test("142. No test data remains after the suite", async () => {
      await cleanupTestData()

      for (const phone of createdPhones.map(normalizePhone)) {
        const { data } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle()
        expect(data).toBeNull()
      }

      const { count: rCount } = await admin
        .from("scoring_rules")
        .select("id", { count: "exact" })
      expect(rCount ?? 0).toBe(BASELINE_RULES)

      const { count: aCount } = await admin
        .from("audit_logs")
        .select("id", { count: "exact" })
        .eq("entity", "SCORING_RULE")
      expect(aCount ?? 0).toBe(0)

      const { data: leakedScores } = await admin
        .from("score_records")
        .select("id")
        .eq("profile_id", recordMember.userId)
      expect((leakedScores ?? []).length).toBe(0)
    })
  })
})
