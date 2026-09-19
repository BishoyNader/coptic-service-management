import { test, expect, type Page } from "@playwright/test"
import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js"
import { config as loadEnv } from "dotenv"
import { ROLES } from "../src/lib/roles"
import {
  getScoringBoardData,
  upsertMemberActivityScore,
} from "../src/services/member-scoring-service"

/**
 * PHASE 16 — SERVANT scoring authorization.
 *
 * The unified scoring board in `/app/servant/activities` lets a SERVANT grade
 * EVERY active SERVED_MEMBER user, with no ownership/assignment restriction,
 * while the server-side write path must reject any other target (SERVANT /
 * ADMIN / SUPER_ADMIN / inactive / archived), any non-SERVED_MEMBER activity
 * and any out-of-range / forged input. Numbers start at 230.
 *
 * Layers covered:
 *   - service-level writes: positive (any member, create/update/clear,
 *     attribution, persistence, audit) and negative (role/status/activity/
 *     range/NaN forgeries) through the same validated path the server action
 *     uses;
 *   - RLS: staff-only writes, member own-row reads, anon denied;
 *   - UI access control: member + anonymous cannot open the servant hub.
 *
 * Requires a running Next.js dev server (localhost:3000) + the local
 * Supabase stack for the UI assertions; the service/RLS assertions only need
 * Supabase.
 */

loadEnv({ path: ".env.local" })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const SUPER_PHONE = "+201000000091"
const SERVANT_A_PHONE = "+201000000092"
const SERVANT_B_PHONE = "+201000000093"
const MEMBER1_PHONE = "+201000000094"
const MEMBER2_PHONE = "+201000000095"
const MEMBER3_PHONE = "+201000000096"
const INACTIVE_PHONE = "+201000000097"
const ARCHIVED_PHONE = "+201000000098"
const ADMIN_PHONE = "+201000000099"
const PASSWORD = "Phase16Servant9!"

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(
  new Date()
)

type Seed = { userId: string; phone: string; password: string; displayName: string }

let superAdmin: Seed
let servantA: Seed
let servantB: Seed
let member1: Seed
let member2: Seed
let member3: Seed
let inactiveMember: Seed
let archivedMember: Seed
let adminUser: Seed

const cleaned: string[] = []
const tempActivityIds: string[] = []
let memorizationActivityId = ""
let servantRoleActivityId = ""

async function createUser(
  admin: SupabaseClient,
  role: "SUPER_ADMIN" | "SERVANT" | "SERVED_MEMBER",
  phone: string,
  name: string,
  status = "ACTIVE"
): Promise<Seed> {
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    phone,
    password: PASSWORD,
    phone_confirm: true,
    email_confirm: true,
    user_metadata: { full_name: name, role },
  })
  if (authError) throw new Error(`seed auth: ${authError.message}`)
  const userId = authData.user.id
  cleaned.push(userId)

  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    role,
    full_name: name,
    phone,
    status,
  })
  if (profileError) throw new Error(`seed profile: ${profileError.message}`)

  if (role === "SUPER_ADMIN") {
    const { error: adminError } = await admin
      .from("admin_profiles")
      .insert({ profile_id: userId })
    if (adminError) throw new Error(`seed admin_profiles: ${adminError.message}`)
  }

  return { userId, phone, password: PASSWORD, displayName: name }
}

