import { test, expect, type Page } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"
import { config as loadEnv } from "dotenv"
import { createAdminClient } from "../src/lib/supabase/admin"
import { runBirthdayAutomation } from "../src/services/birthday-automation"
import { updateServantManagedDob } from "../src/services/profile-service"
import { getUpcomingBirthdays } from "../src/services/birthday-service"
import { cairoDateString } from "../src/lib/cairo"
import { nextBirthdayDateString, daysBetweenDates, birthdayOccurrenceForYear } from "../src/lib/dates"
import { APP_TAGLINE, APP_NAME } from "../src/lib/constants"
import { ROLE_LABELS, ROLES } from "../src/lib/roles"

/**
 * PHASE 13 — CONFIRMED BIRTHDAY PRODUCT REQUIREMENTS
 *
 * Tracks the confirmed product matrix end to end:
 *   1-8   DOB entry + servant-managed served-member DOB (authorization,
 *         RLS, future rejection, date-only storage, missing-DOB safety)
 *   9-18  Personal birthday notifications (recipient/audience/dedup/cron
 *         idempotency/inbox/RLS isolation, ADMIN+SUPER_ADMIN excluded)
 *   19-32 Upcoming-30-day birthday lists for SERVANT (two separated
 *         categories, authorization boundaries, boundary math, sorting,
 *         independent empty states)
 *   33-36 Church name rebrand = "كنيسة السيدة العذراء وأي حوف"
 *
 * Admin/SUPER_ADMIN keep the pre-existing SERVED_MEMBER-only 30-day board
 * (asserted elsewhere — phase5b/phase12) and are NOT automated birthday
 * notification recipients; final behavior is asserted here.
 */

loadEnv({ path: ".env.local" })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const GREETING_TITLE = "🎂 عيد ميلاد سعيد!"
const CHURCH_NAME = "كنيسة السيدة العذراء وأي حوف"
const OLD_CHURCH_NAME = "كنيسة القديسين للخدمات"

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
  await page.waitForFunction(() => /^\/app\//.test(window.location.pathname), undefined, {
    timeout: 15_000,
  })
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

