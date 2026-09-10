import { test, expect } from "@playwright/test"
import {
  createSupabaseAdmin,
  cleanupPhones,
  randomPhone,
  randomName,
  gotoRegister,
  registerMember,
  registerServant,
  logout,
  login,
} from "./helpers"

test.describe("PHASE 2 — E2E", () => {
  const trackedPhones: string[] = []

  test.afterAll(async () => {
    await cleanupPhones(createSupabaseAdmin(), trackedPhones)
  })

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
    trackedPhones.push(phone)
    await registerMember(page, { phone, name: randomName("مخدوم") })
    await expect(
      page.getByRole("main").getByText("تم إنشاء حسابك بنجاح", { exact: false })
    ).toBeVisible()
  })

  test("05. QR code and 06. 6-digit personal code generated", async ({ page }) => {
    const phone = randomPhone()
    trackedPhones.push(phone)
    await registerMember(page, { phone, name: randomName("مخدوم") })

    await expect(page.getByText("الكود الشخصي")).toBeVisible()
    await expect(page.locator("svg").first()).toBeVisible()
  })

  test("07. Data persists after refresh", async ({ page }) => {
    const phone = randomPhone()
    trackedPhones.push(phone)
    const name = "بشوي نادر حلمي"
    await registerMember(page, { phone, name })

    await page.goto("/app/member")
    await page.reload()
    await page.waitForURL(/\/app\/member/)
    await expect(page.getByRole("heading", { name: /بشوي/ })).toBeVisible()
  })

  test("08. User can edit their profile", async ({ page }) => {
    const phone = randomPhone()
    trackedPhones.push(phone)
    const name = randomName("مخدوم")
    await registerMember(page, { phone, name })

    await page.goto("/app/member/account")
    await page.getByRole("button", { name: "تعديل البيانات" }).click()
    const newName = "أندرو نظير وليم"
    await page.locator("input:not([type='tel']):not([type='date'])").first().fill(newName)
    await page.getByRole("button", { name: "حفظ" }).click()
    await expect(page.getByText(newName, { exact: false }).first()).toBeVisible()
  })

  test("09. User can logout/login again", async ({ page }) => {
    const phone = randomPhone()
    trackedPhones.push(phone)
    const name = randomName("مخدوم")
    await registerMember(page, { phone, name })

    await logout(page)
    await login(page, phone, "password123")
    await expect(page).toHaveURL(/\/app\/member/, { timeout: 15000 })
  })

  test("10. User can choose خادم", async ({ page }) => {
    await gotoRegister(page)
    await page.getByText("خادم", { exact: true }).click()
    await expect(page).toHaveURL(/\/register\/servant/)
  })

  test("11. Servant registration works", async ({ page }) => {
    const phone = randomPhone()
    trackedPhones.push(phone)
    await registerServant(page, { phone, name: randomName("خادم") })
    await expect(
      page.getByRole("main").getByText("تم إنشاء حسابك بنجاح", { exact: false })
    ).toBeVisible()
  })

  test("12. Servant receives QR/code", async ({ page }) => {
    const phone = randomPhone()
    trackedPhones.push(phone)
    await registerServant(page, { phone, name: randomName("خادم") })
    await expect(page.getByText("الكود الشخصي")).toBeVisible()
  })

  test("13. Servant does NOT see numerical scoring", async ({ page }) => {
    const phone = randomPhone()
    trackedPhones.push(phone)
    await registerServant(page, { phone, name: randomName("خادم") })

    await page.goto("/app/servant")
    await expect(page.getByRole("link", { name: "الأنشطة" }).first()).toBeVisible()
    await expect(page.getByText("الدرجات", { exact: false })).not.toBeVisible()
  })

  test("14. Member cannot access Admin routes", async ({ page }) => {
    const phone = randomPhone()
    trackedPhones.push(phone)
    await registerMember(page, { phone, name: randomName("مخدوم") })

    await page.goto("/app/admin")
    await page.waitForURL(/\/login|\/app\/member/, { timeout: 10000 })
    const url = page.url()
    expect(url.includes("/app/admin")).toBe(false)
  })

  test("15. Servant cannot access Admin routes", async ({ page }) => {
    const phone = randomPhone()
    trackedPhones.push(phone)
    await registerServant(page, { phone, name: randomName("خادم") })

    await page.goto("/app/admin")
    await page.waitForURL(/\/login|\/app\/servant/, { timeout: 10000 })
    const url = page.url()
    expect(url.includes("/app/admin")).toBe(false)
  })

  test("16. RLS prevents cross-user profile access", async ({ page }) => {
    const phone1 = randomPhone()
    trackedPhones.push(phone1)
    await registerMember(page, { phone: phone1, name: "شخص انعزل" })

    await logout(page)

    const phone2 = randomPhone()
    trackedPhones.push(phone2)
    await registerMember(page, { phone: phone2, name: "شخص تاني" })

    await page.goto("/app/member/account")
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
    trackedPhones.push(phone)
    await registerMember(page, { phone, name: randomName("مخدوم") })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/app/member")

    await expect(page.locator("nav").last()).toBeVisible()
  })

  test("19. No fake/demo data in UI — empty states shown", async ({ page }) => {
    const phone = randomPhone()
    trackedPhones.push(phone)
    await registerMember(page, { phone, name: randomName("طازج_مخدوم") })

    await page.goto("/app/member")
    await expect(page.getByText("لسه مفيش درجات مسجلة").first()).toBeVisible()
    await expect(page.getByText("لسه مفيش حضور مسجل").first()).toBeVisible()
  })
})