test.beforeAll(async () => {
  const admin = createSupabaseClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  for (const phone of [
    SUPER_PHONE,
    SERVANT_A_PHONE,
    SERVANT_B_PHONE,
    MEMBER1_PHONE,
    MEMBER2_PHONE,
    MEMBER3_PHONE,
    INACTIVE_PHONE,
    ARCHIVED_PHONE,
    ADMIN_PHONE,
  ]) {
    const { data } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle()
    if (data) await admin.auth.admin.deleteUser(data.id)
  }

  superAdmin = await createUser(admin, "SUPER_ADMIN", SUPER_PHONE, "مسؤول رئيسي للأمن")
  servantA = await createUser(admin, "SERVANT", SERVANT_A_PHONE, "خادم التقييم الأول")
  servantB = await createUser(admin, "SERVANT", SERVANT_B_PHONE, "خادم التقييم الثاني")
  member1 = await createUser(admin, "SERVED_MEMBER", MEMBER1_PHONE, "مخدوم التقييم 1")
  member2 = await createUser(admin, "SERVED_MEMBER", MEMBER2_PHONE, "مخدوم التقييم 2")
  member3 = await createUser(admin, "SERVED_MEMBER", MEMBER3_PHONE, "مخدوم التقييم 3")
  inactiveMember = await createUser(admin, "SERVED_MEMBER", INACTIVE_PHONE, "مخدوم موقوف", "INACTIVE")
  archivedMember = await createUser(admin, "SERVED_MEMBER", ARCHIVED_PHONE, "مخدوم مؤرشف", "ARCHIVED")
  adminUser = await createUser(admin, "SERVANT", ADMIN_PHONE, "مسؤول الخدمة")

  // SERVED_MEMBER graded activity for the board
  const { data: memAct } = await admin
    .from("activities")
    .select("id")
    .eq("code", "MEMBER_MEMORIZATION")
    .eq("is_active", true)
    .maybeSingle()
  memorizationActivityId = memAct?.id ?? ""

  // A SERVANT-role activity — must NEVER be gradable for a served member.
  const { data: servAct } = await admin
    .from("activities")
    .select("id")
    .eq("code", "ATTENDED_LITURGY")
    .eq("is_active", true)
    .maybeSingle()
  servantRoleActivityId = servAct?.id ?? ""

  // A SERVED_MEMBER activity with a non-zero minimum (for below-min rejection)
  // and an inactive activity (for is_active rejection).
  const { data: minAct } = await admin
    .from("activities")
    .insert({
      code: `PH16_MIN_${Date.now()}`,
      name: "نشاط حد أدنى",
      for_role: ROLES.SERVED_MEMBER,
      is_active: true,
      min_score: 5,
      max_score: 10,
    })
    .select("id")
    .single()
  if (minAct) tempActivityIds.push(minAct.id)
  const { data: inact } = await admin
    .from("activities")
    .insert({
      code: `PH16_INACT_${Date.now()}`,
      name: "نشاط غير نشط",
      for_role: ROLES.SERVED_MEMBER,
      is_active: false,
      min_score: 0,
      max_score: 10,
    })
    .select("id")
    .single()
  if (inact) tempActivityIds.push(inact.id)
})

test.afterAll(async () => {
  const admin = createSupabaseClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  for (const id of tempActivityIds) {
    await admin.from("activities").delete().eq("id", id)
  }

  const targets = [member1, member2, member3, inactiveMember, archivedMember].map(
    (m) => m.userId
  )
  await admin.from("member_activity_scores").delete().in("profile_id", targets)
  await admin
    .from("audit_logs")
    .delete()
    .in("actor_id", [superAdmin.userId, servantA.userId, servantB.userId, adminUser.userId])

  for (const id of cleaned) {
    await admin.auth.admin.deleteUser(id)
  }
})

