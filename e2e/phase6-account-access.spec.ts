import { test, expect, type Page } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  createSupabaseAdmin,
  createAnonClient,
  cleanupPhones,
  randomPhone,
  randomName,
  normalizePhone,
  login,
  logout,
  createSeedAdmin,
  buildRecoveryLink,
  RECOVERY_CALLBACK,
} from "./helpers"

const PASSWORD = "testadmin123"

/** Seeds a phone-only member (no email) that can never self-recover. */
async function seedMember(
  admin: SupabaseClient,
  phone: string,
  password: string,
  name?: string
) {
  const normalized = normalizePhone(phone)
  const fullName = name ?? randomName("مخدوم")
  const { data, error } = await admin.auth.admin.createUser({
    phone: normalized,
    password,
    phone_confirm: true,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (error) throw new Error(`seed member auth: ${error.message}`)
  const { error: profileError } = await admin.from("profiles").insert({
    id: data.user.id,
    role: "SERVED_MEMBER",
    full_name: fullName,
    phone: normalized,
  })
  if (profileError) throw new Error(`seed member profile: ${profileError.message}`)
  return { userId: data.user.id, phone: normalized, phoneRaw: phone, fullName }
}

/** Seeds an account that has BOTH a phone and an email (self-recoverable). */
async function seedEmailUser(
  admin: SupabaseClient,
  opts: { phone: string; email: string; password: string; name?: string }
) {
  const normalized = normalizePhone(opts.phone)
  const fullName = opts.name ?? randomName("إيميل")
  const { data, error } = await admin.auth.admin.createUser({
    phone: normalized,
    email: opts.email,
    password: opts.password,
    phone_confirm: true,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (error) throw new Error(`seed email user auth: ${error.message}`)
  const { error: profileError } = await admin.from("profiles").insert({
    id: data.user.id,
    role: "SERVED_MEMBER",
    full_name: fullName,
    phone: normalized,
    auth_email: opts.email.toLowerCase(),
  })
  if (profileError) throw new Error(`seed email user profile: ${profileError.message}`)
  return { userId: data.user.id, phone: normalized, phoneRaw: opts.phone, fullName }
}

/** Opens the privileged-add dialog (AddPrivilegedUserButton) and fills it. */
async function createPrivilegedViaUI(
  page: Page,
  opts: {
    role: "ADMIN" | "SUPER_ADMIN"
    name: string
    phone: string
    email?: string
    password?: string
  }
) {
  await page.getByRole("button", { name: "إضافة مسؤول" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()

  if (opts.role === "ADMIN") {
    await dialog.getByRole("button", { name: "مسؤول خدمة", exact: true }).click()
  } else {
    await dialog.getByRole("button", { name: "مسؤول عام", exact: true }).click()
  }

  await dialog.locator("#pu-fullName").fill(opts.name)
  await dialog.locator("#pu-phone").fill(opts.phone)
  if (opts.email) await dialog.locator("#pu-email").fill(opts.email)
  const password = opts.password ?? PASSWORD
  await dialog.locator("#pu-password").fill(password)
  await dialog.locator("#pu-confirmPassword").fill(password)
  await dialog.getByRole("button", { name: "إضافة الحساب" }).click()
}

async function profileIdByPhone(admin: SupabaseClient, phone: string) {
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("phone", normalizePhone(phone))
    .maybeSingle()
  return data?.id
}

test.describe("PHASE 6 — Account & Access Hardening", () => {
  let admin: SupabaseClient
  let superSeed: Awaited<ReturnType<typeof createSeedAdmin>>
  const trackedPhones: string[] = []

  const track = (...phones: string[]) => trackedPhones.push(...phones)

  test.beforeAll(async () => {
    admin = createSupabaseAdmin()
    superSeed = await createSeedAdmin(admin, "SUPER_ADMIN", randomPhone(), PASSWORD)
    track(superSeed.phoneRaw)
  })

  test.afterAll(async () => {
    if (admin && trackedPhones.length) {
      await cleanupPhones(admin, trackedPhones)
    }
  })

  test("01. Super Admin can create an ADMIN via the privileged dialog (no QR/code)", async ({
    page,
  }) => {
    const phone = randomPhone()
    track(phone)
    const name = randomName("مسؤول")

    await login(page, superSeed.phoneRaw, superSeed.password)
    await expect(page).toHaveURL(/\/app\/super-admin/, { timeout: 15000 })
    await page.goto("/app/super-admin/users")

    await createPrivilegedViaUI(page, { role: "ADMIN", name, phone })

    const dialog = page.getByRole("dialog")
    await expect(dialog.getByText("تمت إضافة مسؤول خدمة بنجاح")).toBeVisible({ timeout: 15000 })
    // Translation says no personal code/QR is needed — verify none is shown.
    await expect(dialog.getByText("الكود الشخصي")).not.toBeVisible()
    await expect(dialog.locator("div.bg-coptic-gold-soft").getByText(/^\d{6}$/)).toHaveCount(0)

    await dialog.getByRole("button", { name: "إغلاق" }).click()

    // The new admin appears in the users list.
    await page.getByPlaceholder(/ابحث بالاسم|ابحث بالاسم أو رقم/).fill(name)
    await expect(page.getByText(name, { exact: false })).toBeVisible()
  })

  test("02. Created ADMIN can log in with the set password", async ({ page }) => {
    const phone = randomPhone()
    track(phone)
    const name = randomName("مسؤول")

    await login(page, superSeed.phoneRaw, superSeed.password)
    await expect(page).toHaveURL(/\/app\/super-admin/, { timeout: 15000 })
    await page.goto("/app/super-admin/users")
    await createPrivilegedViaUI(page, { role: "ADMIN", name, phone })
    await expect(page.getByRole("dialog").getByText("تمت إضافة مسؤول خدمة بنجاح")).toBeVisible({
      timeout: 15000,
    })
    await page.getByRole("dialog").getByRole("button", { name: "إغلاق" }).click()

    await logout(page)
    await login(page, phone, PASSWORD)
    await expect(page).toHaveURL(/\/app\/admin/, { timeout: 15000 })
  })

  test("03. ADMIN cannot see 'إضافة مسؤول' nor reach super-admin pages", async ({ page }) => {
    const adminSeed = await createSeedAdmin(admin, "ADMIN", randomPhone(), PASSWORD)
    track(adminSeed.phoneRaw)

    await login(page, adminSeed.phoneRaw, adminSeed.password)
    await expect(page).toHaveURL(/\/app\/admin/, { timeout: 15000 })

    await page.goto("/app/admin")
    await expect(page.getByRole("button", { name: "إضافة مسؤول" })).toHaveCount(0)

    await page.goto("/app/super-admin/users")
    await page.waitForURL(/\/login|\/app\/admin/, { timeout: 10000 })
    const url = page.url()
    expect(url.includes("/app/super-admin/users")).toBe(false)
  })

  test("04. Privileged creation: audit recorded + NO personal_code row (DB)", async ({ page }) => {
    const phone = randomPhone()
    track(phone)
    const name = randomName("امتياز")

    await login(page, superSeed.phoneRaw, superSeed.password)
    await expect(page).toHaveURL(/\/app\/super-admin/, { timeout: 15000 })
    await page.goto("/app/super-admin/users")
    await createPrivilegedViaUI(page, {
      role: "SUPER_ADMIN",
      name,
      phone,
      email: `${randomPhone()}@example.com`,
    })
    await expect(
      page.getByRole("dialog").getByText("تمت إضافة مسؤول عام بنجاح")
    ).toBeVisible({ timeout: 15000 })
    await page.getByRole("dialog").getByRole("button", { name: "إغلاق" }).click()

    const userId = await profileIdByPhone(admin, phone)
    expect(userId).toBeTruthy()

    const { data: profile } = await admin
      .from("profiles")
      .select("role, auth_email")
      .eq("id", userId)
      .maybeSingle()
    expect(profile?.role).toBe("SUPER_ADMIN")
    expect(profile?.auth_email).toBeTruthy()

    const { count: codesCount } = await admin
      .from("personal_codes")
      .select("id", { count: "exact" })
      .eq("profile_id", userId)
    expect(codesCount).toBe(0)

    const { data: audit } = await admin
      .from("audit_logs")
      .select("action, metadata")
      .eq("action", "PRIVILEGED_USER_CREATED")
      .eq("entity_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
    expect(audit?.length).toBe(1)
    expect(audit![0].metadata?.role).toBe("SUPER_ADMIN")
    expect(JSON.stringify(audit![0].metadata ?? {})).not.toContain("assword")
  })

  test("05. RLS blocks SUPER_ADMIN from changing own role/status via direct API", async () => {
    const phone = randomPhone()
    track(phone)
    const seed = await createSeedAdmin(admin, "SUPER_ADMIN", phone, PASSWORD)

    const anon = createAnonClient()
    const { error: signInError } = await anon.auth.signInWithPassword({
      phone: seed.phone,
      password: PASSWORD,
    })
    expect(signInError).toBeNull()

    const { error: roleError } = await anon
      .from("profiles")
      .update({ role: "SERVED_MEMBER" })
      .eq("id", seed.userId)
    expect(roleError).not.toBeNull()

    const { error: statusError } = await anon
      .from("profiles")
      .update({ status: "ARCHIVED" })
      .eq("id", seed.userId)
    expect(statusError).not.toBeNull()

    const { data: profile } = await admin
      .from("profiles")
      .select("role, status")
      .eq("id", seed.userId)
      .maybeSingle()
    expect(profile?.role).toBe("SUPER_ADMIN")
    expect(profile?.status).toBe("ACTIVE")
  })

  test("06. Forgot password: phone identifier shows generic message (no enumeration)", async ({
    page,
  }) => {
    const phone = randomPhone()
    track(phone)
    await seedMember(admin, phone, PASSWORD)

    await page.goto("/forgot-password")
    await page.locator("#fp-identifier").fill(phone)
    await page.getByRole("button", { name: "إرسال رابط إعادة التعيين" }).click()

    await expect(page.getByText("تحقق من رسائلك")).toBeVisible()
    await expect(
      page.getByText("لو الحساب ده عليه إيميل مسجّل", { exact: false })
    ).toBeVisible()
  })

  test("07. Email recovery end-to-end: link → reset password → login works", async ({ page }) => {
    const phone = randomPhone()
    track(phone)
    const email = `${randomPhone()}@example.com`
    await seedEmailUser(admin, { phone, email, password: PASSWORD })

    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: RECOVERY_CALLBACK },
    })
    expect(error).toBeNull()
    const link = data?.properties?.action_link
    expect(link).toBeTruthy()

    await page.goto(buildRecoveryLink(link!))
    await expect(page).toHaveURL(/\/reset-password/, { timeout: 30000 })

    await page.locator("#rp-password").fill("newpass1234")
    await page.locator("#rp-confirmPassword").fill("newpass1234")
    await page.getByRole("button", { name: "تحديث كلمة المرور" }).click()

    await expect(page).toHaveURL(/\/login/, { timeout: 15000 })

    await login(page, email, "newpass1234")
    await expect(page).toHaveURL(/\/app\/member/, { timeout: 15000 })
  })

  test("08. Admin account page: self password change works (then reverts)", async ({ page }) => {
    const adminSeed = await createSeedAdmin(admin, "ADMIN", randomPhone(), PASSWORD)
    track(adminSeed.phoneRaw)

    await login(page, adminSeed.phoneRaw, adminSeed.password)
    await expect(page).toHaveURL(/\/app\/admin/, { timeout: 15000 })
    await page.goto("/app/admin/account")

    await expect(page.getByText("تغيير كلمة المرور").first()).toBeVisible()

    await page.locator("#pc-current").fill(PASSWORD)
    await page.locator("#pc-new").fill("change1234")
    await page.locator("#pc-confirm").fill("change1234")
    await page.getByRole("button", { name: "تغيير كلمة المرور" }).click()
    await expect(page.getByText("تم تغيير كلمة المرور", { exact: false })).toBeVisible()

    await logout(page)
    await login(page, adminSeed.phoneRaw, "change1234")
    await expect(page).toHaveURL(/\/app\/admin/, { timeout: 15000 })

    // Revert so the shared seed password stays stable for this session.
    await page.goto("/app/admin/account")
    await page.locator("#pc-current").fill("change1234")
    await page.locator("#pc-new").fill(PASSWORD)
    await page.locator("#pc-confirm").fill(PASSWORD)
    await page.getByRole("button", { name: "تغيير كلمة المرور" }).click()
    await expect(page.getByText("تم تغيير كلمة المرور", { exact: false })).toBeVisible()
  })

  test("09. User detail page exposes the reset-password dialog", async ({ page }) => {
    await login(page, superSeed.phoneRaw, superSeed.password)
    await expect(page).toHaveURL(/\/app\/super-admin/, { timeout: 15000 })

    await page.goto(`/app/super-admin/user/${superSeed.userId}`)
    await expect(page.getByRole("button", { name: "إعادة تعيين كلمة المرور" })).toBeVisible()
    await expect(
      page.getByText("مسؤول الخدمة العام", { exact: false })
    ).toBeVisible()

    await page.getByRole("button", { name: "إعادة تعيين كلمة المرور" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText("إعادة تعيين كلمة المرور")).toBeVisible()
    await expect(dialog.getByText(superSeed.displayName, { exact: false })).toBeVisible()
    await dialog.getByRole("button", { name: "إلغاء" }).click()
    await expect(dialog).not.toBeVisible()
  })

  test("10. Super-admin resets a phone-only member password; new password works", async ({
    page,
  }) => {
    const phone = randomPhone()
    track(phone)
    const member = await seedMember(admin, phone, PASSWORD)

    await login(page, superSeed.phoneRaw, superSeed.password)
    await expect(page).toHaveURL(/\/app\/super-admin/, { timeout: 15000 })
    await page.goto(`/app/super-admin/user/${member.userId}`)

    await page.getByRole("button", { name: "إعادة تعيين كلمة المرور" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.locator("#rpw-password").fill(member.phone.slice(-8) + "X")
    await dialog.locator("#rpw-confirm").fill(member.phone.slice(-8) + "X")
    await dialog.getByRole("button", { name: "تحديث كلمة المرور" }).click()
    await expect(page.getByText("تم تحديث كلمة المرور", { exact: false })).toBeVisible()

    await logout(page)
    await login(page, phone, member.phone.slice(-8) + "X")
    await expect(page).toHaveURL(/\/app\/member/, { timeout: 15000 })
  })

  test("11. Dashboards show honest stats — no leftover placeholder text", async ({ page }) => {
    const adminSeed = await createSeedAdmin(admin, "ADMIN", randomPhone(), PASSWORD)
    track(adminSeed.phoneRaw)

    await login(page, superSeed.phoneRaw, superSeed.password)
    await expect(page).toHaveURL(/\/app\/super-admin/, { timeout: 15000 })

    await page.goto("/app/super-admin")
    await expect(page.getByText("لوحة التحكم العامة")).toBeVisible()
    await expect(page.getByText("باقي الأقسام جاهزة للتفعيل")).toHaveCount(0)
    await expect(page.getByText("حضور اليوم").first()).toBeVisible()

    await logout(page)
    await login(page, adminSeed.phoneRaw, adminSeed.password)
    await expect(page).toHaveURL(/\/app\/admin/, { timeout: 15000 })

    await page.goto("/app/admin")
    await expect(page.getByText("لوحة الخدمة اليومية")).toBeVisible()
    await expect(page.getByText("باقي الأقسام جاهزة للتفعيل")).toHaveCount(0)
    await expect(page.getByText("آخر نشاط").first()).toBeVisible()
  })

  test("12. Admin members list paginates past 25 entries", async ({ page }) => {
    const seeded: string[] = []
    for (let i = 0; i < 30; i++) {
      const phone = randomPhone()
      seeded.push(phone)
      await seedMember(admin, phone, "seedmember123")
    }
    track(...seeded)
    const adminSeed = await createSeedAdmin(admin, "ADMIN", randomPhone(), PASSWORD)
    track(adminSeed.phoneRaw)

    await login(page, adminSeed.phoneRaw, adminSeed.password)
    await expect(page).toHaveURL(/\/app\/admin/, { timeout: 15000 })
    await page.goto("/app/admin/members")

    await expect(page.getByText(/صفحة 1 من/)).toBeVisible()
    const next = page.getByRole("link", { name: /التالي/ })
    await expect(next).toBeVisible()
    await next.click()
    await expect(page).toHaveURL(/\/app\/admin\/members\?page=2/)
    await expect(page.getByText(/صفحة 2 من/)).toBeVisible()

    const prev = page.getByRole("link", { name: /السابق/ })
    await expect(prev).toBeVisible()
    await prev.click()
    await expect(page).toHaveURL(/\/app\/admin\/members$|page=1/)
    await expect(page.getByText(/صفحة 1 من/)).toBeVisible()

    await cleanupPhones(admin, seeded)
    trackedPhones.splice(trackedPhones.indexOf(adminSeed.phoneRaw), 1)
    await cleanupPhones(admin, [adminSeed.phoneRaw])
  })

  test("13. Super-admin users list loads more via 'عرض المزيد'", async ({ page }) => {
    // Reset the users set to ONLY the shared super-admin seed so the
    // load-more end state (no more pages) is deterministic.
    const reseed = trackedPhones.filter((p) => p !== superSeed.phoneRaw)
    await cleanupPhones(admin, reseed)
    trackedPhones.length = 0
    trackedPhones.push(superSeed.phoneRaw)

    const seeded: string[] = []
    for (let i = 0; i < 35; i++) {
      const phone = randomPhone()
      seeded.push(phone)
      await seedMember(admin, phone, "seedmember123")
    }
    track(...seeded)

    await login(page, superSeed.phoneRaw, superSeed.password)
    await expect(page).toHaveURL(/\/app\/super-admin/, { timeout: 15000 })
    await page.goto("/app/super-admin/users")

    const moreButton = page.getByRole("button", { name: "عرض المزيد" })
    await expect(moreButton).toBeVisible()
    await moreButton.click()

    await expect(moreButton).toBeHidden({ timeout: 15000 })

    await cleanupPhones(admin, seeded)
  })
})