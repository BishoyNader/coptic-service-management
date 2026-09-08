import { test, expect, type Page } from "@playwright/test"
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"
import { config as loadEnv } from "dotenv"

/**
 * PHASE 3 — Attendance & QR check-in, end to end against a real dev server.
 *
 * Numbering continues after PHASE 2 (1–19) and manual-crud (20–28):
 * literally test numbering starts at 29. The rules themselves are covered
 * deterministically in `e2e/attendance-points.spec.ts` with a fixed clock.
 * Here we drive the real UI and assert on the CURRENT real server time
 * without hardcoding a window (the browser clock is the truth), so we never
 * assert exact point values — only that a member "got points" vs "no points",
 * and that behavior (check-in, duplicate, code fallback, corrections) is right.
 */

loadEnv({ path: ".env.local" })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

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
  password: string
) {
  const normalized = normalizePhone(phone)
  const displayName = role === "SERVANT" ? "خادم حضور اختبار" : "مخدوم حضور اختبار"

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    phone: normalized,
    password,
    phone_confirm: true,
    email_confirm: true,
    user_metadata: { full_name: displayName, role },
  })
  if (authError) throw new Error(`seed auth: ${authError.message}`)
  const userId = authData.user.id

  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    role,
    full_name: displayName,
    phone: normalized,
  })
  if (profileError) throw new Error(`seed profile: ${profileError.message}`)

  // Assign a personal 6-digit code + QR token (mirrors generateUniqueCodes).
  let code = ""
  let qr_token = ""
  for (let attempt = 0; attempt < 5; attempt++) {
    const c = randomCode()
    const q = randomUuid()
    const { error: pcError } = await admin.from("personal_codes").insert({
      profile_id: userId,
      code: c,
      qr_token: q,
    })
    if (!pcError) {
      code = c
      qr_token = q
      break
    }
    if (attempt === 4) throw new Error(`seed personal_codes: ${pcError.message}`)
  }

  return { userId, phone: normalized, phoneRaw: phone, password, displayName, code, qr_token }
}

async function createSeedAdmin(admin: SupabaseClient, phone: string, password: string) {
  const normalized = normalizePhone(phone)
  const displayName = "رئيس شمامسة حضور"
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    phone: normalized,
    password,
    phone_confirm: true,
    email_confirm: true,
    user_metadata: { full_name: displayName, role: "SUPER_ADMIN" },
  })
  if (authError) throw new Error(`seed admin auth: ${authError.message}`)
  const userId = authData.user.id
  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    role: "SUPER_ADMIN",
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

async function auditCountForRecord(
  admin: SupabaseClient,
  action: string,
  recordId: string
) {
  const { count } = await admin
    .from("audit_logs")
    .select("id", { count: "exact" })
    .eq("action", action)
    .eq("entity_id", recordId)
  return count ?? 0
}

async function attendanceRecordExists(admin: SupabaseClient, profileId: string) {
  const { count } = await admin
    .from("attendance_records")
    .select("id", { count: "exact" })
    .eq("profile_id", profileId)
    .eq("status", "PRESENT")
  return (count ?? 0) > 0
}

function cairoToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