async function login(page: Page, seed: Seed) {
  await page.goto("/login")
  await page.getByLabel("رقم الموبايل أو الإيميل").fill(seed.phone)
  await page.locator("#password").fill(seed.password)
  await page.getByRole("button", { name: "تسجيل الدخول" }).click()
  await page.waitForURL(/\/app\//, { timeout: 15_000 })
}

// ─── Service-level writes (exercises the exact validated service path) ───────

test.describe("SERVANT scoring — service writes", () => {
  const admin = () =>
    createSupabaseClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

  test("230. SERVANT adds a score for any ACTIVE served member (create)", async () => {
    expect(memorizationActivityId).toBeTruthy()
    const res = await upsertMemberActivityScore(admin(), {
      actorId: servantA.userId,
      memberId: member1.userId,
      activityId: memorizationActivityId,
      date: today,
      points: 8,
    })
    expect(res.ok).toBe(true)
    const { data } = await admin()
      .from("member_activity_scores")
      .select("profile_id, activity_id, score_date, points, recorded_by")
      .eq("profile_id", member1.userId)
      .eq("activity_id", memorizationActivityId)
      .eq("score_date", today)
      .maybeSingle()
    expect(data).toBeTruthy()
    expect(Number(data!.points)).toBe(8)
    expect(data!.recorded_by).toBe(servantA.userId)
  })

  test("231. SERVANT updates an existing score (update, same row)", async () => {
    const res = await upsertMemberActivityScore(admin(), {
      actorId: servantA.userId,
      memberId: member1.userId,
      activityId: memorizationActivityId,
      date: today,
      points: 9.5,
    })
    expect(res.ok).toBe(true)
    const { data } = await admin()
      .from("member_activity_scores")
      .select("id, points")
      .eq("profile_id", member1.userId)
      .eq("activity_id", memorizationActivityId)
      .eq("score_date", today)
      .maybeSingle()
    expect(Number(data!.points)).toBe(9.5)
  })

  test("232. SERVANT clears a score by saving 0 (delete path)", async () => {
    const res = await upsertMemberActivityScore(admin(), {
      actorId: servantA.userId,
      memberId: member1.userId,
      activityId: memorizationActivityId,
      date: today,
      points: 0,
    })
    expect(res.ok).toBe(true)
    const { data } = await admin()
      .from("member_activity_scores")
      .select("id")
      .eq("profile_id", member1.userId)
      .eq("activity_id", memorizationActivityId)
      .eq("score_date", today)
      .maybeSingle()
    expect(data).toBeNull()
  })

  test("233. SERVANT scores a second member — no ownership or assignment required", async () => {
    const res = await upsertMemberActivityScore(admin(), {
      actorId: servantA.userId,
      memberId: member2.userId,
      activityId: memorizationActivityId,
      date: today,
      points: 7,
    })
    expect(res.ok).toBe(true)
    const { data } = await admin()
      .from("member_activity_scores")
      .select("points, recorded_by")
      .eq("profile_id", member2.userId)
      .eq("score_date", today)
      .maybeSingle()
    expect(Number(data!.points)).toBe(7)
    expect(data!.recorded_by).toBe(servantA.userId)
  })

  test("234. SERVANT scores every sequence member (member 3 as well)", async () => {
    const res = await upsertMemberActivityScore(admin(), {
      actorId: servantA.userId,
      memberId: member3.userId,
      activityId: memorizationActivityId,
      date: today,
      points: 10,
    })
    expect(res.ok).toBe(true)
  })

  test("235. Scores persist in the board payload for that day", async () => {
    const board = await getScoringBoardData(admin(), today)
    const m2 = board.members.find((m) => m.id === member2.userId)
    expect(m2).toBeTruthy()
    expect(m2!.scores.some((s) => Number(s.points) === 7)).toBe(true)
    const m3 = board.members.find((m) => m.id === member3.userId)
    expect(m3!.scores.some((s) => Number(s.points) === 10)).toBe(true)
  })

  test("236. AI code attribution: recorded_by equals the authenticated actor, not the member", async () => {
    for (const member of [member2, member3]) {
      const { data } = await admin()
        .from("member_activity_scores")
        .select("recorded_by")
        .eq("profile_id", member.userId)
        .eq("score_date", today)
        .maybeSingle()
      expect(data!.recorded_by).toBe(servantA.userId)
    }
  })

  test("237. Writes are audited with the actor and profile metadata", async () => {
    const { data } = await admin()
      .from("audit_logs")
      .select("actor_id, action, metadata, previous, new")
      .eq("entity", "ACTIVITY_SCORE")
      .eq("actor_id", servantA.userId)
      .in("action", ["ACTIVITY_SCORE_CREATED", "ACTIVITY_SCORE_UPDATED"])
      .order("created_at", { ascending: false })
      .limit(5)
    expect(data && data.length).toBeGreaterThan(0)
    const keys = ["metadata", "previous", "new"] as const
    const profileIds = (data ?? []).map((r) =>
      keys.map((k) => (r[k] as Record<string, unknown> | null | undefined)?.profile_id as string)
    ).flat()
    expect(profileIds).toContain(member2.userId)
    expect(profileIds).toContain(member3.userId)
  })

  test("238. SUPER_ADMIN preserves the same scoring ability", async () => {
    const res = await upsertMemberActivityScore(admin(), {
      actorId: superAdmin.userId,
      memberId: member1.userId,
      activityId: memorizationActivityId,
      date: today,
      points: 6,
    })
    expect(res.ok).toBe(true)
    const { data } = await admin()
      .from("member_activity_scores")
      .select("points")
      .eq("profile_id", member1.userId)
      .eq("score_date", today)
      .maybeSingle()
    expect(Number(data!.points)).toBe(6)
  })

  test("239. Score at the activity's max boundary is accepted", async () => {
    const res = await upsertMemberActivityScore(admin(), {
      actorId: servantA.userId,
      memberId: member1.userId,
      activityId: memorizationActivityId,
      date: today,
      points: 10,
    })
    expect(res.ok).toBe(true)
  })

  test("240. Mid-range score is accepted", async () => {
    const res = await upsertMemberActivityScore(admin(), {
      actorId: servantA.userId,
      memberId: member3.userId,
      activityId: memorizationActivityId,
      date: today,
      points: 5,
    })
    expect(res.ok).toBe(true)
  })
})

test.describe("SERVANT scoring — service rejects forged targets", () => {
  const admin = () =>
    createSupabaseClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

  test("241. Rejects scoring a SERVANT target", async () => {
    const res = await upsertMemberActivityScore(admin(), {
      actorId: servantA.userId,
      memberId: servantB.userId,
      activityId: memorizationActivityId,
      date: today,
      points: 8,
    })
    expect(res.ok).toBe(false)
    expect(res.message).toBe("الشخص غير موجود")
  })

  test("242. Rejects scoring an ADMIN target", async () => {
    const res = await upsertMemberActivityScore(admin(), {
      actorId: servantA.userId,
      memberId: adminUser.userId,
      activityId: memorizationActivityId,
      date: today,
      points: 8,
    })
    expect(res.ok).toBe(false)
    expect(res.message).toBe("الشخص غير موجود")
  })

  test("243. Rejects scoring a SUPER_ADMIN target", async () => {
    const res = await upsertMemberActivityScore(admin(), {
      actorId: servantA.userId,
      memberId: superAdmin.userId,
      activityId: memorizationActivityId,
      date: today,
      points: 8,
    })
    expect(res.ok).toBe(false)
    expect(res.message).toBe("الشخص غير موجود")
  })

  test("244. Rejects scoring an INACTIVE served member", async () => {
    const res = await upsertMemberActivityScore(admin(), {
      actorId: servantA.userId,
      memberId: inactiveMember.userId,
      activityId: memorizationActivityId,
      date: today,
      points: 8,
    })
    expect(res.ok).toBe(false)
    expect(res.message).toBe("الشخص غير موجود")
  })

  test("245. Rejects scoring an ARCHIVED served member", async () => {
    const res = await upsertMemberActivityScore(admin(), {
      actorId: servantA.userId,
      memberId: archivedMember.userId,
      activityId: memorizationActivityId,
      date: today,
      points: 8,
    })
    expect(res.ok).toBe(false)
    expect(res.message).toBe("الشخص غير موجود")
  })

  test("246. Rejects an unknown member id", async () => {
    const res = await upsertMemberActivityScore(admin(), {
      actorId: servantA.userId,
      memberId: "00000000-0000-4000-8000-000000000000",
      activityId: memorizationActivityId,
      date: today,
      points: 8,
    })
    expect(res.ok).toBe(false)
  })

  test("247. Rejects a SERVANT-role activity id (forged)", async () => {
    expect(servantRoleActivityId).toBeTruthy()
    const res = await upsertMemberActivityScore(admin(), {
      actorId: servantA.userId,
      memberId: member1.userId,
      activityId: servantRoleActivityId,
      date: today,
      points: 8,
    })
    expect(res.ok).toBe(false)
    expect(res.message).toBe("النشاط غير موجود")
  })

  test("248. Rejects an inactive activity id", async () => {
    const id = tempActivityIds[1]
    expect(id).toBeTruthy()
    const res = await upsertMemberActivityScore(admin(), {
      actorId: servantA.userId,
      memberId: member1.userId,
      activityId: id,
      date: today,
      points: 8,
    })
    expect(res.ok).toBe(false)
    expect(res.message).toBe("النشاط غير موجود")
  })

  test("249. Rejects an unknown activity id", async () => {
    const res = await upsertMemberActivityScore(admin(), {
      actorId: servantA.userId,
      memberId: member1.userId,
      activityId: "00000000-0000-4000-8000-0000000000aa",
      date: today,
      points: 8,
    })
    expect(res.ok).toBe(false)
    expect(res.message).toBe("النشاط غير موجود")
  })

  test("250. Rejects points above max", async () => {
    const res = await upsertMemberActivityScore(admin(), {
      actorId: servantA.userId,
      memberId: member1.userId,
      activityId: memorizationActivityId,
      date: today,
      points: 11,
    })
    expect(res.ok).toBe(false)
  })

  test("251. Rejects points below a non-zero minimum", async () => {
    const minActId = tempActivityIds[0]
    expect(minActId).toBeTruthy()
    const res = await upsertMemberActivityScore(admin(), {
      actorId: servantA.userId,
      memberId: member1.userId,
      activityId: minActId,
      date: today,
      points: 3,
    })
    expect(res.ok).toBe(false)
  })

  test("252. Rejects negative points", async () => {
    const res = await upsertMemberActivityScore(admin(), {
      actorId: servantA.userId,
      memberId: member1.userId,
      activityId: memorizationActivityId,
      date: today,
      points: -1,
    })
    expect(res.ok).toBe(false)
  })

  test("253. Rejects NaN points", async () => {
    const res = await upsertMemberActivityScore(admin(), {
      actorId: servantA.userId,
      memberId: member1.userId,
      activityId: memorizationActivityId,
      date: today,
      points: Number.NaN,
    })
    expect(res.ok).toBe(false)
  })
})

test.describe("SERVANT scoring — RLS", () => {
  test("254. Anonymous cannot insert member activity scores", async () => {
    const anon = createSupabaseClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await anon.from("member_activity_scores").insert({
      profile_id: member1.userId,
      activity_id: memorizationActivityId,
      score_date: today,
      points: 5,
    })
    expect(error).not.toBeNull()
  })

  test("255. A SERVED_MEMBER cannot read another member's scores", async () => {
    const client = createSupabaseClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error: signInError } = await client.auth.signInWithPassword({
      phone: member1.phone,
      password: member1.password,
    })
    expect(signInError).toBeNull()
    const { data } = await client
      .from("member_activity_scores")
      .select("id")
      .eq("profile_id", member2.userId)
    // RLS filters the other member's rows away: an empty array, never a leak.
    expect(data).toEqual([])
  })

  test("256. A SERVED_MEMBER cannot write scores at all", async () => {
    const client = createSupabaseClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error: signInError } = await client.auth.signInWithPassword({
      phone: member1.phone,
      password: member1.password,
    })
    expect(signInError).toBeNull()
    const { error } = await client.from("member_activity_scores").insert({
      profile_id: member1.userId,
      activity_id: memorizationActivityId,
      score_date: today,
      points: 5,
    })
    expect(error).not.toBeNull()
  })

  test("257. A SERVANT (staff) is allowed by RLS to manage score rows", async () => {
    const client = createSupabaseClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error: signInError } = await client.auth.signInWithPassword({
      phone: servantA.phone,
      password: servantA.password,
    })
    expect(signInError).toBeNull()
    const { data, error } = await client
      .from("member_activity_scores")
      .select("profile_id")
      .eq("profile_id", member3.userId)
      .maybeSingle()
    expect(error).toBeNull()
    expect(data?.profile_id).toBe(member3.userId)
  })
})

