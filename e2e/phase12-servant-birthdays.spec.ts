import { test, expect, type Page } from "@playwright/test"
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"
import { config as loadEnv } from "dotenv"
import { createAdminClient } from "../src/lib/supabase/admin"
import { runBirthdayAutomation } from "../src/services/birthday-automation"
import { registerUser } from "../src/services/register-service"
import { sendBirthdayGreeting } from "../src/services/birthday-service"
import { cairoDateString } from "../src/lib/cairo"

/**
 * PHASE 12 — SERVANT birthday automation (regression for the missing
 * birthday-reminder notification bug).
 *
 * Numbering starts at 194. Covers, fully from source to sink:
 *   194-195  registration persists the DOB exactly / future DOB rejected
 *   196-198  birthdays_for_today() now returns ACTIVE SERVANTs (same-day,
 *            boundary/long-window dates, MM-DD + rollover + Feb-29 mapping)
 *   199-203  automation run → per-role audience, reminders, idempotency,
 *            cron path, silence-errors-free
 *   204-205  servant inbox delivery + recipient RLS isolation
 *   206-207  scoped design guard: admin board + manual greeting stay
 *            SERVED_MEMBER-only (existing phase-5b behaviour preserved)
 *   208     audit log records the servant greeting
 *
 * The daily automaton greets people whose Cairo birthday IS the target date;
 * the admin 30-day "upcoming" window is a separate list that remains
 * SERVED_MEMBER-scoped by design.
 */

loadEnv({ path: ".env.local" })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const GREETING_TITLE = "🎂 عيد ميلاد سعيد!"

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
  return { userId, phone: normalized, phoneRaw: phone, password, displayName: opts.name ?? role, dob: opts.dob, code }
}