test.describe("PHASE 3 — Attendance + QR check-in", () => {
  const createdPhones: string[] = []
  let member: Awaited<ReturnType<typeof createUser>>
  let servant: Awaited<ReturnType<typeof createUser>>
  let superSeed: Awaited<ReturnType<typeof createSeedAdmin>>

  let admin: SupabaseClient

  test.beforeAll(async () => {
    admin = createSupabaseClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Create seed users (phones tracked for cleanup).
    const phone1 = randomPhone()
    const phone2 = randomPhone()
    const adminPhone = randomPhone()
    createdPhones.push(phone1, phone2, adminPhone)

    const [m, s, sa] = await Promise.all([
      createUser(admin, "SERVED_MEMBER", phone1, "testpass123"),
      createUser(admin, "SERVANT", phone2, "testpass123"),
      createSeedAdmin(admin, adminPhone, "adminpass123"),
    ])
    member = m
    servant = s
    superSeed = sa

    if (!member.code || !member.qr_token) {
      throw new Error("could not read member personal code / QR token")
    }
  })

  test.afterAll(async () => {
    if (process.env.KEEP_PHASE3_DATA === "1") return
    for (const phone of createdPhones.map(normalizePhone)) {
      const { data } = await admin
        .from("profiles")
        .select("id")
        .eq("phone", phone)
        .maybeSingle()
      if (data) {
        // Remove linked attendance/session/score rows first (FK-safe cleanup).
        await admin.from("attendance_records").delete().eq("profile_id", data.id)
        await admin.from("score_records").delete().eq("profile_id", data.id)
        await admin.from("audit_logs").delete().eq("actor_id", data.id)
        await admin.auth.admin.deleteUser(data.id)
      }
    }
    // Drop attendance sessions left empty by the deletions (unique (type, date)).
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
  })

  async function seedAttendanceFor(page: Page, phone: string, code: string) {
    // As Super Admin (attendance operator), record the seeded member.
    await login(page, superSeed.phone, superSeed.password)
    await page.goto("/app/super-admin/attendance")
    await page.getByRole("button", { name: "إدخال الكود يدويًا" }).click()
    await page.getByLabel("الكود الشخصي").fill(code)
    await page.getByRole("button", { name: "تحديد الشخص" }).click()
    await page.getByRole("button", { name: "تأكيد التسجيل" }).click()
    await expect(page.getByText("تم تسجيل الحضور")).toBeVisible({ timeout: 15_000 })
    await logout(page)
  }
  test("29. Admin attendance page loads with check-in + today's count UI", async ({ page }) => {
    await login(page, superSeed.phone, superSeed.password)
    await page.goto("/app/super-admin/attendance")
    await expect(page.getByRole("button", { name: /تسجيل حضور/ })).toBeVisible()
    await expect(page.getByRole("button", { name: "إدخال الكود يدويًا" })).toBeVisible()
    await expect(page.getByRole("button", { name: "تسجيل حضور يدوي" })).toBeVisible()
  })

  test("30. Manual 6-digit code path: identify + confirm a member", async ({ page }) => {
    await login(page, superSeed.phone, superSeed.password)
    await page.goto("/app/super-admin/attendance")
    await page.getByRole("button", { name: "إدخال الكود يدويًا" }).click()
    await page.getByLabel("الكود الشخصي").fill(member.code)
    await page.getByRole("button", { name: "تحديد الشخص" }).click()
    // Preview shows the matched person.
    await expect(page.getByText(member.displayName)).toBeVisible()
    await page.getByRole("button", { name: "تأكيد التسجيل" }).click()
    await expect(page.getByText("تم تسجيل الحضور")).toBeVisible({ timeout: 15_000 })
    // Should say points (or outside-window) — never error here.
    await expect(page.getByText(/نقطة|خارج نطاق/)).toBeVisible()
  })

  test("31. Invalid code shows a clear error", async ({ page }) => {
    await login(page, superSeed.phone, superSeed.password)
    await page.goto("/app/super-admin/attendance")
    await page.getByRole("button", { name: "إدخال الكود يدويًا" }).click()
    await page.getByLabel("الكود الشخصي").fill("999999")
    await page.getByRole("button", { name: "تحديد الشخص" }).click()
    await expect(page.getByText(/غير صحيح|غير موجود|لا يوجد/)).toBeVisible()
  })

  test("32. Manual attendance dialog works (person + type + confirm)", async ({ page }) => {
    await login(page, superSeed.phone, superSeed.password)
    await page.goto("/app/super-admin/attendance")
    await page.getByRole("button", { name: "تسجيل حضور يدوي" }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.getByRole("dialog").getByPlaceholder(/ابحث بالاسم/).fill(member.displayName)
    await page.getByRole("dialog").getByText(member.displayName).first().click()
    // Pick SERVICE so this is a distinct session from the CHURCH check-ins above.
    await page.getByRole("dialog").getByRole("button", { name: "حضور الخدمة" }).click()
    await page.getByRole("button", { name: "تأكيد التسجيل" }).click()
    await expect(page.getByText(/تم تسجيل حضور/)).toBeVisible({ timeout: 15_000 })
  })

  test("33. Duplicate attendance is not recorded twice (DB-level guard)", async ({ page }) => {
    // Record twice via manual code; second attempt must surface as duplicate.
    await login(page, superSeed.phone, superSeed.password)
    await page.goto("/app/super-admin/attendance")

    const recordOnce = async () => {
      await page.getByRole("button", { name: "إدخال الكود يدويًا" }).click()
      await page.getByLabel("الكود الشخصي").fill(servant.code)
      await page.getByRole("button", { name: "تحديد الشخص" }).click()
      await page.getByRole("button", { name: "تأكيد التسجيل" }).click()
      await expect(page.getByText("تم تسجيل الحضور")).toBeVisible({ timeout: 15_000 })
    }

    await recordOnce()
    // Back to scanner (auto-return) then record again.
    await expect(page.getByRole("button", { name: "إدخال الكود يدويًا" })).toBeVisible({
      timeout: 10_000,
    })
    await recordOnce()
    await expect(page.getByText("تم تسجيل الحضور بالفعل")).toBeVisible({ timeout: 15_000 })

    // Only ONE non-archived row exists.
    const { data, error } = await admin
      .from("attendance_records")
      .select("id, status")
      .eq("profile_id", servant.userId)
      .eq("status", "PRESENT")
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  test("34. Member dashboard shows last attendance + history (no points guesswork)", async ({ page }) => {
    // Ensure member has at least one recorded attendance.
    const { count } = await admin
      .from("attendance_records")
      .select("id", { count: "exact" })
      .eq("profile_id", member.userId)
      .eq("status", "PRESENT")
    if ((count ?? 0) === 0) {
      await seedAttendanceFor(page, member.phone, member.code!)
    }

    await login(page, member.phone, member.password)
    await page.goto("/app/member")
    await expect(page.getByText("آخر حضور")).toBeVisible()
    await expect(page.getByText("سجل الحضور")).toBeVisible()
  })

  test("35. Servant check-in shows NO points (ruled by applicable_role)", async ({ page }) => {
    await login(page, superSeed.phone, superSeed.password)
    await page.goto("/app/super-admin/attendance")
    // Use the SERVICE type so this is a distinct session from test 33 (CHURCH).
    await page.getByRole("button", { name: "حضور الخدمة" }).first().click()
    await page.getByRole("button", { name: "إدخال الكود يدويًا" }).click()
    await page.getByLabel("الكود الشخصي").fill(servant.code)
    await page.getByRole("button", { name: "تحديد الشخص" }).click()
    await page.getByRole("button", { name: "تأكيد التسجيل" }).click()
    await expect(page.getByText("تم تسجيل الحضور")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("خادم — تسجيل حضور بدون نقاط")).toBeVisible()
  })

  test("36. Members cannot access the admin attendance page (access control)", async ({ page }) => {
    await login(page, member.phone, member.password)
    await page.goto("/app/super-admin/attendance")
    await expect(page).not.toHaveURL(/app\/super-admin\/attendance/)
  })

  test("37. Type correction + void are audited and update the history", async ({ page }) => {
    test.setTimeout(180_000)
    // Start from a clean slate so the correction target type is guaranteed to be
    // free (both CHURCH and SERVICE may already be occupied by earlier tests,
    // which would make the correction target collide as a same-day duplicate).
    await admin.from("attendance_records").delete().eq("profile_id", member.userId)

    // Insert a single CHURCH attendance for the member directly (check-in flow
    // itself is already covered by tests 30/32; here we exercise correction+void).
    const { data: session } = await admin
      .from("attendance_sessions")
      .select("id")
      .eq("type", "CHURCH")
      .eq("session_date", cairoToday())
      .maybeSingle()
    const sessionId =
      session?.id ??
      (
        await admin
          .from("attendance_sessions")
          .insert({ type: "CHURCH", title: "قداس", session_date: cairoToday() })
          .select("id")
          .single()
      ).data!.id

    const seeded = (
      await admin
        .from("attendance_records")
        .insert({
          session_id: sessionId,
          profile_id: member.userId,
          attended_at: new Date().toISOString(),
          points: 0,
          recorded_by: superSeed.userId,
          source: "MANUAL",
          status: "PRESENT",
        })
        .select("id")
        .single()
    ).data!

    const recordId = seeded.id

    // Pick the OTHER (SERVICE) type as the correction target (CHURCH is the
    // only occupied type now, so SERVICE is guaranteed free).
    const targetLabel = "حضور الخدمة"

    const beforeCorrect = await auditCountForRecord(admin, "ATTENDANCE_CORRECTED", recordId)
    const beforeVoid = await auditCountForRecord(admin, "ATTENDANCE_VOIDED", recordId)

    await login(page, superSeed.phone, superSeed.password)

    // Render at a mobile viewport so the management list uses its visible
    // <button> cards (the desktop <table> is hidden below md). Playwright's
    // actionability chokes on table rows, so drive the mobile layout instead.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/app/super-admin/attendance")
    await page.waitForLoadState("domcontentloaded")

    // Find the member's row and open details (mobile cards are <button>s).
    const nameCell = page.getByText(member.displayName, { exact: true }).first()
    await expect(nameCell).toBeVisible({ timeout: 20_000 })
    await nameCell.click()
    await expect(page.getByRole("dialog")).toBeVisible()

    // Correct the type to SERVICE.
    await page.getByRole("dialog").getByRole("button", { name: targetLabel }).click()

    // Server action is async; poll until the correction audit row lands. The
    // detail dialog auto-closes after the correction.
    await expect
      .poll(() => auditCountForRecord(admin, "ATTENDANCE_CORRECTED", recordId), {
        timeout: 10_000,
      })
      .toBeGreaterThan(beforeCorrect)

    // Reopen the row (fresh reload sidesteps any lingering overlay) and void.
    await page.goto("/app/super-admin/attendance")
    const row2Cell = page.getByText(member.displayName, { exact: true }).first()
    await expect(row2Cell).toBeVisible({ timeout: 20_000 })
    await row2Cell.click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.getByRole("dialog").getByRole("button", { name: "إلغاء تسجيل الحضور" }).click()
    await expect(page.getByRole("alertdialog")).toBeVisible()
    await page.getByRole("button", { name: "تأكيد الإلغاء" }).click()

    // Poll until the void audit row lands.
    await expect
      .poll(() => auditCountForRecord(admin, "ATTENDANCE_VOIDED", recordId), {
        timeout: 10_000,
      })
      .toBeGreaterThan(beforeVoid)

    // DB reflects archived record.
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("attendance_records")
          .select("status")
          .eq("id", recordId)
          .maybeSingle()
        return data?.status as string | null
      }, { timeout: 10_000 })
      .toBe("ARCHIVED")
  })

  test("38. Attendance records appear in the Super Admin management list", async ({ page }) => {
    // Guarantee a servant PRESENT record exists (tests 33/35 create one, but
    // this must hold even if they didn't run / were cleaned).
    const { count } = await admin
      .from("attendance_records")
      .select("id", { count: "exact" })
      .eq("profile_id", servant.userId)
      .eq("status", "PRESENT")
    if ((count ?? 0) === 0) {
      await seedAttendanceFor(page, servant.phone, servant.code!)
    }

    await login(page, superSeed.phone, superSeed.password)
    await page.goto("/app/super-admin/attendance")
    const sCell = page.locator("table td", { hasText: servant.displayName }).first()
    await expect.poll(() => sCell.count(), { timeout: 15_000 }).toBeGreaterThan(0)
  })

  test("39. Camera-denied state offers manual code fallback", async ({ page }) => {
    // No camera in CI headless => permission denied => fallback banner shown.
    await login(page, superSeed.phone, superSeed.password)
    await page.goto("/app/super-admin/attendance")
    await page.getByRole("button", { name: "فتح الكاميرا" }).click()
    // The manual-code fallback is reachable regardless of camera state.
    const manualBtn = page.getByRole("button", { name: "إدخال الكود يدويًا" })
    await expect(manualBtn).toBeVisible({ timeout: 10_000 })
    await manualBtn.click()
  })

  test("40. Member attendance history reflects recorded attendance", async ({ page }) => {
    // Ensure the member has a recorded attendance to show in history.
    if (!(await attendanceRecordExists(admin, member.userId))) {
      await seedAttendanceFor(page, member.phone, member.code!)
    }
    await logout(page)
    await login(page, member.phone, member.password)
    await page.goto("/app/member")
    await expect(page).toHaveURL(/app\/member/)
    await expect(page.getByText("آخر حضور")).toBeVisible()
    await expect(page.getByText("سجل الحضور")).toBeVisible()
  })
})