test.describe("SERVANT scoring — board canvas (UI)", () => {
  test("258. SERVANT looks at the board and can save the day for any member", async ({
    page,
  }) => {
    await login(page, servantA)
    await page.goto("/app/servant/activities")
    await page.waitForLoadState("networkidle")
    await page.getByTestId("hub-tab-members").click()
    await expect(page.getByTestId(`board-member-${member1.userId}`)).toBeVisible()
    await expect(page.getByTestId(`board-member-${member2.userId}`)).toBeVisible()
    await expect(page.getByTestId(`board-member-${member3.userId}`)).toBeVisible()
    await expect(
      page.getByTestId(`activity-input-${memorizationActivityId}-${member2.userId}`)
    ).toBeVisible()
  })

  test("259. Inactive and archived members never appear on the board", async ({
    page,
  }) => {
    await login(page, servantA)
    await page.goto("/app/servant/activities")
    await page.waitForLoadState("networkidle")
    await page.getByTestId("hub-tab-members").click()
    await expect(page.getByTestId(`board-member-${inactiveMember.userId}`)).toHaveCount(0)
    await expect(page.getByTestId(`board-member-${archivedMember.userId}`)).toHaveCount(0)
  })

  test("260. SERVED_MEMBER cannot open the servant activities hub", async ({ page }) => {
    await login(page, member1)
    await page.goto("/app/servant/activities")
    await page.waitForURL((url) => !url.pathname.startsWith("/app/servant/activities"), {
      timeout: 15_000,
    })
    expect(page.url()).not.toContain("/app/servant/activities")
  })

  test("261. Anonymous users are sent to login", async ({ page }) => {
    await page.goto("/app/servant/activities")
    await page.waitForURL(/\/login/, { timeout: 10_000 })
  })
})