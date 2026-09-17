import { test, expect } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@supabase/supabase-js"
import { cleanupPhones, login, normalizePhone } from "./helpers"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Dedicated phone set for this spec (no overlap with other suites).
const MEMBER_PHONE = "+201000000151"
const MEMBER_PASSWORD = "Phase18Member9!"

// 1x1 PNG — real bytes so the server-side magic-byte sniff accepts it.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

type Seed = {
  userId: string
  phone: string
  password: string
  fullName: string
}

let member: Seed

async function createMember(
  admin: SupabaseClient,
  phone: string,
  password: string,
  name: string,
): Promise<Seed> {
  const normalized = normalizePhone(phone)
  const { data: authData, error: authError } =
    await admin.auth.admin.createUser({
      phone: normalized,
      password,
      phone_confirm: true,
      email_confirm: true,
      user_metadata: { full_name: name },
    })
  if (authError) throw new Error(`seed auth: ${authError.message}`)
  const userId = authData.user.id
  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    role: "SERVED_MEMBER",
    full_name: name,
    phone: normalized,
    status: "ACTIVE",
  })
  if (profileError) throw new Error(`seed profile: ${profileError.message}`)
  return { userId, phone: normalized, password, fullName: name }
}

test.beforeAll(async () => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  await cleanupPhones(admin, [MEMBER_PHONE])
  member = await createMember(
    admin,
    MEMBER_PHONE,
    MEMBER_PASSWORD,
    "مخدوم اختبار الصور الشخصية",
  )
})

test.afterAll(async () => {
  if (process.env.KEEP_PHASE18_DATA === "1") return
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  // Remove any storage objects left under the member's folder.
  const folder = `profiles/${member.userId}`
  const { data: objects } = await admin.storage
    .from("profile-images")
    .list(folder)
  const paths = (objects ?? []).map((o) => `${folder}/${o.name}`)
  if (paths.length) {
    await admin.storage
      .from("profile-images")
      .remove(paths)
      .catch(() => {})
  }
  await admin.from("audit_logs").delete().eq("actor_id", member.userId)
  await cleanupPhones(admin, [MEMBER_PHONE])
})

test("18. Member uploads a profile image; signed URL stored, renders and fetches 200; delete clears it", async ({
  page,
}) => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const readAvatarUrl = async (): Promise<string | null> => {
    const { data } = await admin
      .from("profiles")
      .select("avatar_url")
      .eq("id", member.userId)
      .maybeSingle()
    return (data as { avatar_url: string | null } | null)?.avatar_url ?? null
  }

  await login(page, member.phone, member.password)
  await page.goto("/app/member/account")
  await expect(page.getByText("صورة الملف الشخصي")).toBeVisible()

  // Upload a real 1x1 PNG through the hidden file input.
  await page.locator('[data-testid="profile-image-input"]').setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from(TINY_PNG_BASE64, "base64"),
  })
  await expect(page.getByRole("button", { name: "حفظ الصورة" })).toBeVisible()
  await page.getByRole("button", { name: "حفظ الصورة" }).click()

  // Success toast + profile row gains a signed URL for the private bucket.
  await expect(
    page.getByText("تم حفظ الصورة الشخصية", { exact: false }),
  ).toBeVisible({
    timeout: 15000,
  })
  let signedUrl: string | null = null
  await expect
    .poll(
      async () => {
        signedUrl = await readAvatarUrl()
        return signedUrl
      },
      { timeout: 10000 },
    )
    .not.toBeNull()
  expect(signedUrl).toContain("profile-images")
  expect(signedUrl).toContain("token=")

  // The signed URL actually resolves to a 200 with image content.
  const res = await fetch(signedUrl!)
  expect(res.status).toBe(200)
  expect(
    (res.headers.get("content-type") ?? "").toLowerCase().startsWith("image/"),
  ).toBe(true)

  // The avatar img renders on the page (alt = full name).
  const avatarImg = page.locator(`img[alt="${member.fullName}"]`)
  await expect(avatarImg).toBeVisible()
  await expect(avatarImg).toHaveAttribute("src", signedUrl!)

  // Delete removes the object + nulls avatar_url.
  await page.getByRole("button", { name: "حذف الصورة" }).click()
  await expect(
    page.getByText("تم حذف صورة الملف الشخصي", { exact: false }),
  ).toBeVisible({
    timeout: 15000,
  })
  await expect.poll(readAvatarUrl, { timeout: 10000 }).toBeNull()

  // No avatar object remains under the member's folder.
  const { data: remaining } = await admin.storage
    .from("profile-images")
    .list(`profiles/${member.userId}`)
  expect(remaining ?? []).toHaveLength(0)
})