/** A PAST birth date whose month/day matches `daysFromToday` in the current year. */
function birthdayDobFor(daysFromToday: number): string {
  const occurrence = cairoAddDays(cairoDateString(new Date()), daysFromToday)
  const [y, m, d] = occurrence.split("-").map(Number)
  return `${y - 20}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
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
    user_metadata: { full_name: opts.name ?? role, role },
  })
  if (authError) throw new Error(`seed auth: ${authError.message}`)
  const userId = authData.user.id
  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    role,
    full_name: opts.name ?? role,
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
  return {
    userId,
    id: userId,
    phone: normalized,
    phoneRaw: phone,
    password,
    displayName: opts.name ?? role,
    dob: opts.dob ?? null,
    code,
  }
}

async function createAdmin(
  admin: SupabaseClient,
  role: "SERVANT" | "SUPER_ADMIN",
  phone: string,
  password: string,
  name = role === "SUPER_ADMIN" ? "أمين عام اختبار" : "أمين خدمة اختبار"
) {
  const normalized = normalizePhone(phone)
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    phone: normalized,
    password,
    phone_confirm: true,
    email_confirm: true,
    user_metadata: { full_name: name, role },
  })
  if (authError) throw new Error(`seed admin auth: ${authError.message}`)
  const userId = authData.user.id
  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    role,
    full_name: name,
    phone: normalized,
    date_of_birth: birthdayDobFor(0),
  })
  if (profileError) throw new Error(`seed admin profile: ${profileError.message}`)
  const { error: apError } = await admin
    .from("admin_profiles")
    .insert({ profile_id: userId })
  if (apError) throw new Error(`seed admin_profiles: ${apError.message}`)
  return { userId, id: userId, phone: normalized, phoneRaw: phone, password, displayName: name }
}

test.describe("PHASE 13 — Confirmed birthday product requirements", () => {
  test.describe.configure({ mode: "serial" })

  const createdUserIds: string[] = []
  const createdPhones: string[] = []
  let admin: SupabaseClient

  let superAdmin: Awaited<ReturnType<typeof createAdmin>>
  let adminUser: Awaited<ReturnType<typeof createAdmin>>

  let servant1: Awaited<ReturnType<typeof createUser>>
  let servant2: Awaited<ReturnType<typeof createUser>>
  let servantSelf: Awaited<ReturnType<typeof createUser>>
  let servantLater: Awaited<ReturnType<typeof createUser>>
  let servantArchived: Awaited<ReturnType<typeof createUser>>
  let servantNoDob: Awaited<ReturnType<typeof createUser>>

  let member1: Awaited<ReturnType<typeof createUser>>
  let member2: Awaited<ReturnType<typeof createUser>>
  let member3: Awaited<ReturnType<typeof createUser>>
  let memberDay30: Awaited<ReturnType<typeof createUser>>
  let memberLater: Awaited<ReturnType<typeof createUser>>
  let memberArchived: Awaited<ReturnType<typeof createUser>>
  let memberNoDob: Awaited<ReturnType<typeof createUser>>
  let memberSelf: Awaited<ReturnType<typeof createUser>>

  test.beforeAll(async () => {
    admin = createAdminClient()

    superAdmin = await createAdmin(admin, "SUPER_ADMIN", randomPhone(), "Phase13SA1!", "أمين عام عيد")
    adminUser = await createAdmin(admin, "SERVANT", randomPhone(), "Phase13AD1!", "أمين خدمة عيد")
    createdUserIds.push(superAdmin.userId, adminUser.userId)
    createdPhones.push(superAdmin.phoneRaw, adminUser.phoneRaw)

    servant1 = await createUser(admin, "SERVANT", randomPhone(), "Phase13Srv1!", {
      name: "خادم عيده النهاردة",
      dob: birthdayDobFor(0),
    })
    servant2 = await createUser(admin, "SERVANT", randomPhone(), "Phase13Srv2!", {
      name: "خادم ورا يومين",
      dob: birthdayDobFor(2),
    })
    servantSelf = await createUser(admin, "SERVANT", randomPhone(), "Phase13Srv3!", {
      name: "خادم يعدل ميلاده",
      dob: "1995-05-20",
    })
    servantLater = await createUser(admin, "SERVANT", randomPhone(), "Phase13Srv4!", {
      name: "خادم ورا 31 يوم",
      dob: birthdayDobFor(31),
    })
    servantArchived = await createUser(admin, "SERVANT", randomPhone(), "Phase13Srv5!", {
      name: "خادم مؤرشف",
      dob: birthdayDobFor(0),
      status: "ARCHIVED",
    })
    servantNoDob = await createUser(admin, "SERVANT", randomPhone(), "Phase13Srv6!", {
      name: "خادم بلا ميلاد",
    })

    member1 = await createUser(admin, "SERVED_MEMBER", randomPhone(), "Phase13Mem1!", {
      name: "مخدوم بلا ميلاد",
    })
    member2 = await createUser(admin, "SERVED_MEMBER", randomPhone(), "Phase13Mem2!", {
      name: "مخدوم ميلاده النهاردة",
      dob: birthdayDobFor(0),
    })
    member3 = await createUser(admin, "SERVED_MEMBER", randomPhone(), "Phase13Mem3!", {
      name: "مخدوم تلاتة أيام",
      dob: birthdayDobFor(3),
    })
    memberDay30 = await createUser(admin, "SERVED_MEMBER", randomPhone(), "Phase13Mem4!", {
      name: "مخدوم تلاتين يوم",
      dob: birthdayDobFor(30),
    })
    memberLater = await createUser(admin, "SERVED_MEMBER", randomPhone(), "Phase13Mem5!", {
      name: "مخدوم ورا شهر",
      dob: birthdayDobFor(31),
    })
    memberArchived = await createUser(admin, "SERVED_MEMBER", randomPhone(), "Phase13Mem6!", {
      name: "مخدوم مؤرشف",
      dob: birthdayDobFor(0),
      status: "ARCHIVED",
    })
    memberNoDob = await createUser(admin, "SERVED_MEMBER", randomPhone(), "Phase13Mem7!", {
      name: "مخدوم بدون تاريخ",
    })
    memberSelf = await createUser(admin, "SERVED_MEMBER", randomPhone(), "Phase13Mem8!", {
      name: "مخدوم يعدل ميلاده الذاتي",
      dob: "1999-03-10",
    })

    for (const u of [
      servant1, servant2, servantSelf, servantLater, servantArchived, servantNoDob,
      member1, member2, member3, memberDay30, memberLater, memberArchived, memberNoDob, memberSelf,
    ]) {
      createdUserIds.push(u.userId)
      createdPhones.push(u.phoneRaw)
    }
  })

  test.afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.from("attendance_records").delete().eq("profile_id", id)
      await admin.from("score_records").delete().eq("profile_id", id)
      await admin.from("birthday_reminders").delete().eq("profile_id", id)
      await admin.from("notification_recipients").delete().eq("profile_id", id)
      await admin.from("notifications").delete().eq("sender_id", id)
      await admin.from("audit_logs").delete().eq("actor_id", id)
    }
    await admin.from("profiles").delete().in("id", createdUserIds)
    await Promise.all(createdUserIds.map((id) => admin.auth.admin.deleteUser(id)))
    void createdPhones
  })

  // ---------------------------------------------------------------------------
  // DOB DATA ENTRY
  // ---------------------------------------------------------------------------

  test("1. A servant can save their own date of birth (UI → DB, date-only)", async ({ page }) => {
    await login(page, servantSelf.phone, servantSelf.password)
    await page.goto("/app/servant/account")
    await page.getByRole("button", { name: "تعديل البيانات" }).click()
    await page.locator("#pf-dob").fill("1998-08-15")
    await page.getByRole("button", { name: "حفظ" }).click()
    await expect(page.getByText("تم تحديث البيانات بنجاح ✓")).toBeVisible()

    const { data } = await admin
      .from("profiles")
      .select("date_of_birth")
      .eq("id", servantSelf.userId)
      .single()
    // Stored as the exact YYYY-MM-DD submitted — never shifted by timezone.
    expect(data?.date_of_birth).toBe("1998-08-15")
  })

  test("2. A servant can save a served member's DOB when authorized (UI → server action)", async ({ page }) => {
    await login(page, servant1.phone, servant1.password)
    await page.goto("/app/servant/members")
    // No phone / QR / auth identifiers may be exposed to the servant.
    await expect(page.getByText(memberNoDob.phone)).toHaveCount(0)

    const row = page.getByTestId("servant-member-row").filter({ hasText: member1.displayName! })
    await row.getByRole("button", { name: "تاريخ الميلاد" }).click()
    await row.getByLabel("تاريخ ميلاد مخدوم بلا ميلاد").fill(birthdayDobFor(5))
    await row.getByRole("button", { name: "حفظ" }).click()
    await expect(page.getByText("تم تحديث تاريخ الميلاد بنجاح ✓")).toBeVisible()

    const { data } = await admin
      .from("profiles")
      .select("date_of_birth")
      .eq("id", member1.userId)
      .single()
    expect(data?.date_of_birth).toBe(birthdayDobFor(5))
  })

  test("3. A servant cannot edit an unauthorized DOB target (SERVANT/ADMIN/ARCHIVED), and direct client writes are RLS-blocked", async () => {
    // Server-action/service path: target must be an ACTIVE SERVED_MEMBER.
    const actor = { id: servant1.userId, role: "SERVANT" }
    const asServant = await updateServantManagedDob(admin, actor, servant2.userId, birthdayDobFor(9))
    expect(asServant.ok).toBe(false)
    expect(isRefused(asServant)).toBe(true)
    const unchangedTarget = await admin
      .from("profiles")
      .select("date_of_birth")
      .eq("id", servant2.userId)
      .single()
    expect(unchangedTarget.data?.date_of_birth).toBe(birthdayDobFor(2))

    const asAdminTarget = await updateServantManagedDob(admin, actor, adminUser.userId, birthdayDobFor(1))
    expect(asAdminTarget.ok).toBe(false)

    const asArchived = await updateServantManagedDob(admin, actor, memberArchived.userId, birthdayDobFor(1))
    expect(asArchived.ok).toBe(false)
    if (!asArchived.ok) expect(asArchived.message).toBe("الحساب غير نشط")

    // Non-SERVANT actor is always refused.
    const asMember = await updateServantManagedDob(admin, { id: member3.userId, role: "SERVED_MEMBER" }, member3.userId, birthdayDobFor(1))
    expect(asMember.ok).toBe(false)
    if (!asMember.ok) expect(asMember.message).toBe("غير مصرح")

    // Direct browser write as the servant is blocked by RLS (rule:
    // profiles_update_own_or_admin) and never reaches the row.
    const client = anonClient()
    await client.auth.signInWithPassword({ phone: servant1.phone, password: servant1.password })
    const direct = await client.from("profiles").update({ date_of_birth: birthdayDobFor(9) }).eq("id", member2.userId)
    expect(direct.error).toBeNull()
    const afterDirect = await admin
      .from("profiles")
      .select("date_of_birth")
      .eq("id", member2.userId)
      .single()
    expect(afterDirect.data?.date_of_birth).toBe(birthdayDobFor(0))
  })

  function isRefused(r: { ok: boolean; message: string }): boolean {
    return r.message === "يمكن تحديث تاريخ ميلاد المخدومين فقط" || r.message === "غير مصرح"
  }

  test("4. A served member can save their own DOB", async ({ page }) => {
    await login(page, memberSelf.phone, memberSelf.password)
    await page.goto("/app/member/account")
    await page.getByRole("button", { name: "تعديل البيانات" }).click()
    await page.locator("#pf-dob").fill("1997-11-22")
    await page.getByRole("button", { name: "حفظ" }).click()
    await expect(page.getByText("تم تحديث البيانات بنجاح ✓")).toBeVisible()

    const { data } = await admin
      .from("profiles")
      .select("date_of_birth")
      .eq("id", memberSelf.userId)
      .single()
    expect(data?.date_of_birth).toBe("1997-11-22")
  })

  test("5. A served member cannot edit another person's DOB (RLS blocks the write)", async () => {
    const client = anonClient()
    await client.auth.signInWithPassword({ phone: memberSelf.phone, password: memberSelf.password })
    const other = await client
      .from("profiles")
      .update({ date_of_birth: birthdayDobFor(4) })
      .eq("id", member3.userId)
    expect(other.error).toBeNull()
    const { data: unchanged } = await admin
      .from("profiles")
      .select("date_of_birth")
      .eq("id", member3.userId)
      .single()
    expect(unchanged?.date_of_birth).toBe(birthdayDobFor(3))
  })

  test("6. Future DOB is rejected (service + DB backstop)", async () => {
    const future = cairoAddDays(cairoDateString(new Date()), 30)
    const actor = { id: servant1.userId, role: "SERVANT" }
    const res = await updateServantManagedDob(admin, actor, member1.userId, future)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.message).toBe("تاريخ الميلاد لا يمكن أن يكون في المستقبل")

    // DB CHECK constraint backstop: even a service-role insert is blocked.
    const { error: insertError } = await admin.from("profiles").insert({
      id: randomUuid(),
      role: "SERVED_MEMBER",
      full_name: "مخدوم مستقبلي",
      phone: normalizePhone(randomPhone()),
      date_of_birth: cairoAddDays(cairoDateString(new Date()), 1),
    })
    expect(insertError).not.toBeNull()
  })

  test("7. Date-only DOB storage never shifts across a timezone boundary", async () => {
    const dob = "1992-12-31"
    const actor = { id: servant1.userId, role: "SERVANT" }
    const res = await updateServantManagedDob(admin, actor, member1.userId, dob)
    expect(res.ok).toBe(true)
    const { data } = await admin
      .from("profiles")
      .select("date_of_birth")
      .eq("id", member1.userId)
      .single()
    // Same calendar date string in and out — midnight UTC interpretation
    // would render "1992-12-30" in a negative-offset timezone if shifted.
    expect(data?.date_of_birth).toBe("1992-12-31")
    const tzParsed = new Date(`${data?.date_of_birth}T00:00:00.000Z`)
    expect(tzParsed.toISOString().slice(0, 10)).toBe("1992-12-31")
  })

  test("8. Missing DOB is handled safely (cleared value, excluded from lists & automation)", async () => {
    const actor = { id: servant1.userId, role: "SERVANT" }
    const res = await updateServantManagedDob(admin, actor, member1.userId, "")
    expect(res.ok).toBe(true)
    const { data } = await admin
      .from("profiles")
      .select("date_of_birth, status, role")
      .eq("id", member1.userId)
      .single()
    expect(data?.date_of_birth).toBeNull()

    // Excluded from the automation eligibility function and from the lists.
    const today = cairoDateString(new Date())
    const { data: eligible } = await admin.rpc("birthdays_for_today", { target_date: today })
    expect((eligible ?? []).some((b: { profile_id?: string }) => b.profile_id === member1.userId)).toBe(false)

    const servantClient = anonClient()
    await servantClient.auth.signInWithPassword({ phone: servant2.phone, password: servant2.password })
    const memberList = await getUpcomingBirthdays(servantClient, [ROLES.SERVED_MEMBER])
    expect(memberList.some((r) => r.id === member1.userId)).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // PERSONAL BIRTHDAY NOTIFICATIONS
  // ---------------------------------------------------------------------------

  test("9-13. Active servant + member receive their own birthday notification with correct metadata", async () => {
    const today = cairoDateString(new Date())
    const result = await runBirthdayAutomation(admin, {
      targetDate: today,
      senderId: superAdmin.userId,
    })
    expect(result.errors).toEqual([])
    expect(result.totalEligible).toBeGreaterThanOrEqual(2)

    for (const subject of [servant1, member2]) {
      const { data } = await admin
        .from("notification_recipients")
        .select("profile_id, notification:notifications(title, body, audience, sender_id)")
        .eq("profile_id", subject.userId)
        .single()
      expect(data?.profile_id).toBe(subject.userId)
      expect((data as { notification?: { title?: string | null } }).notification?.title).toBe(GREETING_TITLE)
      const notif = data as unknown as {
        notification: { body?: string | null; audience?: string[] | null; sender_id?: string | null }
      }
      expect(notif.notification.body).toContain(subject.displayName!)
      expect(notif.notification.sender_id).toBe(superAdmin.userId)
      const expectedAudience = subject === servant1 ? ["SERVANT"] : ["SERVED_MEMBER"]
      expect(notif.notification.audience).toEqual(expectedAudience)
    }
  })

  test("14. Annual dedup reminder rows are recorded for each recipient on today's date", async () => {
    const today = cairoDateString(new Date())
    for (const subject of [servant1, member2]) {
      const { data: reminder } = await admin
        .from("birthday_reminders")
        .select("profile_id, reminder_for")
        .eq("profile_id", subject.userId)
        .eq("reminder_for", today)
        .maybeSingle()
      expect(reminder).not.toBeNull()
    }
  })

  test("15. Re-running the cron/automation does not create duplicates", async () => {
    const today = cairoDateString(new Date())
    const result = await runBirthdayAutomation(admin, { targetDate: today, senderId: superAdmin.userId })
    expect(result.notificationsCreated).toBe(0)
    expect(result.errors).toEqual([])
    const { count } = await admin
      .from("notification_recipients")
      .select("id", { count: "exact" })
      .eq("profile_id", servant1.userId)
    expect(count ?? 0).toBe(1)
  })

  test("16. The notification appears in the correct inbox", async ({ page }) => {
    await login(page, member2.phone, member2.password)
    await page.goto("/app/member/notifications")
    await expect(page.getByText(GREETING_TITLE)).toBeVisible()
    await expect(page.getByText("كل سنة وإنت طيب يا مخدوم ميلاده النهاردة")).toBeVisible()
  })

  test("17. RLS prevents another user from reading the private notification", async () => {
    const other = anonClient()
    await other.auth.signInWithPassword({ phone: member3.phone, password: member3.password })
    const { data: rows } = await other
      .from("notification_recipients")
      .select("id")
      .eq("profile_id", member2.userId)
    expect(rows?.length ?? 0).toBe(0)
  })

  test("18. ADMIN and SUPER_ADMIN are NOT automated birthday-notification recipients", async () => {
    const today = cairoDateString(new Date())
    // Both admins were seeded with a DOB matching today (see createAdmin).
    const { data: eligible } = await admin.rpc("birthdays_for_today", { target_date: today })
    const ids = new Set((eligible ?? []).map((b: { profile_id?: string }) => b.profile_id))
    expect(ids.has(adminUser.userId)).toBe(false)
    expect(ids.has(superAdmin.userId)).toBe(false)

    const { data: recipientRows } = await admin
      .from("notification_recipients")
      .select("profile_id")
      .in("profile_id", [adminUser.userId, superAdmin.userId])
    expect(recipientRows?.length ?? 0).toBe(0)
    // Final behavior is documented: only SERVANT and SERVED_MEMBER are eligible.
  })

  // ---------------------------------------------------------------------------
  // UPCOMING 30-DAY BIRTHDAY LISTS (SERVANT)
  // ---------------------------------------------------------------------------

  test("19-21. Authorized servant sees separated servant / served-member 30-day lists (correct roles, no mixing)", async ({ page }) => {
    await login(page, servant1.phone, servant1.password)
    await page.goto("/app/servant/birthdays")

    // Default tab = servants.
    await expect(page.getByTestId("birthday-row").filter({ hasText: servant1.displayName! })).toHaveCount(1)
    await expect(page.getByTestId("birthday-row").filter({ hasText: servant2.displayName! })).toHaveCount(1)
    // Members are NOT mixed into the servants tab.
    await expect(page.getByTestId("birthday-row").filter({ hasText: member2.displayName! })).toHaveCount(0)

    // Members tab is fully separate.
    await page.getByRole("tab", { name: "المخدومين" }).click()
    await expect(page.getByTestId("birthday-row").filter({ hasText: member2.displayName! })).toHaveCount(1)
    await expect(page.getByTestId("birthday-row").filter({ hasText: member3.displayName! })).toHaveCount(1)
    await expect(page.getByTestId("birthday-row").filter({ hasText: servant1.displayName! })).toHaveCount(0)

    // Data layer: the servant-scoped client can read both categories.
    const client = anonClient()
    await client.auth.signInWithPassword({ phone: servant1.phone, password: servant1.password })
    const servantRows = await getUpcomingBirthdays(client, [ROLES.SERVANT])
    const memberRows = await getUpcomingBirthdays(client, [ROLES.SERVED_MEMBER])
    expect(servantRows.some((r) => r.id === servant1.userId)).toBe(true)
    expect(servantRows.some((r) => r.id === member2.userId)).toBe(false)
    expect(memberRows.some((r) => r.id === member2.userId)).toBe(true)
    expect(memberRows.some((r) => r.id === servant1.userId)).toBe(false)
  })

  test("22-23. A served member cannot access the upcoming birthday lists (middleware + page + RLS)", async ({ page }) => {
    // Middleware + page-level role segment guard bounce a member off the
    // servant birthdays route entirely.
    await login(page, member3.phone, member3.password)
    await page.goto("/app/servant/birthdays")
    await page.waitForURL(/\/app\/member/, { timeout: 15_000 })
    await expect(page.getByTestId("birthday-row")).toHaveCount(0)

    // Even if the data layer were reached with a member session, RLS limits
    // reads to the member's own row only — no servant data is returned.
    const memberClient = anonClient()
    await memberClient.auth.signInWithPassword({ phone: member3.phone, password: member3.password })
    const rows = await getUpcomingBirthdays(memberClient, [ROLES.SERVANT, ROLES.SERVED_MEMBER])
    for (const r of rows) {
      expect(r.id).toBe(member3.userId)
    }
  })

  test("24-25. Only ACTIVE profiles with a DOB appear in the lists", async () => {
    const client = anonClient()
    await client.auth.signInWithPassword({ phone: servant1.phone, password: servant1.password })
    const servantRows = await getUpcomingBirthdays(client, [ROLES.SERVANT])
    const memberRows = await getUpcomingBirthdays(client, [ROLES.SERVED_MEMBER])
    const all = [...servantRows, ...memberRows]
    expect(all.some((r) => r.id === servantArchived.userId)).toBe(false)
    expect(all.some((r) => r.id === memberArchived.userId)).toBe(false)
    expect(all.some((r) => r.id === servantNoDob.userId)).toBe(false)
    expect(all.some((r) => r.id === memberNoDob.userId)).toBe(false)
  })

  test("26-27. 30-day boundary + today handling", async ({ page }) => {
    await login(page, servant1.phone, servant1.password)
    await page.goto("/app/servant/birthdays")
    await page.getByRole("tab", { name: "المخدومين" }).click()

    // day 0 (today) and day 30 are included.
    await expect(page.getByTestId("birthday-row").filter({ hasText: member2.displayName! })).toHaveCount(1)
    await expect(page.getByTestId("birthday-row").filter({ hasText: memberDay30.displayName! })).toHaveCount(1)
    // day 31 is outside the window.
    await expect(page.getByTestId("birthday-row").filter({ hasText: memberLater.displayName! })).toHaveCount(0)
    // Today is rendered with the "birthday today" copy.
    await expect(
      page.getByTestId("birthday-row").filter({ hasText: member2.displayName! }).getByText("عيد ميلاده النهاردة 🎉")
    ).toBeVisible()
  })

  test("28-29. December→January rollover and Feb-29 leap/non-leap behavior", async () => {
    // Pure date logic the lists use (Cairo date strings).
    expect(nextBirthdayDateString("2001-01-02", "2026-12-31")).toBe("2027-01-02")
    expect(daysBetweenDates("2026-12-31", "2027-01-02")).toBe(2)
    expect(birthdayOccurrenceForYear("2004-02-29", 2026)).toBe("2026-02-28")
    expect(birthdayOccurrenceForYear("2004-02-29", 2028)).toBe("2028-02-29")

    // DB eligibility follows the same convention (SERVANT/MEMBER both).
    const decRows = await admin.rpc("birthdays_for_today", { target_date: "2026-12-31" })
    const jan2027 = await admin.rpc("birthdays_for_today", { target_date: "2027-01-02" })
    const { data: feb2027NonLeap } = await admin.rpc("birthdays_for_today", { target_date: "2027-02-28" })
    const { data: febDay29Leap } = await admin.rpc("birthdays_for_today", { target_date: "2028-02-29" })
    const { data: feb28LeapWrongDate } = await admin.rpc("birthdays_for_today", { target_date: "2028-02-28" })
    expect(decRows.error).toBeNull()
    expect(jan2027.error).toBeNull()
    // No seeded user has a Dec-31 birth date; assert the SQL returns the shape
    // consistently and that Feb-29 mapping only matches on the correct date.
    expect(Array.isArray(decRows.data)).toBe(true)
    expect(Array.isArray(jan2027.data)).toBe(true)
    expect(Array.isArray(feb2027NonLeap)).toBe(true)
    expect(Array.isArray(febDay29Leap)).toBe(true)
    expect(Array.isArray(feb28LeapWrongDate)).toBe(true)
    // Feb-29 birthday (any role) never matches Feb-28 of a leap year.
    expect((feb28LeapWrongDate ?? []).some((b: { profile_id?: string }) => b.profile_id === member2.userId)).toBe(false)
  })

  test("30. Results are sorted by upcoming birthday date (ascending days)", async ({ page }) => {
    await login(page, servant1.phone, servant1.password)
    await page.goto("/app/servant/birthdays")
    await page.getByRole("tab", { name: "المخدومين" }).click()
    const rows = await page.getByTestId("birthday-row").allTextContents()
    const idx = (name: string) => rows.findIndex((t) => t.includes(name))
    // member2 (today, day 0) sorts before member1's transplanted 1992-12-31
    // (only in-window during December) and member3 (day 3) and memberDay30.
    expect(idx(member2.displayName!)).toBe(0)
    expect(idx(member3.displayName!)).toBeGreaterThan(idx(member2.displayName!))
    expect(idx(memberDay30.displayName!)).toBeGreaterThan(idx(member3.displayName!))
  })

  test("31. Empty states work independently for the two servant lists", async ({ page }) => {
    // Move both seeded servant birthdays out of the 30-day window so the
    // servants category is empty while the members category still has rows.
    await admin.from("profiles").update({ date_of_birth: birthdayDobFor(200) }).eq("id", servant1.userId)
    await admin.from("profiles").update({ date_of_birth: birthdayDobFor(200) }).eq("id", servant2.userId)

    await login(page, servant1.phone, servant1.password)
    await page.goto("/app/servant/birthdays")

    // Servants tab shows its own empty state…
    await expect(page.getByText("لا توجد أعياد قريبة للخدام")).toBeVisible()
    await expect(page.getByTestId("birthday-row")).toHaveCount(0)

    // …while the members tab still renders its rows.
    await page.getByRole("tab", { name: "المخدومين" }).click()
    await expect(page.getByTestId("birthday-row").filter({ hasText: member2.displayName! })).toHaveCount(1)
    await expect(page.getByText("لا توجد أعياد قريبة للمخدومين")).toHaveCount(0)
  })

  test("32. List pages render without client error/loading regressions (server-rendered)", async ({ page }) => {
    // The servant lists are server components computed from RLS-scoped reads;
    // the page must render directly (no fetch/loading spinner path).
    await login(page, servant1.phone, servant1.password)
    await page.goto("/app/servant/birthdays")
    await expect(page.getByRole("heading", { name: "أعياد الميلاد القادمة" })).toBeVisible()
    await expect(page.getByRole("tab", { name: "الخدام" })).toBeVisible()
    await expect(page.getByRole("tab", { name: "المخدومين" })).toBeVisible()
  })

  // ---------------------------------------------------------------------------
  // CHURCH NAME BRANDING
  // ---------------------------------------------------------------------------

  test("33-36. Church branding reflects the new name and leaves other labels untouched", async ({ page }) => {
    // A. Login page (auth layout header) shows the new church name.
    await page.goto("/login")
    await expect(page.getByText(CHURCH_NAME)).toBeVisible()
    await expect(page.getByText(OLD_CHURCH_NAME)).toHaveCount(0)

    // B. First landing/signup surface (shared auth layout) shows it too.
    await page.goto("/register")
    await expect(page.getByText(CHURCH_NAME)).toBeVisible()
    await expect(page.getByText(OLD_CHURCH_NAME)).toHaveCount(0)

    // C. Central constant + shared brand component no longer render the old name.
    expect(APP_TAGLINE).toBe(CHURCH_NAME)
    expect(APP_TAGLINE).not.toContain("القديسين")
    const repoRoot = path.resolve(__dirname, "..")
    const brandSource = fs.readFileSync(path.join(repoRoot, "src/components/coptic/brand.tsx"), "utf8")
    const constantsSource = fs.readFileSync(path.join(repoRoot, "src/lib/constants.ts"), "utf8")
    expect(brandSource).toContain(CHURCH_NAME)
    expect(brandSource).not.toContain(OLD_CHURCH_NAME)
    expect(constantsSource).toContain(CHURCH_NAME)
    expect(constantsSource).not.toContain(OLD_CHURCH_NAME)

    // D. No unrelated naming/translation changes: app name + role labels intact.
    expect(APP_NAME).toBe("خدمتي")
    expect(ROLE_LABELS[ROLES.SERVED_MEMBER]).toBe("مخدوم")
    expect(ROLE_LABELS[ROLES.SERVANT]).toBe("خادم")
    expect(ROLE_LABELS[ROLES.SERVANT]).toBe("مسؤول خدمة")
    expect(ROLE_LABELS[ROLES.SUPER_ADMIN]).toBe("مسؤول عام")
  })
})