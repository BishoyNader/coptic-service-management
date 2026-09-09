import { test, expect, type Page } from "@playwright/test"
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"
import { config as loadEnv } from "dotenv"
import { createAdminClient } from "../src/lib/supabase/admin"
import { createNotification } from "../src/services/notification-service"

/**
 * PHASE 5A — Security foundation + in-app notifications, end to end.
 *
 * Numbering starts at 66. Covers: notification RLS (recipient-authoritative
 * reads), audit-log hardening, the notification service + fan-out, the admin
 * composer, member/servant inboxes, read/unread state and the nav badge.
 *
 * Order matters inside this file — later tests rely on earlier ones.
 * A single seeded "isolation" notification proves cross-user read isolation,
 * and every notification inserted here is removed in test 88.
 */

loadEnv({ path: ".env.local" })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const ISOLATION_TITLE = "إشعار عزل الاختبار (مخدوم ١ فقط)"
const MEMBER_ONLY_TITLE = "اجتماع مخدومين فقط"
const FANOUT_TITLE = "اجتماع الخدمة غدًا"
const ADMINS_TITLE = "معلومة للمسؤولين"

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
  displayName?: string
) {
  const normalized = normalizePhone(phone)
  const name =
    displayName ?? (role === "SERVANT" ? "خادم إشعار اختبار" : "مخدوم إشعار اختبار")

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
  const displayName = role === "SUPER_ADMIN" ? "رئيس إشعار اختبار" : "مشرف إشعار اختبار"
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

  test.describe("PHASE 5A — Notifications & audit security", () => {
  const createdPhones: string[] = []
  let admin: SupabaseClient
  let baseline: Record<string, number>
  let adminSeed: Awaited<ReturnType<typeof createAdmin>>
  let superSeed: Awaited<ReturnType<typeof createAdmin>>
  let member1: Awaited<ReturnType<typeof createUser>>
  let member2: Awaited<ReturnType<typeof createUser>>
  let servant: Awaited<ReturnType<typeof createUser>>

  /** Expected fan-out totals given the pre-existing intentional users. */
  const totals = {
    members: () => (baseline.SERVED_MEMBER ?? 0) + 2,
    servants: () => (baseline.SERVANT ?? 0) + 1,
    memberPlusServant: () => totals.members() + totals.servants(),
    admins: () => (baseline.ADMIN ?? 0) + 1,
  }

  test.beforeAll(async () => {
    admin = createAdminClient()

    // Record the pre-existing ACTIVE profiles per role so fan-out expectations
    // are derived from the real baseline (intentional users) rather than being
    // hard-coded. Test users are created after this snapshot.
    const { data: baselineRows } = await admin
      .from("profiles")
      .select("role, status")
      .eq("status", "ACTIVE")
    baseline = {}
    for (const p of baselineRows ?? []) {
      baseline[p.role as string] = (baseline[p.role as string] ?? 0) + 1
    }

    adminSeed = await createAdmin(admin, "ADMIN", randomPhone(), "AdminSeed123!")
    createdPhones.push(adminSeed.phoneRaw)
    superSeed = await createAdmin(admin, "SUPER_ADMIN", randomPhone(), "SuperSeed123!")
    createdPhones.push(superSeed.phoneRaw)
    member1 = await createUser(admin, "SERVED_MEMBER", randomPhone(), "Member1Pass123!")
    createdPhones.push(member1.phoneRaw)
    member2 = await createUser(admin, "SERVED_MEMBER", randomPhone(), "Member2Pass123!", "مخدوم ثاني")
    createdPhones.push(member2.phoneRaw)
    servant = await createUser(admin, "SERVANT", randomPhone(), "ServantPass123!")
    createdPhones.push(servant.phoneRaw)

    // Isolation seed: a notification visible to exactly ONE user.
    const { data: notif, error: nError } = await admin
      .from("notifications")
      .insert({
        title: ISOLATION_TITLE,
        body: "يظهر لمخدوم واحد فقط",
        audience: ["SERVED_MEMBER"],
        sender_id: adminSeed.userId,
      })
      .select("id")
      .single()
    if (nError) throw new Error(`seed isolation notification: ${nError.message}`)
    const { error: rError } = await admin.from("notification_recipients").insert({
      notification_id: notif.id as string,
      profile_id: member1.userId,
    })
    if (rError) throw new Error(`seed isolation recipient: ${rError.message}`)
  })

  async function removeIsolationSeed() {
    const { data } = await admin
      .from("notifications")
      .select("id")
      .eq("title", ISOLATION_TITLE)
      .maybeSingle()
    if (data) {
      await admin.from("notifications").delete().eq("id", data.id as string)
    }
  }

  async function cleanupTestData() {
    const userIds: string[] = []
    for (const phone of createdPhones.map(normalizePhone)) {
      const { data } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle()
      if (data) userIds.push(data.id as string)
    }

    // Notifications must be removed BEFORE users: sender_id is set null on
    // profile delete, which would orphan them. Recipients cascade with it.
    if (userIds.length) {
      await admin.from("notifications").delete().in("sender_id", userIds)
      await admin.from("audit_logs").delete().eq("entity", "NOTIFICATION")
    }

    for (const uid of userIds) {
      await admin.from("attendance_records").delete().eq("profile_id", uid)
      await admin.from("score_records").delete().eq("profile_id", uid)
      await admin.from("notification_recipients").delete().eq("profile_id", uid)
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
    if (process.env.KEEP_PHASE5_DATA === "1") return
    await cleanupTestData()
  })

  async function latestNotificationId(title: string): Promise<string> {
    const { data } = await admin
      .from("notifications")
      .select("id")
      .eq("title", title)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    expect(data).not.toBeNull()
    return data!.id as string
  }

  async function recipientCountFor(notificationId: string): Promise<number> {
    const { count } = await admin
      .from("notification_recipients")
      .select("id", { count: "exact", head: true })
      .eq("notification_id", notificationId)
    return count ?? 0
  }

  // -------------------------------------------------------------------------
  // SECURITY — RLS
  // -------------------------------------------------------------------------

  test("66. Anonymous cannot read notifications", async () => {
    const anon = anonClient()
    const { data } = await anon.from("notifications").select("id")
    expect((data ?? []).length).toBe(0)
  })

  test("67. Anonymous cannot read recipient rows", async () => {
    const anon = anonClient()
    const { data } = await anon.from("notification_recipients").select("id")
    expect((data ?? []).length).toBe(0)
  })

  test("68. A member can read only their OWN notification", async () => {
    const memberClient = anonClient()
    const { error: signin } = await memberClient.auth.signInWithPassword({
      phone: member1.phone,
      password: member1.password,
    })
    expect(signin).toBeNull()

    const { data: mine } = await memberClient
      .from("notifications")
      .select("title")
      .eq("title", ISOLATION_TITLE)
    expect(mine ?? []).toHaveLength(1)

    const otherClient = anonClient()
    await otherClient.auth.signInWithPassword({
      phone: member2.phone,
      password: member2.password,
    })
    const { data: theirs } = await otherClient
      .from("notifications")
      .select("title")
      .eq("title", ISOLATION_TITLE)
    expect(theirs ?? []).toHaveLength(0)

    const { data: foreignRows } = await otherClient
      .from("notification_recipients")
      .select("id")
      .eq("profile_id", member1.userId)
    expect((foreignRows ?? []).length).toBe(0)
  })

  test("69. A member cannot create notifications", async () => {
    const memberClient = anonClient()
    await memberClient.auth.signInWithPassword({
      phone: member1.phone,
      password: member1.password,
    })
    const { error } = await memberClient.from("notifications").insert({
      title: "مزور",
      body: "غير مسموح",
      audience: ["SERVED_MEMBER"],
      sender_id: member1.userId,
    })
    expect(error).not.toBeNull()
  })

  test("70. A member cannot create recipient rows", async () => {
    const memberClient = anonClient()
    await memberClient.auth.signInWithPassword({
      phone: member1.phone,
      password: member1.password,
    })
    const { error } = await memberClient.from("notification_recipients").insert({
      notification_id: randomUuid(),
      profile_id: member1.userId,
    })
    expect(error).not.toBeNull()
  })

  test("71. A servant cannot read the member-only notification", async () => {
    const servantClient = anonClient()
    await servantClient.auth.signInWithPassword({
      phone: servant.phone,
      password: servant.password,
    })
    const { data } = await servantClient
      .from("notifications")
      .select("id")
      .eq("title", ISOLATION_TITLE)
    expect((data ?? []).length).toBe(0)
  })

  test("72. A servant cannot create notifications or recipient rows", async () => {
    const servantClient = anonClient()
    await servantClient.auth.signInWithPassword({
      phone: servant.phone,
      password: servant.password,
    })
    const { error: nErr } = await servantClient.from("notifications").insert({
      title: "مزور",
      body: "غير مسموح",
      audience: ["SERVANT"],
      sender_id: servant.userId,
    })
    expect(nErr).not.toBeNull()

    const { error: rErr } = await servantClient.from("notification_recipients").insert({
      notification_id: randomUuid(),
      profile_id: servant.userId,
    })
    expect(rErr).not.toBeNull()
  })

  test("73. Authenticated users cannot forge audit_logs rows", async () => {
    const memberClient = anonClient()
    await memberClient.auth.signInWithPassword({
      phone: member1.phone,
      password: member1.password,
    })
    const { error: memberError } = await memberClient.from("audit_logs").insert({
      actor_id: member1.userId,
      action: "FORGED",
      entity: "TEST",
    })
    expect(memberError).not.toBeNull()

    const servantClient = anonClient()
    await servantClient.auth.signInWithPassword({
      phone: servant.phone,
      password: servant.password,
    })
    const { error: servantError } = await servantClient.from("audit_logs").insert({
      actor_id: servant.userId,
      action: "FORGED",
      entity: "TEST",
    })
    expect(servantError).not.toBeNull()
  })

  test("74. Isolation seed is removed before the send tests", async () => {
    await removeIsolationSeed()
    const { count } = await admin.from("notifications").select("id", { count: "exact" })
    expect(count ?? 0).toBe(0)
    const { count: rc } = await admin
      .from("notification_recipients")
      .select("id", { count: "exact" })
    expect(rc ?? 0).toBe(0)
  })

  // -------------------------------------------------------------------------
  // SENDING — admin composer + server-side targeting
  // -------------------------------------------------------------------------

  test("75. Composer rejects a missing audience, title or body", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await page.goto("/app/admin/notifications")
    const submit = page.getByRole("button", { name: "إرسال الإشعار" })

    await submit.click()
    await expect(page.getByText("اختار جمهور واحد على الأقل")).toBeVisible()

    await page.getByRole("checkbox", { name: "المخدومين" }).click()
    await submit.click()
    await expect(page.getByText("مطلوب كتابة عنوان الإشعار")).toBeVisible()

    await page.getByLabel("العنوان").fill("   ")
    await submit.click()
    await expect(page.getByText("مطلوب كتابة عنوان الإشعار")).toBeVisible()

    await page.getByLabel("العنوان").fill("مسودة اختبار")
    await submit.click()
    await expect(page.getByText("مطلوب كتابة نص الإشعار")).toBeVisible()
  })

  test("76. Admin composer offers only members & servants", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await page.goto("/app/admin/notifications")
    await expect(page.getByRole("checkbox", { name: "المخدومين" })).toBeVisible()
    await expect(page.getByRole("checkbox", { name: "الخدام" })).toBeVisible()
    await expect(page.getByRole("checkbox", { name: "المسؤولين" })).toHaveCount(0)
  })

  test("77. Admin sends to members only and fans out to 2 recipients", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await page.goto("/app/admin/notifications")
    await page.getByRole("checkbox", { name: "المخدومين" }).click()
    await page.getByLabel("العنوان").fill(MEMBER_ONLY_TITLE)
    await page.getByLabel("الرسالة").fill("ميعاد اجتماع الخدمة الساعة ٧ مساءً")
    await page.getByRole("button", { name: "إرسال الإشعار" }).click()

    await expect(page.getByText("تم إرسال الإشعار بنجاح ✓")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(`تم الإرسال إلى ${totals.members()} شخصًا`)).toBeVisible()

    const notificationId = await latestNotificationId(MEMBER_ONLY_TITLE)
    await expect
      .poll(async () => recipientCountFor(notificationId), { timeout: 10_000 })
      .toBe(totals.members())
  })

  test("78. Fan-out recipient set is exactly the two members", async () => {
    const notificationId = await latestNotificationId(MEMBER_ONLY_TITLE)
    const { data } = await admin
      .from("notification_recipients")
      .select("profile_id")
      .eq("notification_id", notificationId)
    const ids = new Set((data ?? []).map((r) => r.profile_id as string))
    expect(ids.size).toBe(totals.members())
    expect(ids.has(member1.userId)).toBe(true)
    expect(ids.has(member2.userId)).toBe(true)
    expect(ids.has(servant.userId)).toBe(false)
    expect(ids.has(adminSeed.userId)).toBe(false)
    expect(ids.has(superSeed.userId)).toBe(false)
  })

  test("79. The servant is not a recipient of the members-only send", async () => {
    const notificationId = await latestNotificationId(MEMBER_ONLY_TITLE)
    const servantClient = anonClient()
    await servantClient.auth.signInWithPassword({
      phone: servant.phone,
      password: servant.password,
    })
    const { data } = await servantClient
      .from("notification_recipients")
      .select("id")
      .eq("notification_id", notificationId)
    expect((data ?? []).length).toBe(0)
    const { data: nrows } = await servantClient
      .from("notifications")
      .select("id")
      .eq("title", MEMBER_ONLY_TITLE)
    expect((nrows ?? []).length).toBe(0)
  })

  test("80. Fan-out across members & servants reaches 3 recipients", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await page.goto("/app/admin/notifications")
    await page.getByRole("checkbox", { name: "المخدومين" }).click()
    await page.getByRole("checkbox", { name: "الخدام" }).click()
    await page.getByLabel("العنوان").fill(FANOUT_TITLE)
    await page.getByLabel("الرسالة").fill("اجتماع الخدمة غدًا الساعة ٧ مساءً")
    await page.getByRole("button", { name: "إرسال الإشعار" }).click()

    await expect(page.getByText("تم إرسال الإشعار بنجاح ✓")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(`تم الإرسال إلى ${totals.memberPlusServant()} شخصًا`)).toBeVisible()

    const notificationId = await latestNotificationId(FANOUT_TITLE)
    await expect
      .poll(async () => recipientCountFor(notificationId), { timeout: 10_000 })
      .toBe(totals.memberPlusServant())
  })

  test("81. Admin cannot target the ADMINS audience (server-side)", async () => {
    const res = await createNotification(createAdminClient(), {
      actorId: adminSeed.userId,
      actorRole: "ADMIN",
      title: "غير مسموح",
      body: "يجب رفض هذا",
      audiences: ["ADMIN"],
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.message).toBe("غير مسموح بإرسال إشعار لهذا الجمهور")
  })

  test("82. Super Admin targets ADMINS and the recipient is the admin", async ({ page }) => {
    await login(page, superSeed.phone, superSeed.password)
    await page.goto("/app/super-admin/notifications")
    await expect(page.getByRole("checkbox", { name: "المسؤولين" })).toBeVisible()
    await page.getByRole("checkbox", { name: "المسؤولين" }).click()
    await page.getByLabel("العنوان").fill(ADMINS_TITLE)
    await page.getByLabel("الرسالة").fill("إشعار موجه للمسؤولين")
    await page.getByRole("button", { name: "إرسال الإشعار" }).click()

    await expect(page.getByText("تم إرسال الإشعار بنجاح ✓")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(`تم الإرسال إلى ${totals.admins()} شخصًا`)).toBeVisible()

    const notificationId = await latestNotificationId(ADMINS_TITLE)
    await expect
      .poll(async () => recipientCountFor(notificationId), { timeout: 10_000 })
      .toBe(totals.admins())

    const { data: target } = await admin
      .from("notification_recipients")
      .select("profile_id")
      .eq("notification_id", notificationId)
    const recipientIds = new Set((target ?? []).map((r) => r.profile_id as string))
    expect(recipientIds.size).toBe(totals.admins())
    expect(recipientIds.has(adminSeed.userId)).toBe(true)
  })

  // -------------------------------------------------------------------------
  // MEMBER INBOX + READ/UNREAD
  // -------------------------------------------------------------------------

  test("83. Member sees 2 unread notifications with a nav badge", async ({ page }) => {
    await login(page, member1.phone, member1.password)
    await expect(
      page.locator('[aria-label="إشعارات غير مقروءة"]:visible')
    ).toHaveCount(1)
    await expect(
      page.locator('[aria-label="إشعارات غير مقروءة"]:visible').first()
    ).toContainText("2")

    await page.goto("/app/member/notifications")
    await expect(page.getByText("2 جديد")).toBeVisible()
    await expect(page.getByText("● إشعار جديد")).toHaveCount(2)
    await expect(page.getByText(MEMBER_ONLY_TITLE)).toBeVisible()
    await expect(page.getByText("ميعاد اجتماع الخدمة الساعة ٧ مساءً")).toBeVisible()
    await expect(page.getByRole("heading", { name: FANOUT_TITLE })).toBeVisible()
  })

  test("84. Member marks read; read_at persists and unread count drops", async ({ page }) => {
    await login(page, member1.phone, member1.password)
    await page.goto("/app/member/notifications")
    await page.getByRole("button", { name: "تحديد كمقروء" }).first().click()

    await expect(page.getByText("● إشعار جديد")).toHaveCount(1)

    const memberClient = anonClient()
    await memberClient.auth.signInWithPassword({
      phone: member1.phone,
      password: member1.password,
    })
    const { data: unread } = await memberClient
      .from("notification_recipients")
      .select("read_at")
      .eq("profile_id", member1.userId)
      .is("read_at", null)
    expect((unread ?? []).length).toBe(1)
    const { data: read } = await memberClient
      .from("notification_recipients")
      .select("read_at")
      .eq("profile_id", member1.userId)
      .not("read_at", "is", null)
    expect((read ?? []).length).toBe(1)

    await expect(
      page.locator('[aria-label="إشعارات غير مقروءة"]:visible')
    ).toHaveCount(1)
    await expect(
      page.locator('[aria-label="إشعارات غير مقروءة"]:visible').first()
    ).toContainText("1")
  })

  // -------------------------------------------------------------------------
  // SERVANT INBOX
  // -------------------------------------------------------------------------

  test("85. Servant receives only the targeted notification and marks it read", async ({ page }) => {
    await login(page, servant.phone, servant.password)
    await page.goto("/app/servant/notifications")

    await expect(page.getByRole("heading", { name: FANOUT_TITLE })).toBeVisible()
    await expect(page.getByText(MEMBER_ONLY_TITLE)).toHaveCount(0)
    await expect(page.getByText(ADMINS_TITLE)).toHaveCount(0)

    await page.getByRole("button", { name: "تحديد كمقروء" }).first().click()
    await expect(page.getByText("● إشعار جديد")).toHaveCount(0)

    const servantClient = anonClient()
    await servantClient.auth.signInWithPassword({
      phone: servant.phone,
      password: servant.password,
    })
    const { data } = await servantClient
      .from("notification_recipients")
      .select("id")
      .eq("profile_id", servant.userId)
      .is("read_at", null)
    expect((data ?? []).length).toBe(0)
  })

  // -------------------------------------------------------------------------
  // ADMIN SENT LIST
  // -------------------------------------------------------------------------

  test("86. Admin sent-notifications list shows the sends", async ({ page }) => {
    await login(page, adminSeed.phone, adminSeed.password)
    await page.goto("/app/admin/notifications")

    await expect(page.getByText(MEMBER_ONLY_TITLE, { exact: true }).first()).toBeVisible()
    await expect(page.getByText(FANOUT_TITLE, { exact: true }).first()).toBeVisible()
    await expect(page.getByText(ADMINS_TITLE, { exact: true }).first()).toBeVisible()

    const notifId = await latestNotificationId(MEMBER_ONLY_TITLE)
    await expect
      .poll(async () => recipientCountFor(notifId), { timeout: 10_000 })
      .toBe(totals.members())
  })

  // -------------------------------------------------------------------------
  // REGRESSION + FINAL STATE
  // -------------------------------------------------------------------------

  test("87. Anonymous access stays denied after real sends", async () => {
    const anon = anonClient()
    const { data: notifs } = await anon.from("notifications").select("id")
    expect((notifs ?? []).length).toBe(0)
    const { data: recips } = await anon.from("notification_recipients").select("id")
    expect((recips ?? []).length).toBe(0)
  })

  test("88. No test data remains after the suite", async () => {
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

    const { count: ac } = await admin
      .from("audit_logs")
      .select("id", { count: "exact" })
      .eq("entity", "NOTIFICATION")
    expect(ac ?? 0).toBe(0)
  })
})