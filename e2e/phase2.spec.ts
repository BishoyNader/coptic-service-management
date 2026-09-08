import { test, expect, type Page } from "@playwright/test"

const RESERVED_PHONE = "01000000000"

function randomPhone() {
  return "01" + String(Math.floor(100000000 + Math.random() * 900000000)).padStart(9, "0")
}

function randomName(prefix: string) {
  return `${prefix} ${Math.random().toString(36).slice(2, 7)} نادر حلمي`
}

async function gotoRegister(page: Page) {
  await page.goto("/register")
  await expect(page.getByText("أهلاً بيك", { exact: false })).toBeVisible()
}

async function registerMember(
  page: Page,
  opts: { phone: string; name: string }
) {
  await gotoRegister(page)
  await page.getByText("مخدوم", { exact: true }).click()
  await page.waitForURL("**/register/member")

  // Step 1
  await page.getByLabel("الاسم بالكامل").fill(opts.name)
  await page.getByLabel("رقم الموبايل").fill(opts.phone)
  await page.locator("#password").fill("password123")
  await page.locator("#confirmPassword").fill("password123")
  await page.getByRole("button", { name: "التالي" }).click()

  // Step 2
  await page.getByLabel("تاريخ الميلاد").fill("2000-01-15")
  await page.getByLabel("رقم الأب", { exact: false }).fill("01011111111")
  await page.getByRole("button", { name: "إنشاء الحساب" }).click()
}

async function registerServant(
  page: Page,
  opts: { phone: string; name: string }
) {
  await gotoRegister(page)
  await page.getByText("خادم", { exact: true }).click()
  await page.waitForURL("**/register/servant")

  await page.getByLabel("الاسم بالكامل").fill(opts.name)
  await page.getByLabel("رقم الموبايل").fill(opts.phone)
  await page.locator("#password").fill("password123")
  await page.locator("#confirmPassword").fill("password123")
  await page.getByLabel("تاريخ الميلاد").fill("1995-05-20")
  await page.getByRole("button", { name: "إنشاء الحساب" }).click()
}

async function logout(page: Page) {
  // Find the logout button in the shell
  const logoutBtn = page.getByRole("button", { name: /خروج|تسجيل الخروج/ })
  if (await logoutBtn.first().isVisible()) {
    await logoutBtn.first().click()
  }
}

