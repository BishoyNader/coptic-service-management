import { test, expect, type Page } from "@playwright/test"
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"
import { config as loadEnv } from "dotenv"
import { createAdminClient } from "../src/lib/supabase/admin"
import { sendBirthdayGreeting } from "../src/services/birthday-service"
import { cairoDateString } from "../src/lib/cairo"
import { nextBirthdayDateString } from "../src/lib/dates"

/**
 * PHASE 5B — Birthday reminders, end to end.
 *
 * Numbering starts at 89. Covers: admin/super-admin upcoming-birthdays page
 * (today / this week / within 30 days), the manual single-recipient greeting
 * send through the existing notification system, birthday_reminders
 * deduplication, audit logging, RLS security, member inbox regression and a
 * full cleanup.
 *
 * Order matters inside this file — later tests rely on earlier ones. All
 * dates come from the same Cairo-calendar helpers the app uses, so the
 * birthdays here are deterministic for any day the suite runs.
 */

loadEnv({ path: ".env.local" })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const GREETING_TITLE = "🎂 عيد ميلاد سعيد!"
const GREETING_BODY_CUSTOM = "أطيب الأمنيات بمناسبة عيد ميلادك 🎉"

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

async function createUser(
  admin: SupabaseClient,
  role: "SERVED_MEMBER" | "SERVANT",
  phone: string,
  password: string,
  opts: { name?: string; dob?: string; status?: string } = {}
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
    ...(opts.dob ? { date_of_birth: opts.dob } : {}),
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

  return { userId, phone: normalized, phoneRaw: phone, password, displayName: opts.name, dob: opts.dob, code }
}

async function createAdmin(
  admin: SupabaseClient,
  role: "ADMIN" | "SUPER_ADMIN",
  phone: string,
  password: string
) {
  const normalized = normalizePhone(phone)
  const displayName = role === "SUPER_ADMIN" ? "رئيس تهنئة اختبار" : "مشرف تهنئة اختبار"
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

function cairoAddDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(
    dt.getUTCDate()
  ).padStart(2, "0")}`
}

/** A birth date whose next Cairo-calendar occurrence is exactly `days` from today. */
function birthdayDobFor(daysFromToday: number): string {
  const occurrence = cairoAddDays(cairoDateString(new Date()), daysFromToday)
  const [y, m, d] = occurrence.split("-").map(Number)
  return `${y - 20}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

