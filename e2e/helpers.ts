import { expect, type Page } from "@playwright/test"
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"
import { config as loadEnv } from "dotenv"

loadEnv({ path: ".env.local" })

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
export const RECOVERY_CALLBACK = "http://127.0.0.1:3000/auth/callback"
export const SEED_PASSWORD = "testadmin123"
export const DEFAULT_REG_PASSWORD = "password123"

export function randomPhone(): string {
  return "01" + String(Math.floor(100000000 + Math.random() * 900000000)).padStart(9, "0")
}

export function randomName(prefix: string): string {
  return `${prefix} ${Math.random().toString(36).slice(2, 7)} اختبار`
}

export function normalizePhone(phone: string): string {
  const trimmed = phone.trim()
  if (/^\d+$/.test(trimmed)) {
    if (trimmed.startsWith("0")) return trimmed.replace(/^0/, "+20")
    if (trimmed.startsWith("20") && trimmed.length >= 11) return `+${trimmed}`
    return `+${trimmed}`
  }
  return trimmed
}

export function createSupabaseAdmin(): SupabaseClient {
  return createSupabaseClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function createAnonClient(): SupabaseClient {
  return createSupabaseClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * admin.auth.admin.generateLink() mints the link against the server's
 * SITE_URL and ignores the redirectTo option. Rewrite the redirect_to so the
 * recovery link lands on the app's /auth/callback instead of the bare root.
 */
export function buildRecoveryLink(actionLink: string): string {
  const url = new URL(actionLink)
  const current = url.searchParams.get("redirect_to") ?? ""
  if (url.hostname !== "localhost" || !current.includes("/auth/callback")) {
    url.searchParams.set("redirect_to", RECOVERY_CALLBACK)
  }
  return url.toString()
}

export async function gotoRegister(page: Page) {
  await page.goto("/register")
  await expect(page.getByText("أهلاً بيك", { exact: false })).toBeVisible()
}

export async function registerMember(
  page: Page,
  opts: { phone: string; name: string }
) {
  await gotoRegister(page)
  await page.getByText("مخدوم", { exact: true }).click()
  await page.waitForURL("**/register/member")

  await page.getByLabel("الاسم بالكامل").fill(opts.name)
  await page.getByLabel("رقم الموبايل").fill(opts.phone)
  await page.locator("#password").fill(DEFAULT_REG_PASSWORD)
  await page.locator("#confirmPassword").fill(DEFAULT_REG_PASSWORD)
  await page.getByRole("button", { name: "التالي" }).click()

  await page.getByLabel("تاريخ الميلاد").fill("2000-01-15")
  await page.getByLabel("رقم الأب", { exact: false }).fill("01011111111")
  await page.getByRole("button", { name: "إنشاء الحساب" }).click()
  await expect(page).toHaveURL(/\/app\/member/, { timeout: 20000 })
}

export async function registerServant(
  page: Page,
  opts: { phone: string; name: string }
) {
  await gotoRegister(page)
  await page.getByText("خادم", { exact: true }).click()
  await page.waitForURL("**/register/servant")

  await page.getByLabel("الاسم بالكامل").fill(opts.name)
  await page.getByLabel("رقم الموبايل").fill(opts.phone)
  await page.locator("#password").fill(DEFAULT_REG_PASSWORD)
  await page.locator("#confirmPassword").fill(DEFAULT_REG_PASSWORD)
  await page.getByLabel("تاريخ الميلاد").fill("1995-05-20")
  await page.getByRole("button", { name: "إنشاء الحساب" }).click()
  await expect(page).toHaveURL(/\/app\/servant/, { timeout: 20000 })
}

export async function login(page: Page, phone: string, password: string) {
  await page.goto("/login")
  await page.getByLabel("رقم الموبايل أو الإيميل").fill(phone)
  await page.locator("#password").fill(password)
  await page.getByRole("button", { name: "تسجيل الدخول" }).click()
  // Wait for the post-login redirect AND the session cookie to be committed
  // before the calling test asserts on user-scoped data (badge counts,
  // inbox rows, sent lists). Without this, server actions can race the
  // cookie switch and momentarily resolve the previous user's state.
  // The redirect is a client-side App Router push (no document navigation),
  // so poll the pathname rather than waiting on a navigation event.
  await page.waitForFunction(() => /^\/app\//.test(window.location.pathname), undefined, {
    timeout: 15_000,
  })
}

export async function logout(page: Page) {
  const btn = page
    .getByRole("button", { name: /خروج|تسجيل الخروج/ })
    .first()
  await btn.waitFor({ state: "visible", timeout: 10000 }).catch(() => {})
  if (await btn.isVisible()) {
    await btn.click()
  }
  await page.waitForURL("**/login", { timeout: 10000 }).catch(() => {})
}

export async function createSeedAdmin(
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

/** Deletes every auth user whose profile phone matches one of the given phones. */
export async function cleanupPhones(admin: SupabaseClient, phones: string[]) {
  const normalized = phones.map(normalizePhone)
  for (const phone of normalized) {
    const { data } = await admin
      .from("profiles")
      .select("id")
      .eq("phone", phone)
      .maybeSingle()
    if (data) {
      await admin.auth.admin.deleteUser(data.id)
    }
  }
}