async function createAdmin(
  admin: SupabaseClient,
  role: "ADMIN" | "SUPER_ADMIN",
  phone: string,
  password: string
) {
  const normalized = normalizePhone(phone)
  const displayName = role === "SUPER_ADMIN" ? "رئيس عيد ميلاد" : "مشرف عيد ميلاد"
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

test.describe("PHASE 12 — SERVANT birthday automation", () => {
  test.describe.configure({ mode: "serial" })
  const createdPhones: string[] = []
  const createdUserIds: string[] = []
  let admin: SupabaseClient
  let superAdmin: Awaited<ReturnType<typeof createAdmin>>
  let memberToday: Awaited<ReturnType<typeof createUser>>
  let servantToday: Awaited<ReturnType<typeof createUser>>
  let servantAlsoToday: Awaited<ReturnType<typeof createUser>>
  let servantLater: Awaited<ReturnType<typeof createUser>>
  let servantArchived: Awaited<ReturnType<typeof createUser>>
  let servantNoDob: Awaited<ReturnType<typeof createUser>>
  let servantDec31: Awaited<ReturnType<typeof createUser>>
  let servantJan02: Awaited<ReturnType<typeof createUser>>
  let servantFeb29: Awaited<ReturnType<typeof createUser>>

  test.beforeAll(async () => {
    admin = createAdminClient()

    superAdmin = await createAdmin(admin, "SUPER_ADMIN", randomPhone(), "Phase12Admin1!")
    createdPhones.push(superAdmin.phoneRaw)
    createdUserIds.push(superAdmin.userId)

    memberToday = await createUser(admin, "SERVED_MEMBER", randomPhone(), "Phase12Mem1!", {
      name: "مخدم عيد النهاردة",
      dob: birthdayDobFor(0),
    })
    servantToday = await createUser(admin, "SERVANT", randomPhone(), "Phase12Srv1!", {
      name: "خادم عيد النهاردة",
      dob: birthdayDobFor(0),
    })
    servantAlsoToday = await createUser(admin, "SERVANT", randomPhone(), "Phase12Srv2!", {
      name: "خادم تاني عيده النهاردة",
      dob: birthdayDobFor(0),
    })
    servantLater = await createUser(admin, "SERVANT", randomPhone(), "Phase12Srv3!", {
      name: "خادم عيده بعد خمسة",
      dob: birthdayDobFor(5),
    })
    servantArchived = await createUser(admin, "SERVANT", randomPhone(), "Phase12Srv4!", {
      name: "خادم عيده معطّل",
      dob: birthdayDobFor(0),
      status: "ARCHIVED",
    })
    servantNoDob = await createUser(admin, "SERVANT", randomPhone(), "Phase12Srv5!", {
      name: "خادم بلا تاريخ ميلاد",
    })
    servantDec31 = await createUser(admin, "SERVANT", randomPhone(), "Phase12Srv6!", {
      name: "خادم آخر السنة",
      dob: "2001-12-31",
    })
    servantJan02 = await createUser(admin, "SERVANT", randomPhone(), "Phase12Srv7!", {
      name: "خادم أول السنة",
      dob: "2001-01-02",
    })
    servantFeb29 = await createUser(admin, "SERVANT", randomPhone(), "Phase12Srv8!", {
      name: "خادم ٢٩ فبراير",
      dob: "2004-02-29",
    })

    for (const s of [
      memberToday,
      servantToday,
      servantAlsoToday,
      servantLater,
      servantArchived,
      servantNoDob,
      servantDec31,
      servantJan02,
      servantFeb29,
    ]) {
      createdPhones.push(s.phoneRaw)
      createdUserIds.push(s.userId)
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

  test("194. Registration persists a servant's DOB exactly (no timezone shift)", async () => {
    const today = cairoDateString(new Date())
    const dob0 = birthdayDobFor(0)
    const phone = normalizePhone(randomPhone())
    const res = await registerUser(admin, {
      role: "SERVANT",
      fullName: "خادم مسجّل بعيد ميلاد",
      phone,
      password: "Phase12Reg1!",
      dateOfBirth: dob0,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    createdUserIds.push(res.userId)
    createdPhones.push(phone)

    const { data: profile } = await admin
      .from("profiles")
      .select("role, status, date_of_birth")
      .eq("id", res.userId)
      .single()
    expect(profile?.role).toBe("SERVANT")
    expect(profile?.status).toBe("ACTIVE")
    // Stored as the exact YYYY-MM-DD submitted — never shifted by timezone.
    expect(profile?.date_of_birth).toBe(dob0)
    // And it is genuinely "today" on the Cairo calendar.
    expect(profile?.date_of_birth?.slice(5)).toBe(today.slice(5))
  })

  test("195. Registration rejects a future DOB (DB backstop keeps birth dates in the past)", async () => {
    const phone = normalizePhone(randomPhone())
    const res = await registerUser(admin, {
      role: "SERVANT",
      fullName: "خادم بتاريخ مستقبلي",
      phone,
      password: "Phase12Reg2!",
      dateOfBirth: cairoAddDays(cairoDateString(new Date()), 30),
    })
    expect(res.ok).toBe(false)
    // The failed registration must leave no stray auth user behind.
    const { data: leaked } = await admin.from("profiles").select("id").eq("phone", normalizePhone(phone))
    expect(leaked?.length ?? 0).toBe(0)
  })

  test("196. birthdays_for_today() now returns ACTIVE SERVANTs too (members unchanged)", async () => {
    const today = cairoDateString(new Date())
    const { data: bdays, error } = await admin.rpc("birthdays_for_today", { target_date: today })
    expect(error).toBeNull()
    const ids = new Set((bdays ?? []).map((b: { profile_id?: string }) => b.profile_id))
    expect(ids.has(servantToday.userId)).toBe(true)
    expect(ids.has(servantAlsoToday.userId)).toBe(true)
    expect(ids.has(memberToday.userId)).toBe(true)
    // Not today, archived, or missing a DOB → never eligible.
    expect(ids.has(servantLater.userId)).toBe(false)
    expect(ids.has(servantArchived.userId)).toBe(false)
    expect(ids.has(servantNoDob.userId)).toBe(false)
  })

  test("197. The calculation is leap-aware across year boundaries (MM-DD + Feb 29 decoding)", async () => {
    // A birthday five Cairo days from today becomes eligible on exactly that date.
    const laterDate = cairoAddDays(cairoDateString(new Date()), 5)
    const { data: laterRows } = await admin.rpc("birthdays_for_today", { target_date: laterDate })
    expect((laterRows ?? []).some((b: { profile_id?: string }) => b.profile_id === servantLater.userId)).toBe(true)

    // Dec 31 → Jan 2 rollover across the year boundary.
    const { data: decRows } = await admin.rpc("birthdays_for_today", { target_date: "2026-12-31" })
    expect((decRows ?? []).some((b: { profile_id?: string }) => b.profile_id === servantDec31.userId)).toBe(true)
    const { data: janRows } = await admin.rpc("birthdays_for_today", { target_date: "2027-01-02" })
    expect((janRows ?? []).some((b: { profile_id?: string }) => b.profile_id === servantJan02.userId)).toBe(true)

    // Feb 29 birthday: in a NON-leap target year it maps to Feb 28…
    const { data: nonLeapRows } = await admin.rpc("birthdays_for_today", { target_date: "2027-02-28" })
    expect((nonLeapRows ?? []).some((b: { profile_id?: string }) => b.profile_id === servantFeb29.userId)).toBe(true)
    // …and in a leap target year it must only match on Feb 29 itself, not Feb 28.
    const { data: leapFEight } = await admin.rpc("birthdays_for_today", { target_date: "2028-02-28" })
    expect((leapFEight ?? []).some((b: { profile_id?: string }) => b.profile_id === servantFeb29.userId)).toBe(false)
    const { data: leapRows } = await admin.rpc("birthdays_for_today", { target_date: "2028-02-29" })
    expect((leapRows ?? []).some((b: { profile_id?: string }) => b.profile_id === servantFeb29.userId)).toBe(true)
  })

  test("198. The automation detects today's SERVANT birthdays without errors", async () => {
    const result = await runBirthdayAutomation(admin, { senderId: superAdmin.userId })
    expect(result.totalEligible).toBeGreaterThanOrEqual(4)
    expect(result.remindersCreated).toBeGreaterThanOrEqual(3)
    expect(result.notificationsCreated).toBeGreaterThanOrEqual(3)
    expect(result.errors).toEqual([])
  })

  test("199. Notification audience and recipient follow the subject's role", async () => {
    type RecipRow = {
      profile_id?: string | null
      notification?: {
        id?: string
        title?: string | null
        body?: string | null
        audience?: string[] | null
        sender_id?: string | null
      } | null
    }
    const { data: servantRaw } = await admin
      .from("notification_recipients")
      .select("profile_id, notification:notifications(id, title, body, audience, sender_id)")
      .eq("profile_id", servantToday.userId)
      .single()
    const servantNotif = servantRaw as unknown as RecipRow | null
    expect(servantNotif?.profile_id).toBe(servantToday.userId)
    expect(servantNotif?.notification?.title).toBe(GREETING_TITLE)
    expect(servantNotif?.notification?.body).toContain("خادم عيد النهاردة")
    expect(servantNotif?.notification?.audience).toEqual(["SERVANT"])
    expect(servantNotif?.notification?.sender_id).toBe(superAdmin.userId)

    const { data: memberRaw } = await admin
      .from("notification_recipients")
      .select("profile_id, notification:notifications(id, title, audience)")
      .eq("profile_id", memberToday.userId)
      .single()
    const memberNotif = memberRaw as unknown as RecipRow | null
    expect(memberNotif?.notification?.audience).toEqual(["SERVED_MEMBER"])
  })

  test("200. Dedup reminders are recorded for the servant subjects", async () => {
    const today = cairoDateString(new Date())
    const { data: reminder } = await admin
      .from("birthday_reminders")
      .select("profile_id, reminder_for")
      .eq("profile_id", servantToday.userId)
      .eq("reminder_for", today)
      .maybeSingle()
    expect(reminder).not.toBeNull()
  })

  test("201. The automation is idempotent for servants too", async () => {
    const result = await runBirthdayAutomation(admin, { senderId: superAdmin.userId })
    expect(result.notificationsCreated).toBe(0)
    expect(result.skippedAlreadySent).toBeGreaterThanOrEqual(3)
    expect(result.errors).toEqual([])
  })

  test("202. The cron path greets servants via the CRON_SECRET bearer", async ({ request }) => {
    const res = await request.get("http://localhost:3000/api/cron/birthdays", {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.notificationsCreated).toBe(0)
    expect(body.totalEligible).toBeGreaterThanOrEqual(4)
  })

  test("203. The greeting reaches the servant's inbox", async ({ page }) => {
    await login(page, servantToday.phone, servantToday.password)
    await page.goto("/app/servant/notifications")
    await expect(page.getByText(GREETING_TITLE)).toBeVisible()

    const client = anonClient()
    const { error: signInError } = await client.auth.signInWithPassword({
      phone: servantToday.phone,
      password: servantToday.password,
    })
    expect(signInError).toBeNull()
    const { count } = await client
      .from("notification_recipients")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", servantToday.userId)
      .is("read_at", null)
    expect(count ?? 0).toBeGreaterThanOrEqual(1)
  })

  test("204. Recipient RLS: another servant cannot read or see the recipient's row", async ({ page }) => {
    const other = anonClient()
    await other.auth.signInWithPassword({
      phone: servantAlsoToday.phone,
      password: servantAlsoToday.password,
    })
    const { data: rows } = await other
      .from("notification_recipients")
      .select("id")
      .eq("profile_id", servantToday.userId)
    expect(rows?.length ?? 0).toBe(0)

    // And their inbox never shows the other servant's greeting.
    await login(page, servantAlsoToday.phone, servantAlsoToday.password)
    await page.goto("/app/servant/notifications")
    await expect(page.getByText("كل سنة وإنت طيب يا خادم عيد النهاردة")).toHaveCount(0)
  })

  test("205. Scoped design: the admin 30-day board stays SERVED_MEMBER-only", async ({ page }) => {
    await login(page, superAdmin.phone, superAdmin.password)
    await page.goto("/app/super-admin/birthdays")
    await expect(page.getByTestId("birthday-row").filter({ hasText: memberToday.displayName! })).toHaveCount(1)
    await expect(page.getByTestId("birthday-row").filter({ hasText: "خادم عيد النهاردة" })).toHaveCount(0)
  })

  test("206. Scoped design: the manual greeting still rejects a SERVANT target", async () => {
    const res = await sendBirthdayGreeting(admin, {
      actorId: superAdmin.userId,
      actorRole: "SUPER_ADMIN",
      targetProfileId: servantToday.userId,
      title: "🎂 عيد ميلاد سعيد!",
      body: "كل سنة وإنت طيب",
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.message).toBe("التهنئة متاحة للمخدومين فقط")
  })

  test("207. The automation writes an audit log with the servant's role", async () => {
    const { data: logs } = await admin
      .from("audit_logs")
      .select("actor_id, action, entity, metadata")
      .eq("actor_id", superAdmin.userId)
      .eq("action", "BIRTHDAY_NOTIFICATION_SENT")
      .order("created_at", { ascending: false })
    expect(Array.isArray(logs)).toBe(true)
    const servantLog = (logs ?? []).find(
      (l) => (l.metadata as { memberId?: string })?.memberId === servantToday.userId
    )
    expect(servantLog).toBeTruthy()
    expect((servantLog!.metadata as { memberRole?: string }).memberRole).toBe("SERVANT")
  })
})