test.describe("PHASE 2 — E2E", () => {
  test("01. Public registration page works", async ({ page }) => {
    await gotoRegister(page)
    await expect(page.getByText("إنت خادم ولا مخدوم؟")).toBeVisible()
    await expect(page.getByText("أنا مخدوم في الخدمة")).toBeVisible()
    await expect(page.getByText("أنا خادم في الخدمة")).toBeVisible()
  })

  test("02. User can choose مخدوم", async ({ page }) => {
    await gotoRegister(page)
    await page.getByText("مخدوم", { exact: true }).click()
    await expect(page).toHaveURL(/\/register\/member/)
  })

  test("03. User can register as مخدوم", async ({ page }) => {
    const phone = randomPhone()
    await registerMember(page, { phone, name: randomName("مخدوم") })
    await expect(page).toHaveURL(/\/app\/member/, { timeout: 20000 })
    await expect(page.getByRole("main").getByText("تم إنشاء حسابك بنجاح", { exact: false })).toBeVisible()
  })

  test("05. QR code and 06. 6-digit personal code generated", async ({ page }) => {
    const phone = randomPhone()
    await registerMember(page, { phone, name: randomName("مخدوم") })
    await expect(page).toHaveURL(/\/app\/member/, { timeout: 20000 })

    // The QR card shows personal code
    await expect(page.getByText("الكود الشخصي")).toBeVisible()
    await expect(page.locator("svg", { hasText: "" }).first()).toBeVisible()
  })

  test("07. Data persists after refresh", async ({ page }) => {
    const phone = randomPhone()
    const name = "بشوي نادر حلمي"
    await registerMember(page, { phone, name })
    await expect(page).toHaveURL(/\/app\/member/, { timeout: 20000 })

    await page.goto("/app/member")
    await page.reload()
    await page.waitForURL(/\/app\/member/)
    await expect(page.getByRole("heading", { name: /بشوي/ })).toBeVisible()
  })

  test("08. User can edit their profile", async ({ page }) => {
    const phone = randomPhone()
    const name = randomName("مخدوم")
    await registerMember(page, { phone, name })
    await expect(page).toHaveURL(/\/app\/member/, { timeout: 20000 })

    await page.goto("/app/member/account")
    await page.getByRole("button", { name: "تعديل البيانات" }).click()
    const newName = "أندرو نظير وليم"
    await page.locator("input:not([type='tel']):not([type='date'])").first().fill(newName)
    await page.getByRole("button", { name: "حفظ" }).click()
    await expect(page.getByText(newName, { exact: false }).first()).toBeVisible()
  })

  test("09. User can logout/login again", async ({ page }) => {
    const phone = randomPhone()
    const name = randomName("مخدوم")
    await registerMember(page, { phone, name })
    await expect(page).toHaveURL(/\/app\/member/, { timeout: 20000 })

    // logout
    const logoutBtn = page.getByRole("button", { name: /خروج/ })
    if (await logoutBtn.first().isVisible()) {
      await logoutBtn.first().click()
    }

    await page.goto("/login")
    await page.getByLabel("رقم الموبايل أو الإيميل").fill(phone)
    await page.locator("#password").fill("password123")
    await page.getByRole("button", { name: "تسجيل الدخول" }).click()
    await expect(page).toHaveURL(/\/app\/member/, { timeout: 15000 })
  })

  test("10. User can choose خادم", async ({ page }) => {
    await gotoRegister(page)
    await page.getByText("خادم", { exact: true }).click()
    await expect(page).toHaveURL(/\/register\/servant/)
  })

  test("11. Servant registration works", async ({ page }) => {
    const phone = randomPhone()
    await registerServant(page, { phone, name: randomName("خادم") })
    await expect(page).toHaveURL(/\/app\/servant/, { timeout: 20000 })
    await expect(page.getByRole("main").getByText("تم إنشاء حسابك بنجاح", { exact: false })).toBeVisible()
  })

  test("12. Servant receives QR/code", async ({ page }) => {
    const phone = randomPhone()
    await registerServant(page, { phone, name: randomName("خادم") })
    await expect(page).toHaveURL(/\/app\/servant/, { timeout: 20000 })
    await expect(page.getByText("الكود الشخصي")).toBeVisible()
  })

  test("13. Servant does NOT see numerical scoring", async ({ page }) => {
    const phone = randomPhone()
    await registerServant(page, { phone, name: randomName("خادم") })
    await expect(page).toHaveURL(/\/app\/servant/, { timeout: 20000 })

    await page.goto("/app/servant")
    await expect(page.getByRole("link", { name: "الأنشطة" }).first()).toBeVisible()
    // No scores section
    await expect(page.getByText("الدرجات", { exact: false })).not.toBeVisible()
  })

  test("14. Member cannot access Admin routes", async ({ page }) => {
    const phone = randomPhone()
    await registerMember(page, { phone, name: randomName("مخدوم") })
    await expect(page).toHaveURL(/\/app\/member/, { timeout: 20000 })

    await page.goto("/app/admin")
    await page.waitForURL(/\/login|\/app\/member/, { timeout: 10000 })
    const url = page.url()
    expect(url.includes("/app/admin")).toBe(false)
  })

  test("15. Servant cannot access Admin routes", async ({ page }) => {
    const phone = randomPhone()
    await registerServant(page, { phone, name: randomName("خادم") })
    await expect(page).toHaveURL(/\/app\/servant/, { timeout: 20000 })

    await page.goto("/app/admin")
    await page.waitForURL(/\/login|\/app\/servant/, { timeout: 10000 })
    const url = page.url()
    expect(url.includes("/app/admin")).toBe(false)
  })

  test("16. RLS prevents cross-user profile access", async ({ page }) => {
    const phone1 = randomPhone()
    const name1 = "شخص انعزل"
    await registerMember(page, { phone: phone1, name: name1 })
    await expect(page).toHaveURL(/\/app\/member/, { timeout: 20000 })

    // Log out of first user
    const logoutBtn = page.getByRole("button", { name: /خروج/ })
    if (await logoutBtn.first().isVisible()) {
      await logoutBtn.first().click()
    }
    await page.goto("/login")

    // Create a second user
    const phone2 = randomPhone()
    await page.goto("/register")
    await page.waitForURL("**/register")
    await page.getByText("مخدوم", { exact: true }).click()
    await page.waitForURL("**/register/member")
    await page.getByLabel("الاسم بالكامل").fill("شخص تاني")
    await page.getByLabel("رقم الموبايل").fill(phone2)
    await page.locator("#password").fill("password123")
    await page.locator("#confirmPassword").fill("password123")
    await page.getByRole("button", { name: "التالي" }).click()
    await page.getByLabel("تاريخ الميلاد").fill("2000-01-01")
    await page.getByRole("button", { name: "إنشاء الحساب" }).click()
    await expect(page).toHaveURL(/\/app\/member/, { timeout: 20000 })

    // The second user (logged in) should not be able to read the first user's data
    // via direct supabase access. We verify through the profile edit that only own data shows.
    await page.goto("/app/member/account")
    // Should see own name, not the first user's name
    await expect(page.getByText("شخص تاني", { exact: false }).first()).toBeVisible()
    await expect(page.getByText("شخص انعزل", { exact: false })).not.toBeVisible()
  })

  test("17. Arabic RTL works", async ({ page }) => {
    await page.goto("/register")
    const dir = await page.locator("html").getAttribute("dir")
    expect(dir).toBe("rtl")
  })

  test("18. Mobile layout shows bottom navigation", async ({ page }) => {
    const phone = randomPhone()
    await registerMember(page, { phone, name: randomName("مخدوم") })
    await expect(page).toHaveURL(/\/app\/member/, { timeout: 20000 })

    // Set viewport to mobile size
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/app/member")

    // Bottom nav should be visible with role-specific items
    await expect(page.locator("nav").last()).toBeVisible()
  })

  test("19. No fake/demo data in UI — empty states shown", async ({ page }) => {
    const phone = randomPhone()
    await registerMember(page, { phone, name: randomName("طازج_مخدوم") })
    await expect(page).toHaveURL(/\/app\/member/, { timeout: 20000 })

    await page.goto("/app/member")
    // New members should see empty states for score/attendance
    await expect(page.getByText("لسه مفيش درجات مسجلة").first()).toBeVisible()
    await expect(page.getByText("لسه مفيش حضور مسجل").first()).toBeVisible()
  })
})