test.describe("PHASE 5B — Birthday reminders", () => {
  const createdPhones: string[] = []
  let admin: SupabaseClient
  let adminSeed: Awaited<ReturnType<typeof createAdmin>>
  let superSeed: Awaited<ReturnType<typeof createAdmin>>
  let memberBase: Awaited<ReturnType<typeof createUser>>
  let servantSeed: Awaited<ReturnType<typeof createUser>>
  let memberToday: Awaited<ReturnType<typeof createUser>>
  let memberWeek: Awaited<ReturnType<typeof createUser>>
  let memberMonth: Awaited<ReturnType<typeof createUser>>
  let memberBoundary: Awaited<ReturnType<typeof createUser>>
  let memberFar: Awaited<ReturnType<typeof createUser>>
  let memberInactive: Awaited<ReturnType<typeof createUser>>

  async function cleanupTestData() {
    const userIds: string[] = []
    for (const phone of createdPhones.map(normalizePhone)) {
      const { data } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle()
      if (data) userIds.push(data.id as string)
    }

    if (userIds.length) {
      await admin.from("notifications").delete().in("sender_id", userIds)
      await admin.from("notification_recipients").delete().in("profile_id", userIds)
      await admin.from("birthday_reminders").delete().in("profile_id", userIds)
      await admin.from("audit_logs").delete().eq("entity", "BIRTHDAY_REMINDER")
    }

    for (const uid of userIds) {
      await admin.from("attendance_records").delete().eq("profile_id", uid)
      await admin.from("score_records").delete().eq("profile_id", uid)
      await admin.auth.admin.deleteUser(uid)
    }

    const sessions = await admin.from("attendance_sessions").select("id").in("type", ["CHURCH", "SERVICE"])
    const sessionIds = (sessions.data ?? []).map((s) => s.id as string)
    if (sessionIds.length) {
      const used = await admin.from("attendance_records").select("session_id").in("session_id", sessionIds)
      const usedIds = new Set((used.data ?? []).map((u) => u.session_id as string))
      const orphans = sessionIds.filter((id) => !usedIds.has(id))
      if (orphans.length) await admin.from("attendance_sessions").delete().in("id", orphans)
    }
  }

  test.afterAll(async () => {
    if (process.env.KEEP_PHASE5B_DATA === "1") return
    await cleanupTestData()
  })

  test.describe("89-92 — Access control & empty state", () => {
    test.beforeAll(async () => {
      admin = createAdminClient()

      adminSeed = await createAdmin(admin, "ADMIN", randomPhone(), "AdminSeed123!")
      createdPhones.push(adminSeed.phoneRaw)
      superSeed = await createAdmin(admin, "SUPER_ADMIN", randomPhone(), "SuperSeed123!")
      createdPhones.push(superSeed.phoneRaw)
      memberBase = await createUser(admin, "SERVED_MEMBER", randomPhone(), "BasePass123!", {
        name: "مخدوم بدون عيد ميلاد",
      })
      createdPhones.push(memberBase.phoneRaw)
      servantSeed = await createUser(admin, "SERVANT", randomPhone(), "ServantPass123!", {
        name: "خادم بعيد ميلاد",
        dob: birthdayDobFor(2),
      })
      createdPhones.push(servantSeed.phoneRaw)
    })

    test("89. A member cannot access the admin birthdays page", async ({ page }) => {
      await login(page, memberBase.phone, memberBase.password)
      await page.goto("/app/admin/birthdays")
      await expect(page).toHaveURL(/\/app\/member/, { timeout: 15_000 })
      await expect(page.getByText("أعياد الميلاد القادمة")).toHaveCount(0)
    })

    test("90. A servant cannot access the admin birthdays page", async ({ page }) => {
      await login(page, servantSeed.phone, servantSeed.password)
      await page.goto("/app/admin/birthdays")
      await expect(page).toHaveURL(/\/app\/servant/, { timeout: 15_000 })
      await expect(page.getByText("أعياد الميلاد القادمة")).toHaveCount(0)
    })

    test("91. Anonymous is sent to /login", async ({ page }) => {
      await page.goto("/app/admin/birthdays")
      await expect(page).toHaveURL(/\/login/, { timeout: 15_000 })
    })

    test("92. Empty state shows when no served member has an upcoming birthday", async ({
      page,
    }) => {
      await login(page, adminSeed.phone, adminSeed.password)
      await page.goto("/app/admin/birthdays")
      await expect(page.getByText("لا توجد أعياد قريبة")).toBeVisible()
      await expect(page.getByText("أعياد الميلاد اللي في خلال 30 يوم هتظهر هنا")).toBeVisible()
    })
  })

  test.describe("93-99 — Birthday list", () => {
    test.beforeAll(async () => {
      memberToday = await createUser(admin, "SERVED_MEMBER", randomPhone(), "TodayPass123!", {
        name: "مخدوم عيده النهاردة",
        dob: birthdayDobFor(0),
      })
      createdPhones.push(memberToday.phoneRaw)
      memberWeek = await createUser(admin, "SERVED_MEMBER", randomPhone(), "WeekPass123!", {
        name: "مخدوم أسبوع",
        dob: birthdayDobFor(3),
      })
      createdPhones.push(memberWeek.phoneRaw)
      memberMonth = await createUser(admin, "SERVED_MEMBER", randomPhone(), "MonthPass123!", {
        name: "مخدوم ٣٠ يوم",
        dob: birthdayDobFor(20),
      })
      createdPhones.push(memberMonth.phoneRaw)
      memberBoundary = await createUser(admin, "SERVED_MEMBER", randomPhone(), "BoundPass123!", {
        name: "مخدوم حد ٣٠",
        dob: birthdayDobFor(30),
      })
      createdPhones.push(memberBoundary.phoneRaw)
      memberFar = await createUser(admin, "SERVED_MEMBER", randomPhone(), "FarPass123!", {
        name: "مخدوم بعد ٣١",
        dob: birthdayDobFor(31),
      })
      createdPhones.push(memberFar.phoneRaw)
      memberInactive = await createUser(
        admin,
        "SERVED_MEMBER",
        randomPhone(),
        "InactivePass123!",
        {
          name: "مخدوم موقوف",
          dob: birthdayDobFor(5),
          status: "INACTIVE",
        }
      )
      createdPhones.push(memberInactive.phoneRaw)
    })

    test("93. Today section highlights the member whose birthday is today", async ({ page }) => {
      await login(page, adminSeed.phone, adminSeed.password)
      await page.goto("/app/admin/birthdays")

      await expect(page.getByRole("heading", { name: "أعياد الميلاد القادمة" })).toBeVisible()
      await expect(page.getByText("اليوم", { exact: true })).toBeVisible()
      const todayRow = page.getByTestId("birthday-row").filter({ hasText: memberToday.displayName! })
      await expect(todayRow).toBeVisible()
      await expect(todayRow.getByText("عيد ميلاده النهاردة 🎉")).toBeVisible()
    })

    test("94. This-week section lists the member born this week", async ({ page }) => {
      await login(page, adminSeed.phone, adminSeed.password)
      await page.goto("/app/admin/birthdays")

      await expect(page.getByText("هذا الأسبوع", { exact: true })).toBeVisible()
      const weekRow = page.getByTestId("birthday-row").filter({ hasText: memberWeek.displayName! })
      await expect(weekRow).toBeVisible()
      await expect(weekRow.getByText(/^بعد 3 يوم/)).toBeVisible()
    })

    test("95. The 30-day section lists the member born in 20 days", async ({ page }) => {
      await login(page, adminSeed.phone, adminSeed.password)
      await page.goto("/app/admin/birthdays")

      await expect(page.getByText("خلال 30 يومًا", { exact: true })).toBeVisible()
      const monthRow = page.getByTestId("birthday-row").filter({ hasText: memberMonth.displayName! })
      await expect(monthRow).toBeVisible()
      await expect(monthRow.getByText(/^بعد 20 يوم/)).toBeVisible()
    })

    test("96. The window is inclusive at exactly 30 days and excludes day 31", async ({
      page,
    }) => {
      await login(page, adminSeed.phone, adminSeed.password)
      await page.goto("/app/admin/birthdays")

      await expect(
        page.getByTestId("birthday-row").filter({ hasText: memberBoundary.displayName! })
      ).toBeVisible()
      await expect(
        page.getByTestId("birthday-row").filter({ hasText: memberFar.displayName! })
      ).toHaveCount(0)
    })

    test("97. A member without a date of birth never appears", async ({ page }) => {
      await login(page, adminSeed.phone, adminSeed.password)
      await page.goto("/app/admin/birthdays")
      await expect(
        page.getByTestId("birthday-row").filter({ hasText: "مخدوم بدون عيد ميلاد" })
      ).toHaveCount(0)
    })

    test("98. An INACTIVE member never appears", async ({ page }) => {
      await login(page, adminSeed.phone, adminSeed.password)
      await page.goto("/app/admin/birthdays")
      await expect(
        page.getByTestId("birthday-row").filter({ hasText: "مخدوم موقوف" })
      ).toHaveCount(0)
    })

    test("99. A servant's birthday never appears in the admin list", async ({ page }) => {
      await login(page, adminSeed.phone, adminSeed.password)
      await page.goto("/app/admin/birthdays")
      await expect(
        page.getByTestId("birthday-row").filter({ hasText: "خادم بعيد ميلاد" })
      ).toHaveCount(0)
    })
  })

  test.describe("100-107 — Sending a birthday greeting", () => {
    test("100. The send dialog prefills the greeting with the member's name", async ({ page }) => {
      await login(page, adminSeed.phone, adminSeed.password)
      await page.goto("/app/admin/birthdays")

      const todayRow = page.getByTestId("birthday-row").filter({ hasText: memberToday.displayName! })
      await todayRow.getByRole("button", { name: "إرسال تهنئة" }).click()

      const dialog = page.getByRole("dialog")
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText("تهنئة عيد الميلاد")).toBeVisible()
      await expect(dialog.getByLabel("العنوان")).toHaveValue("🎂 عيد ميلاد سعيد!")
      await expect(dialog.getByLabel("الرسالة")).toHaveValue(
        `كل سنة وإنت طيب يا ${memberToday.displayName} ❤️`
      )

      await dialog.getByRole("button", { name: "إلغاء" }).click()
      await expect(page.getByRole("dialog")).toHaveCount(0)
    })

    test("101. Cancel closes the dialog without sending", async ({ page }) => {
      await login(page, adminSeed.phone, adminSeed.password)
      await page.goto("/app/admin/birthdays")

      const weekRow = page.getByTestId("birthday-row").filter({ hasText: memberWeek.displayName! })
      await weekRow.getByRole("button", { name: "إرسال تهنئة" }).click()
      const dialog = page.getByRole("dialog")
      await expect(dialog).toBeVisible()

      await dialog.getByRole("button", { name: "إلغاء" }).click()
      await expect(page.getByRole("dialog")).toHaveCount(0)

      const { count } = await admin
        .from("notifications")
        .select("id", { count: "exact" })
        .eq("sender_id", adminSeed.userId)
      expect(count ?? 0).toBe(0)
    })

    test("102. Empty title/body are rejected before sending", async ({ page }) => {
      await login(page, adminSeed.phone, adminSeed.password)
      await page.goto("/app/admin/birthdays")

      const weekRow = page.getByTestId("birthday-row").filter({ hasText: memberWeek.displayName! })
      await weekRow.getByRole("button", { name: "إرسال تهنئة" }).click()
      const dialog = page.getByRole("dialog")

      await dialog.getByLabel("الرسالة").fill("")
      await dialog.getByRole("button", { name: "إرسال التهنئة" }).click()
      await expect(page.getByText("مطلوب كتابة نص التهنئة")).toBeVisible()

      await dialog.getByLabel("العنوان").fill("")
      await dialog.getByRole("button", { name: "إرسال التهنئة" }).click()
      await expect(page.getByText("مطلوب كتابة عنوان التهنئة")).toBeVisible()

      await dialog.getByRole("button", { name: "إلغاء" }).click()
      await expect(page.getByRole("dialog")).toHaveCount(0)
    })

    test("103. Send delivers a single-recipient notification for that member only", async ({
      page,
    }) => {
      await login(page, adminSeed.phone, adminSeed.password)
      await page.goto("/app/admin/birthdays")

      const todayRow = page.getByTestId("birthday-row").filter({ hasText: memberToday.displayName! })
      await todayRow.getByRole("button", { name: "إرسال تهنئة" }).click()
      const dialog = page.getByRole("dialog")
      await dialog.getByLabel("الرسالة").fill(GREETING_BODY_CUSTOM)
      await dialog.getByRole("button", { name: "إرسال التهنئة" }).click()

      await expect(page.getByText("تم إرسال تهنئة عيد الميلاد بنجاح ✓")).toBeVisible({
        timeout: 15_000,
      })

      const { data: notif } = await admin
        .from("notifications")
        .select("id, title, body, sender_id, audience")
        .eq("title", GREETING_TITLE)
        .maybeSingle()
      expect(notif).not.toBeNull()
      expect(notif!.body).toBe(GREETING_BODY_CUSTOM)
      expect(notif!.sender_id).toBe(adminSeed.userId)

      const { data: recipients } = await admin
        .from("notification_recipients")
        .select("profile_id")
        .eq("notification_id", notif!.id as string)
      expect(recipients ?? []).toHaveLength(1)
      expect((recipients ?? [])[0].profile_id).toBe(memberToday.userId)
    })

    test("104. A birthday_reminders row is written for this occurrence", async () => {
      const today = cairoDateString(new Date())
      const expected = nextBirthdayDateString(memberToday.dob!, today)

      const { data: reminder } = await admin
        .from("birthday_reminders")
        .select("profile_id, reminder_for")
        .eq("profile_id", memberToday.userId)
        .maybeSingle()
      expect(reminder).not.toBeNull()
      expect(reminder!.reminder_for).toBe(expected)
    })

    test("105. The member receives the greeting in their normal inbox", async ({ page }) => {
      await login(page, memberToday.phone, memberToday.password)
      await expect(
        page.locator('[aria-label="إشعارات غير مقروءة"]:visible').first()
      ).toContainText("1")

      await page.goto("/app/member/notifications")
      await expect(page.getByText("1 جديد")).toBeVisible()
      await expect(page.getByRole("heading", { name: GREETING_TITLE })).toBeVisible()
      await expect(page.getByText(GREETING_BODY_CUSTOM)).toBeVisible()
    })

    test("106. The send is audited with BIRTHDAY_NOTIFICATION_SENT", async () => {
      const { data: logs } = await admin
        .from("audit_logs")
        .select("action, entity, actor_id, entity_id, metadata")
        .eq("entity", "BIRTHDAY_REMINDER")
      expect(logs ?? []).toHaveLength(1)
      expect(logs![0].action).toBe("BIRTHDAY_NOTIFICATION_SENT")
      expect(logs![0].actor_id).toBe(adminSeed.userId)
      expect((logs![0].metadata as Record<string, string>).memberId).toBe(memberToday.userId)
    })

    test("107. The UI shows the sent badge and hides the send button", async ({ page }) => {
      await login(page, adminSeed.phone, adminSeed.password)
      await page.goto("/app/admin/birthdays")

      const todayRow = page.getByTestId("birthday-row").filter({ hasText: memberToday.displayName! })
      await expect(todayRow.getByText("✓ تم إرسال التهنئة")).toBeVisible()
      await expect(todayRow.getByRole("button", { name: "إرسال تهنئة" })).toHaveCount(0)
    })
  })

  test.describe("108-118 — Deduplication & security", () => {
    test("108. A second send (admin, then super admin) is rejected as already sent", async () => {
      const first = await sendBirthdayGreeting(createAdminClient(), {
        actorId: adminSeed.userId,
        actorRole: "ADMIN",
        targetProfileId: memberToday.userId,
        title: GREETING_TITLE,
        body: "مكرر",
      })
      expect(first.ok).toBe(false)
      if (!first.ok) {
        expect(first.alreadySent).toBe(true)
        expect(first.message).toBe("تم إرسال تهنئة عيد الميلاد بالفعل.")
      }

      const second = await sendBirthdayGreeting(createAdminClient(), {
        actorId: superSeed.userId,
        actorRole: "SUPER_ADMIN",
        targetProfileId: memberToday.userId,
        title: GREETING_TITLE,
        body: "مكرر مرة تانية",
      })
      expect(second.ok).toBe(false)
      if (!second.ok) expect(second.message).toBe("تم إرسال تهنئة عيد الميلاد بالفعل.")
    })

    test("109. Duplicate attempts create no additional notifications or reminders", async () => {
      const { count } = await admin
        .from("notifications")
        .select("id", { count: "exact" })
        .eq("sender_id", adminSeed.userId)
      expect(count ?? 0).toBe(1)

      const { count: rc } = await admin
        .from("birthday_reminders")
        .select("id", { count: "exact" })
        .eq("profile_id", memberToday.userId)
      expect(rc ?? 0).toBe(1)
    })

    test("110. A member cannot read birthday_reminders rows", async () => {
      const memberClient = anonClient()
      await memberClient.auth.signInWithPassword({
        phone: memberBase.phone,
        password: memberBase.password,
      })
      const { data } = await memberClient.from("birthday_reminders").select("id")
      expect((data ?? []).length).toBe(0)
    })

    test("111. A member cannot insert a birthday_reminders row", async () => {
      const memberClient = anonClient()
      await memberClient.auth.signInWithPassword({
        phone: memberBase.phone,
        password: memberBase.password,
      })
      const { error } = await memberClient.from("birthday_reminders").insert({
        profile_id: memberBase.userId,
        reminder_for: cairoDateString(new Date()),
      })
      expect(error).not.toBeNull()
    })

    test("112. A servant cannot insert a birthday_reminders row", async () => {
      const servantClient = anonClient()
      await servantClient.auth.signInWithPassword({
        phone: servantSeed.phone,
        password: servantSeed.password,
      })
      const { error } = await servantClient.from("birthday_reminders").insert({
        profile_id: servantSeed.userId,
        reminder_for: cairoDateString(new Date()),
      })
      expect(error).not.toBeNull()
    })

    test("113. The service rejects a SERVANT as the target", async () => {
      const res = await sendBirthdayGreeting(createAdminClient(), {
        actorId: adminSeed.userId,
        actorRole: "ADMIN",
        targetProfileId: servantSeed.userId,
        title: GREETING_TITLE,
        body: "x",
      })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.message).toBe("التهنئة متاحة للمخدومين فقط")
    })

    test("114. The service rejects an INACTIVE member as the target", async () => {
      const res = await sendBirthdayGreeting(createAdminClient(), {
        actorId: adminSeed.userId,
        actorRole: "ADMIN",
        targetProfileId: memberInactive.userId,
        title: GREETING_TITLE,
        body: "x",
      })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.message).toBe("الحساب غير نشط")
    })

    test("115. The service rejects a member without a date of birth", async () => {
      const res = await sendBirthdayGreeting(createAdminClient(), {
        actorId: adminSeed.userId,
        actorRole: "ADMIN",
        targetProfileId: memberBase.userId,
        title: GREETING_TITLE,
        body: "x",
      })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.message).toBe("لا يوجد تاريخ ميلاد مسجل")
    })

    test("116. The service rejects a non-admin actor", async () => {
      const memberRes = await sendBirthdayGreeting(createAdminClient(), {
        actorId: memberWeek.userId,
        actorRole: "SERVED_MEMBER",
        targetProfileId: memberToday.userId,
        title: GREETING_TITLE,
        body: "x",
      })
      expect(memberRes.ok).toBe(false)
      if (!memberRes.ok) expect(memberRes.message).toBe("غير مصرح")

      const servantRes = await sendBirthdayGreeting(createAdminClient(), {
        actorId: servantSeed.userId,
        actorRole: "SERVANT",
        targetProfileId: memberToday.userId,
        title: GREETING_TITLE,
        body: "x",
      })
      expect(servantRes.ok).toBe(false)
      if (!servantRes.ok) expect(servantRes.message).toBe("غير مصرح")
    })

    test("117. The service rejects a birthday outside the 30-day window", async () => {
      const res = await sendBirthdayGreeting(createAdminClient(), {
        actorId: adminSeed.userId,
        actorRole: "ADMIN",
        targetProfileId: memberFar.userId,
        title: GREETING_TITLE,
        body: "x",
      })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.message).toBe("عيد الميلاد مش في فترة التهنئة")
    })

    test("118. The service rejects empty title/body", async () => {
      const emptyTitle = await sendBirthdayGreeting(createAdminClient(), {
        actorId: adminSeed.userId,
        actorRole: "ADMIN",
        targetProfileId: memberWeek.userId,
        title: "   ",
        body: "نص",
      })
      expect(emptyTitle.ok).toBe(false)
      if (!emptyTitle.ok) expect(emptyTitle.message).toBe("مطلوب كتابة عنوان التهنئة")

      const emptyBody = await sendBirthdayGreeting(createAdminClient(), {
        actorId: adminSeed.userId,
        actorRole: "ADMIN",
        targetProfileId: memberWeek.userId,
        title: GREETING_TITLE,
        body: "  ",
      })
      expect(emptyBody.ok).toBe(false)
      if (!emptyBody.ok) expect(emptyBody.message).toBe("مطلوب كتابة نص التهنئة")
    })
  })

  test.describe("119-122 — Regression & final state", () => {
    test("119. The member marks the greeting read; the unread badge clears", async ({ page }) => {
      await login(page, memberToday.phone, memberToday.password)
      await expect(
        page.locator('[aria-label="إشعارات غير مقروءة"]:visible').first()
      ).toContainText("1")

      await page.goto("/app/member/notifications")
      await page.getByRole("button", { name: "تحديد كمقروء" }).first().click()
      await expect(page.getByText("● إشعار جديد")).toHaveCount(0)

      const memberClient = anonClient()
      await memberClient.auth.signInWithPassword({
        phone: memberToday.phone,
        password: memberToday.password,
      })
      const { data } = await memberClient
        .from("notification_recipients")
        .select("read_at")
        .eq("profile_id", memberToday.userId)
        .is("read_at", null)
      expect((data ?? []).length).toBe(0)

      await expect(
        page.locator('[aria-label="إشعارات غير مقروءة"]:visible')
      ).toHaveCount(0)
    })

    test("120. Anonymous is still blocked from all notification data", async () => {
      const anon = anonClient()
      const { data: notifs } = await anon.from("notifications").select("id")
      expect((notifs ?? []).length).toBe(0)
      const { data: recips } = await anon.from("notification_recipients").select("id")
      expect((recips ?? []).length).toBe(0)
      const { data: reminders } = await anon.from("birthday_reminders").select("id")
      expect((reminders ?? []).length).toBe(0)
    })

    test("121. Super Admin sees the same birthday list", async ({ page }) => {
      await login(page, superSeed.phone, superSeed.password)
      await page.goto("/app/super-admin/birthdays")

      await expect(page.getByText("هذا الأسبوع", { exact: true })).toBeVisible()
      await expect(
        page.getByTestId("birthday-row").filter({ hasText: memberWeek.displayName! })
      ).toBeVisible()
      await expect(
        page.getByTestId("birthday-row").filter({ hasText: memberToday.displayName! }).getByText(
          "✓ تم إرسال التهنئة"
        )
      ).toBeVisible()
    })

    test("122. No test data remains after the suite", async () => {
      await cleanupTestData()

      for (const phone of createdPhones.map(normalizePhone)) {
        const { data } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle()
        expect(data).toBeNull()
      }

      const { count } = await admin.from("notifications").select("id", { count: "exact" })
      expect(count ?? 0).toBe(0)

      const { count: rc } = await admin
        .from("notification_recipients")
        .select("id", { count: "exact" })
      expect(rc ?? 0).toBe(0)

      const { count: brc } = await admin
        .from("birthday_reminders")
        .select("id", { count: "exact" })
      expect(brc ?? 0).toBe(0)

      const { count: ac } = await admin
        .from("audit_logs")
        .select("id", { count: "exact" })
        .eq("entity", "BIRTHDAY_REMINDER")
      expect(ac ?? 0).toBe(0)
    })
  })
})