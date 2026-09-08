import { test, expect, type Page } from "@playwright/test"
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"
import { config as loadEnv } from "dotenv"

loadEnv({ path: ".env.local" })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function randomPhone(): string {
  return "01" + String(Math.floor(100000000 + Math.random() * 900000000)).padStart(9, "0")
}

function randomName(prefix: string): string {
  return `${prefix} ت${Math.random().toString(36).slice(2, 6)} يدوي`
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
}

async function logout(page: Page) {
  const btn = page.getByRole("button", { name: /خروج/ })
  if (await btn.first().isVisible()) {
    await btn.first().click()
  }
}

async function createSeedAdmin(
  admin: SupabaseClient,
  role: "ADMIN" | "SUPER_ADMIN",
  phone: string,
  password: string
) {
  const normalized = normalizePhone(phone)
  const displayName = role === "ADMIN" ? "إيكونوموس اختبار" : "رئيس شمامسة اختبار"

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

  const { error: adminProfileError } = await admin
    .from("admin_profiles")
    .insert({ profile_id: userId })
  if (adminProfileError) throw new Error(`seed admin_profiles: ${adminProfileError.message}`)

  return { userId, phone: normalized, phoneRaw: phone, password, displayName }
}

/**
 * Opens the "إضافة" dialog and fills the account form.
 * `buttonName` is the text on the trigger (+ إضافة مخدوم / إضافة خادم / إضافة).
 */
async function openAddAndFill(
  page: Page,
  buttonName: string,
  opts: { name: string; phone: string; password?: string }
) {
  await page.getByRole("button", { name: buttonName }).first().click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.getByLabel("الاسم بالكامل").fill(opts.name)
  await page.getByLabel("رقم الموبايل").fill(opts.phone)
  await page.locator("#au-password").fill(opts.password ?? "password123")
  await page.locator("#au-confirmPassword").fill(opts.password ?? "password123")
  await page.getByRole("button", { name: "التالي" }).click()
  await page.getByRole("button", { name: "إضافة الحساب" }).click()
}

test.describe("PHASE 2 — Manual admin CRUD", () => {
  let admin: SupabaseClient
  let adminSeed: Awaited<ReturnType<typeof createSeedAdmin>>
  let superSeed: Awaited<ReturnType<typeof createSeedAdmin>>
  const createdPhones: string[] = []

  test.beforeAll(async () => {
    admin = createSupabaseClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    adminSeed = await createSeedAdmin(admin, "ADMIN", randomPhone(), "testadmin123")
    superSeed = await createSeedAdmin(admin, "SUPER_ADMIN", randomPhone(), "testadmin123")
  })

  test.afterAll(async () => {
    const allPhones = [
      ...createdPhones.map(normalizePhone),
      adminSeed.phone,
      superSeed.phone,
    ]
    for (const phone of allPhones) {
      const { data } = await admin
        .from("profiles")
        .select("id")
        .eq("phone", phone)
        .maybeSingle()
      if (data) {
        await admin.auth.admin.deleteUser(data.id)
      }
    }
  })

  test("20. Admin can add a مخدوم manually (+ إضافة مخدوم)", async ({ page }) => {
    const phone = randomPhone()
    const name = randomName("مخدوم")
    createdPhones.push(phone)

    await login(page, adminSeed.phoneRaw, adminSeed.password)
    await expect(page).toHaveURL(/\/app\/admin/, { timeout: 15000 })
    await page.goto("/app/admin/members")

    await openAddAndFill(page, "+ إضافة مخدوم", { name, phone })

    // Success dialog with personal code + QR
    await expect(page.getByText("تمت إضافة مخدوم بنجاح")).toBeVisible({ timeout: 15000 })
    await expect(page.getByText("الكود الشخصي")).toBeVisible()
    const codeEl = page
      .getByRole("dialog")
      .locator("div.bg-coptic-gold-soft")
      .getByText(/^\d{6}$/)
    await expect(codeEl).toBeVisible()
    await expect(page.getByRole("dialog").locator("svg").first()).toBeVisible()

    // Close and confirm the member appears in the list
    await page.getByRole("button", { name: "إغلاق" }).click()
    await expect(page.getByText(name, { exact: false })).toBeVisible()
  })

  test("21. Admin add form has NO role selector (blocked from creating servants)", async ({
    page,
  }) => {
    await login(page, adminSeed.phoneRaw, adminSeed.password)
    await expect(page).toHaveURL(/\/app\/admin/, { timeout: 15000 })
    await page.goto("/app/admin/members")

    await page.getByRole("button", { name: "+ إضافة مخدوم" }).first().click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await expect(page.getByText("نوع الحساب")).not.toBeVisible()
  })

  test("22. Newly created member can log in with the admin-set password", async ({ page }) => {
    const phone = randomPhone()
    const name = randomName("مخدوم")
    createdPhones.push(phone)

    await login(page, adminSeed.phoneRaw, adminSeed.password)
    await expect(page).toHaveURL(/\/app\/admin/, { timeout: 15000 })
    await page.goto("/app/admin/members")
    await openAddAndFill(page, "+ إضافة مخدوم", { name, phone })
    await expect(page.getByText("تمت إضافة مخدوم بنجاح")).toBeVisible({ timeout: 15000 })
    await page.getByRole("button", { name: "إغلاق" }).click()

    await logout(page)
    await login(page, phone, "password123")
    await expect(page).toHaveURL(/\/app\/member/, { timeout: 15000 })
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible()
  })

  test("23. Super Admin can add a خادم via servants page", async ({ page }) => {
    const phone = randomPhone()
    const name = randomName("خادم")
    createdPhones.push(phone)

    await login(page, superSeed.phoneRaw, superSeed.password)
    await expect(page).toHaveURL(/\/app\/super-admin/, { timeout: 15000 })
    await page.goto("/app/super-admin/servants")

    await openAddAndFill(page, "+ إضافة خادم", { name, phone })

    // Super admin form exposes the role selector (defaults to خادم here)
    await expect(page.getByText("نوع الحساب")).toBeVisible()
    await expect(page.getByText("تمت إضافة خادم بنجاح")).toBeVisible({ timeout: 15000 })
    await page.getByRole("button", { name: "إغلاق" }).click()
    await expect(page.getByText(name, { exact: false })).toBeVisible()
  })

  test("24. Super Admin can add a مخدوم via users page (role selector)", async ({ page }) => {
    const phone = randomPhone()
    const name = randomName("مخدوم")
    createdPhones.push(phone)

    await login(page, superSeed.phoneRaw, superSeed.password)
    await expect(page).toHaveURL(/\/app\/super-admin/, { timeout: 15000 })
    await page.goto("/app/super-admin/users")

    await openAddAndFill(page, "+ إضافة", { name, phone })

    await expect(page.getByText("نوع الحساب")).toBeVisible()
    await expect(page.getByText("تمت إضافة مخدوم بنجاح")).toBeVisible({ timeout: 15000 })
    await page.getByRole("button", { name: "إغلاق" }).click()
    await expect(page.getByText(name, { exact: false })).toBeVisible()
  })

  test("25. Deactivate + reactivate a user via the users list", async ({ page }) => {
    const phone = randomPhone()
    const name = randomName("مخدوم")
    createdPhones.push(phone)

    await login(page, superSeed.phoneRaw, superSeed.password)
    await expect(page).toHaveURL(/\/app\/super-admin/, { timeout: 15000 })
    await page.goto("/app/super-admin/users")
    await openAddAndFill(page, "+ إضافة", { name, phone })
    await expect(page.getByText("تمت إضافة مخدوم بنجاح")).toBeVisible({ timeout: 15000 })
    await page.getByRole("button", { name: "إغلاق" }).click()

    // The UsersList refresh already re-renders the row.
    const row = page.locator("div.flex.items-center.gap-3", { hasText: name }).last()
    await expect(row).toBeVisible()

    // Deactivate
    await row.getByTitle("إيقاف الحساب").click()
    await expect(page.getByText("تم إيقاف الحساب")).toBeVisible()
    await expect(row.getByText("موقوف")).toBeVisible({ timeout: 15000 })

    // Reactivate
    await row.getByTitle("تفعيل الحساب").click()
    await expect(page.getByText("تم تفعيل الحساب")).toBeVisible()
    await expect(row.getByText("نشط")).toBeVisible({ timeout: 15000 })
  })

  test("26. Archive a user via the users list (confirm dialog)", async ({ page }) => {
    const phone = randomPhone()
    const name = randomName("مخدوم")
    createdPhones.push(phone)

    await login(page, superSeed.phoneRaw, superSeed.password)
    await expect(page).toHaveURL(/\/app\/super-admin/, { timeout: 15000 })
    await page.goto("/app/super-admin/users")
    await openAddAndFill(page, "+ إضافة", { name, phone })
    await expect(page.getByText("تمت إضافة مخدوم بنجاح")).toBeVisible({ timeout: 15000 })
    await page.getByRole("button", { name: "إغلاق" }).click()

    const row = page.locator("div.flex.items-center.gap-3", { hasText: name }).last()
    await expect(row).toBeVisible()

    await row.getByTitle("أرشفة الحساب").click()
    await expect(page.getByRole("alertdialog")).toBeVisible()
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "أرشفة الحساب" })
      .click()

    await expect(page.getByText("تم أرشفة الحساب")).toBeVisible()
    await expect(row.getByText("مؤرشف")).toBeVisible({ timeout: 15000 })
  })

  test("27. Archive then un-archive via the member view", async ({ page }) => {
    const phone = randomPhone()
    const name = randomName("مخدوم")
    createdPhones.push(phone)

    await login(page, superSeed.phoneRaw, superSeed.password)
    await expect(page).toHaveURL(/\/app\/super-admin/, { timeout: 15000 })
    await page.goto("/app/super-admin/users")
    await openAddAndFill(page, "+ إضافة", { name, phone })
    await expect(page.getByText("تمت إضافة مخدوم بنجاح")).toBeVisible({ timeout: 15000 })
    await page.getByRole("button", { name: "إغلاق" }).click()

    // Grab the view link id from the row
    const row = page.locator("div.flex.items-center.gap-3", { hasText: name }).last()
    await expect(row).toBeVisible()
    const href = await row.locator('a[aria-label="عرض"]').getAttribute("href")
    expect(href).toMatch(/\/app\/super-admin\/user\//)
    await page.goto(href!)

    // Archive from member view
    await page.getByRole("button", { name: "أرشفة الحساب" }).first().click()
    await expect(page.getByRole("alertdialog")).toBeVisible()
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "أرشفة الحساب" })
      .click()
    await expect(page.getByText("مؤرشف")).toBeVisible({ timeout: 15000 })

    // Un-archive
    await page.getByRole("button", { name: "إلغاء الأرشفة" }).click()
    await expect(page.getByRole("alertdialog")).toBeVisible()
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "تفعيل الحساب" })
      .click()
    await expect(page.getByText("نشط")).toBeVisible({ timeout: 15000 })
  })

  test("28. Admin-created users are recorded in the audit log", async () => {
    const { data, error } = await admin
      .from("audit_logs")
      .select("action, metadata")
      .eq("action", "USER_CREATED")
      .order("created_at", { ascending: false })
      .limit(5)
    expect(error).toBeNull()
    expect(data?.length ?? 0).toBeGreaterThan(0)
    const created = data?.find((r) => ["SERVED_MEMBER", "SERVANT"].includes(r.metadata?.role))
    expect(created).toBeTruthy()
  })
})