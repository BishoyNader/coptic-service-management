import { test, expect, type Page } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"
import { config as loadEnv } from "dotenv"
import { createAdminClient } from "../src/lib/supabase/admin"
import { createAnonClient } from "./helpers"
import { cairoDateString } from "../src/lib/cairo"
import { checkInByProfileId } from "../src/services/attendance-service"

/**
 * PHASE 11 — SERVANT attendance board.
 *
 * The existing SERVANT role can now record attendance for themselves, for
 * fellow servants and for served members via a dedicated board
 * (/app/servant/attendance): خدام / مخدومين tabs, search & load-more, a fast
 * per-person record dialog and the embedded QR/manual-code scanner. The ADMIN
 * role is untouched. Writes still flow through server actions -> the
 * service-role RPC so clients can never forge attended_at/points.
 *
 * Numbering starts at 184.
 */

loadEnv({ path: ".env.local" })

function randomPhone(): string {
  return "01" + String(Math.floor(100000000 + Math.random() * 900000000)).padStart(9, "0")
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

type Seed = {
  userId: string
  phone: string
  phoneRaw: string
  password: string
  displayName: string
  code: string
  qrToken: string
}

async function createUser(
  admin: SupabaseClient,
  role: "SERVANT" | "SERVED_MEMBER",
  phone: string,
  password: string,
  opts: { name?: string; status?: "ACTIVE" | "INACTIVE" } = {}
): Promise<Seed> {
  const normalized = normalizePhone(phone)
  const displayName =
    opts.name ?? (role === "SERVANT" ? "خادم لوحة الحضور" : "مخدوم لوحة الحضور")

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
    status: opts.status ?? "ACTIVE",
  })
  if (profileError) throw new Error(`seed profile: ${profileError.message}`)

  let code = ""
  let qrToken = ""
  for (let attempt = 0; attempt < 5; attempt++) {
    const c = String(Math.floor(100000 + Math.random() * 900000))
    const q = randomUuid()
    const { error: pcError } = await admin.from("personal_codes").insert({
      profile_id: userId,
      code: c,
      qr_token: q,
    })
    if (!pcError) {
      code = c
      qrToken = q
      break
    }
    if (attempt === 4) throw new Error(`seed personal_codes: ${pcError.message}`)
  }

  return { userId, phone: normalized, phoneRaw: phone, password, displayName, code, qrToken }
}

async function createSuperAdmin(admin: SupabaseClient): Promise<Seed & { isSuper: true }> {
  const normalized = normalizePhone(randomPhone())
  const displayName = "الطنطاواني عمليات اللوحة"
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    phone: normalized,
    password: "BoardAdmin9!",
    phone_confirm: true,
    email_confirm: true,
    user_metadata: { full_name: displayName, role: "SUPER_ADMIN" },
  })
  if (authError) throw new Error(`seed super auth: ${authError.message}`)
  const userId = authData.user.id

  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    role: "SUPER_ADMIN",
    full_name: displayName,
    phone: normalized,
  })
  if (profileError) throw new Error(`seed super profile: ${profileError.message}`)
  const { error: apError } = await admin.from("admin_profiles").insert({ profile_id: userId })
  if (apError) throw new Error(`seed super admin_profiles: ${apError.message}`)

  return { userId, phone: normalized, phoneRaw: normalized, password: "BoardAdmin9!", displayName, code: "", qrToken: "", isSuper: true }
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

type AuditRow = {
  id: string
  actor_id: string
  action: string
  entity_id: string
  metadata: Record<string, unknown> | null
}

async function auditRowsFor(
  admin: SupabaseClient,
  entityId: string
): Promise<AuditRow[]> {
  const { data } = await admin
    .from("audit_logs")
    .select("id, actor_id, action, entity_id, metadata")
    .eq("entity_id", entityId)
    .order("created_at")
    .limit(20)
  return (data ?? []) as unknown as AuditRow[]
}

test.describe("PHASE 11 — SERVANT attendance board", () => {
  test.describe.configure({ mode: "serial" })
  const createdSessionIds: string[] = []
  const createdCodes: string[] = []

  let admin: SupabaseClient
  let superSeed: Seed
  let servantA: Seed
  let servantB: Seed
  let member: Seed
  let member2: Seed
  let memberInactive: Seed
  let churchSessionId: string

  test.beforeAll(async () => {
    admin = createAdminClient()
    const today = cairoDateString(new Date())
    const runTag = Math.random().toString(36).slice(2, 7)

    superSeed = await createSuperAdmin(admin)
    servantA = await createUser(admin, "SERVANT", randomPhone(), "BoardServA1!", {
      name: "شبيه أعمال اللوحة " + runTag,
    })
    servantB = await createUser(admin, "SERVANT", randomPhone(), "BoardServB1!", {
      name: "خادم اللوحة الثاني " + runTag,
    })
    member = await createUser(admin, "SERVED_MEMBER", randomPhone(), "BoardMember1!", {
      name: "مخدوم اللوحة الأول " + runTag,
    })
    member2 = await createUser(admin, "SERVED_MEMBER", randomPhone(), "BoardMember2!", {
      name: "مخدوم اللوحة الثاني " + runTag,
    })
    memberInactive = await createUser(admin, "SERVED_MEMBER", randomPhone(), "BoardMember3!", {
      name: "مخدوم معطّل الحضور " + runTag,
      status: "INACTIVE",
    })
    createdCodes.push(member.code, member2.code, memberInactive.code)

    // A CHURCH session whose record belongs to a SUPER_ADMIN subject — must
    // stay invisible to the SERVANT scope.
    const { data: session, error: sessionError } = await admin
      .from("attendance_sessions")
      .insert({
        type: "CHURCH",
        title: "قداس اختبار اللوحة",
        session_date: today,
        created_by: superSeed.userId,
      })
      .select("id")
      .single()
    if (sessionError) throw new Error(`seed session: ${sessionError.message}`)
    churchSessionId = session.id as string
    createdSessionIds.push(churchSessionId)

    const { error: superRecordError } = await admin.from("attendance_records").insert({
      session_id: churchSessionId,
      profile_id: superSeed.userId,
      attended_at: new Date().toISOString(),
      points: 0,
      source: "MANUAL",
      status: "PRESENT",
      recorded_by: superSeed.userId,
    })
    if (superRecordError) throw new Error(`seed super record: ${superRecordError.message}`)
  })

  async function cleanup() {
    const userIds = [superSeed, servantA, servantB, member, member2, memberInactive].map(
      (s) => s.userId
    )
    if (userIds.length) {
      await admin.from("attendance_records").delete().in("profile_id", userIds)
      await admin.from("score_records").delete().in("profile_id", userIds)
      await admin.from("servant_activity_records").delete().in("servant_id", userIds)
      await admin.from("personal_codes").delete().in("profile_id", userIds)
      await admin.from("admin_profiles").delete().in("profile_id", userIds)
      await admin.from("audit_logs").delete().eq("entity", "TEST_ATTENDANCE")
      await admin.from("attendance_sessions").delete().in("id", createdSessionIds)
    }
    for (const uid of userIds) await admin.auth.admin.deleteUser(uid)
  }

  test.afterAll(async () => {
    if (process.env.KEEP_PHASE11_DATA === "1") return
    await cleanup()
  })

  // ---------------------------------------------------------------------------
  // UI — the board
  // ---------------------------------------------------------------------------

  test("184. SERVANT board opens with both tabs, counts and NO personal phone", async ({ page }) => {
    await login(page, servantA.phone, servantA.password)
    await page.goto("/app/servant/attendance")

    await expect(page.getByRole("heading", { name: "الحضور" })).toBeVisible()
    await expect(
      page.getByRole("complementary").getByRole("link", { name: "الحضور" })
    ).toBeVisible()
    await expect(page.getByText("خدام حاضرين")).toBeVisible()
    await expect(page.getByText("مخدومين حاضرين")).toBeVisible()

    // Default tab = the servants tab; our own row carries the "أنت" badge.
    await expect(
      page.locator("li", { hasText: servantA.displayName }).getByText("أنت")
    ).toBeVisible()

    const membersTab = page.getByRole("tab", { name: "المخدومين" })
    await expect(membersTab).toBeVisible()
    await membersTab.click()
    await expect(page.locator("li", { hasText: member.displayName })).toBeVisible()

    // Privacy: the board must not expose the member's phone.
    await expect(page.getByText(member.phone)).toHaveCount(0)
  })

  test("185. SERVANT records a served member via the board dialog (scoring on the subject)", async ({ page }) => {
    await login(page, servantA.phone, servantA.password)
    await page.goto("/app/servant/attendance")
    await page.getByRole("tab", { name: "المخدومين" }).click()

    await page
      .locator("li", { hasText: member.displayName })
      .getByRole("button", { name: "تسجيل حضور" })
      .click()

    await expect(page.getByRole("dialog")).toBeVisible()
    await page.getByRole("button", { name: "حضور الخدمة" }).click()
    await page.getByRole("button", { name: "تسجيل الحضور" }).click()

    await expect(page.getByText("تم تسجيل الحضور")).toBeVisible({ timeout: 15_000 })

    const { data: rows } = await admin
      .from("attendance_records")
      .select("id, profile_id, recorded_by, points, source, status, session:attendance_sessions(type)")
      .eq("profile_id", member.userId)
      .in("status", ["PRESENT", "LATE"])
    expect(rows?.length).toBe(1)
    const row = rows![0] as unknown as {
      id: string
      profile_id: string
      recorded_by: string
      points: number
      source: string
      status: string
      session: { type: string } | null
    }
    // Subject is the member, actor is the recording servant.
    expect(row.profile_id).toBe(member.userId)
    expect(row.recorded_by).toBe(servantA.userId)
    expect(row.source).toBe("MANUAL")
    expect(row.status).toBe("PRESENT")
    expect(row.points).toBeGreaterThan(0)
    expect(row.session?.type).toBe("SERVICE")

    // Audit: the SERVANT is the actor, the member is the subject.
    const audits = await auditRowsFor(admin, row.id)
    expect(audits).toHaveLength(1)
    expect(audits[0].action).toBe("ATTENDANCE_MANUAL")
    expect(audits[0].actor_id).toBe(servantA.userId)
    expect(audits[0].metadata?.profile_id).toBe(member.userId)
    expect(audits[0].metadata?.subject_role).toBe("SERVED_MEMBER")
    expect(audits[0].metadata?.outcome).toBe("success")
    expect(audits[0].metadata?.type).toBe("SERVICE")
  })

  test("186. SERVANT records a fellow servant with NO points", async ({ page }) => {
    await login(page, servantA.phone, servantA.password)
    await page.goto("/app/servant/attendance")

    await page
      .locator("li", { hasText: servantB.displayName })
      .getByRole("button", { name: "تسجيل حضور" })
      .click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.getByRole("button", { name: "حضور القداس" }).click()
    await page.getByRole("button", { name: "تسجيل الحضور" }).click()
    await expect(page.getByText("تم تسجيل الحضور")).toBeVisible({ timeout: 15_000 })

    const { data: row } = await admin
      .from("attendance_records")
      .select("id, profile_id, recorded_by, points")
      .eq("profile_id", servantB.userId)
      .in("status", ["PRESENT", "LATE"])
      .maybeSingle()
    expect(row).toBeTruthy()
    expect(row!.profile_id).toBe(servantB.userId)
    expect(row!.recorded_by).toBe(servantA.userId)
    expect(Number(row!.points)).toBe(0)

    // Servants never earn attendance points.
    const { data: scores } = await admin
      .from("score_records")
      .select("id")
      .eq("profile_id", servantB.userId)
    expect(scores ?? []).toHaveLength(0)

    // Audit: cross-person recording within the servants group.
    const audits = await auditRowsFor(admin, row!.id)
    expect(audits).toHaveLength(1)
    expect(audits[0].action).toBe("ATTENDANCE_MANUAL")
    expect(audits[0].actor_id).toBe(servantA.userId)
    expect(audits[0].metadata?.profile_id).toBe(servantB.userId)
    expect(audits[0].metadata?.subject_role).toBe("SERVANT")
  })

  test("187. SERVANT records OWN attendance and the home widget reflects today", async ({ page }) => {
    await login(page, servantA.phone, servantA.password)
    await page.goto("/app/servant/attendance")

    const ownRow = page.locator("li", { hasText: servantA.displayName }).filter({ hasText: "أنت" })
    await ownRow.getByRole("button", { name: "تسجيل حضور" }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.getByRole("button", { name: "حضور الخدمة" }).click()
    await page.getByRole("button", { name: "تسجيل الحضور" }).click()
    await expect(page.getByText("تم تسجيل الحضور")).toBeVisible({ timeout: 15_000 })

    const { data: row } = await admin
      .from("attendance_records")
      .select("id, profile_id, recorded_by")
      .eq("profile_id", servantA.userId)
      .in("status", ["PRESENT", "LATE"])
      .maybeSingle()
    expect(row).toBeTruthy()
    expect(row!.profile_id).toBe(servantA.userId)
    expect(row!.recorded_by).toBe(servantA.userId)

    // Audit: self-recording identifies the same person as actor AND subject.
    const audits = await auditRowsFor(admin, row!.id)
    expect(audits).toHaveLength(1)
    expect(audits[0].action).toBe("ATTENDANCE_MANUAL")
    expect(audits[0].actor_id).toBe(servantA.userId)
    expect(audits[0].metadata?.profile_id).toBe(servantA.userId)
    expect(audits[0].metadata?.subject_role).toBe("SERVANT")

    // The homepage attendance widget is present after the refresh.
    await page.goto("/app/servant")
    await expect(page.getByText("حضور اليوم")).toBeVisible()
    await expect(page.getByRole("link", { name: /فتح لوحة الحضور/ })).toBeVisible()
  })

  test("189. Embedded manual-code check-in records a fresh member (QR fallback path)", async ({ page }) => {
    await login(page, servantA.phone, servantA.password)
    await page.goto("/app/servant/attendance")

    await page.getByRole("button", { name: "فتح الماسح الضوئي" }).click()
    await page.getByRole("button", { name: "إدخال الكود يدويًا" }).click()
    await page.getByLabel("الكود الشخصي").fill(member2.code)
    await page.getByRole("button", { name: "تحديد الشخص" }).click()
    await expect(page.getByText(member2.displayName)).toBeVisible()
    await page.getByRole("button", { name: "تأكيد التسجيل" }).click()
    await expect(page.getByText("تم تسجيل الحضور", { exact: false })).toBeVisible({
      timeout: 15_000,
    })

    const { data: row } = await admin
      .from("attendance_records")
      .select("id, profile_id, recorded_by, source")
      .eq("profile_id", member2.userId)
      .in("status", ["PRESENT", "LATE"])
      .maybeSingle()
    expect(row).toBeTruthy()
    expect(row!.profile_id).toBe(member2.userId)
    expect(row!.recorded_by).toBe(servantA.userId)
    expect(row!.source).toBe("CODE")

    // Audit: the manual-code path is a CHECKIN action, actor = servant.
    const audits = await auditRowsFor(admin, row!.id)
    expect(audits).toHaveLength(1)
    expect(audits[0].action).toBe("ATTENDANCE_CHECKIN")
    expect(audits[0].actor_id).toBe(servantA.userId)
    expect(audits[0].metadata?.profile_id).toBe(member2.userId)
    expect(audits[0].metadata?.subject_role).toBe("SERVED_MEMBER")
    expect(audits[0].metadata?.source).toBe("CODE")
  })

  test("188. Duplicate same-day (type) check-in is rejected and a single row survives", async ({ page }) => {
    // member2 already carries a CHURCH record for today (test 189) — scanning
    // the same code again must surface as an explicit duplicate, never a second row.
    await login(page, servantA.phone, servantA.password)
    await page.goto("/app/servant/attendance")

    await page.getByRole("button", { name: "فتح الماسح الضوئي" }).click()
    await page.getByRole("button", { name: "إدخال الكود يدويًا" }).click()
    await page.getByLabel("الكود الشخصي").fill(member2.code)
    await page.getByRole("button", { name: "تحديد الشخص" }).click()
    await expect(page.getByText(member2.displayName)).toBeVisible()
    await page.getByRole("button", { name: "تأكيد التسجيل" }).click()
    await expect(page.getByText("تم تسجيل الحضور بالفعل")).toBeVisible({
      timeout: 15_000,
    })

    // Idempotency: the duplicate attempt neither wrote a second attendance
    // row nor a second audit entry for the original record.
    const { data: record } = await admin
      .from("attendance_records")
      .select("id")
      .eq("profile_id", member2.userId)
      .in("status", ["PRESENT", "LATE"])
      .maybeSingle()
    expect(record).toBeTruthy()
    const audits = await auditRowsFor(admin, record!.id)
    expect(audits).toHaveLength(1)
    expect(audits[0].action).toBe("ATTENDANCE_CHECKIN")
    expect(audits[0].metadata?.profile_id).toBe(member2.userId)

    const { count } = await admin
      .from("attendance_records")
      .select("id", { count: "exact" })
      .eq("profile_id", member2.userId)
      .in("status", ["PRESENT", "LATE"])
    expect(count).toBe(1)
  })

  test("190. MEMBER and anonymous users cannot open the servant board", async ({ page }) => {
    const anonContext = await page.context().newPage()
    await anonContext.goto("/app/servant/attendance")
    await anonContext.waitForURL(/\/login/, { timeout: 15_000 })
    await expect(anonContext).not.toHaveURL(/\/app\/servant\/attendance/)
    await anonContext.close()

    await login(page, member.phone, member.password)
    await page.goto("/app/servant/attendance")
    await page.waitForFunction(
      () => !window.location.pathname.includes("/app/servant/attendance"),
      undefined,
      { timeout: 15_000 }
    )
    await expect(page.getByRole("heading", { name: "الحضور" })).toHaveCount(0)
  })

  // ---------------------------------------------------------------------------
  // RLS — scope-limited reads + the write shield
  // ---------------------------------------------------------------------------

  test("191. RLS: servant sees only SERVANT/SERVED_MEMBER scope and can never write records", async () => {
    const servantClient = createAnonClient()
    const { error: signInError } = await servantClient.auth.signInWithPassword({
      phone: servantA.phone,
      password: servantA.password,
    })
    expect(signInError).toBeNull()

    // -- Reads: scope-limited to servants & served members, non-archived.
    const { data: scoped } = await servantClient
      .from("profiles")
      .select("id")
      .in("id", [servantB.userId, member.userId])
    expect(scoped?.length).toBe(2)

    const { data: superProfile } = await servantClient
      .from("profiles")
      .select("id")
      .eq("id", superSeed.userId)
    expect(superProfile ?? []).toHaveLength(0)

    // -- Attendance records of a servant/member subject are visible…
    const { data: memberRows } = await servantClient
      .from("attendance_records")
      .select("id, profile_id")
      .eq("profile_id", member.userId)
      .in("status", ["PRESENT", "LATE"])
    expect(memberRows?.length).toBeGreaterThanOrEqual(1)

    // …but a SUPER_ADMIN subject's record is invisible.
    const { data: superRows } = await servantClient
      .from("attendance_records")
      .select("id")
      .eq("profile_id", superSeed.userId)
    expect(superRows ?? []).toHaveLength(0)

    // -- Writes: direct INSERT into attendance_records stays blocked.
    const { error: insertError } = await servantClient
      .from("attendance_records")
      .insert({
        session_id: churchSessionId,
        profile_id: member.userId,
        attended_at: new Date().toISOString(),
        points: 999,
        source: "MANUAL",
        status: "PRESENT",
        recorded_by: servantA.userId,
      })
    expect(insertError).not.toBeNull()

    // -- A SERVED_MEMBER cannot read others' records either.
    const memberClient = createAnonClient()
    const { error: memberSignInError } = await memberClient.auth.signInWithPassword({
      phone: member.phone,
      password: member.password,
    })
    expect(memberSignInError).toBeNull()
    const { data: otherRows } = await memberClient
      .from("attendance_records")
      .select("id")
      .eq("profile_id", servantA.userId)
    expect(otherRows ?? []).toHaveLength(0)
    const { error: memberInsertError } = await memberClient
      .from("attendance_records")
      .insert({
        session_id: churchSessionId,
        profile_id: member.userId,
        attended_at: new Date().toISOString(),
        points: 5,
        source: "MANUAL",
        status: "PRESENT",
        recorded_by: member.userId,
      })
    expect(memberInsertError).not.toBeNull()
  })

  // ---------------------------------------------------------------------------
  // Service layer — target guards and score attribution
  // ---------------------------------------------------------------------------

  test("192. Service rejects ADMIN/SUPER_ADMIN and inactive targets; scores follow the subject", async () => {
    // A SUPER_ADMIN target is never a valid attendance subject.
    const superOutcome = await checkInByProfileId(admin, {
      actorId: servantA.userId,
      profileId: superSeed.userId,
      type: "CHURCH",
    })
    expect(superOutcome.status).toBe("error")
    expect("message" in superOutcome ? superOutcome.message : "").toBe(
      "هذا النوع من الحسابات لا يسجّل حضورًا"
    )

    // Inactive subjects are rejected before any session is created.
    const inactiveOutcome = await checkInByProfileId(admin, {
      actorId: servantA.userId,
      profileId: memberInactive.userId,
      type: "CHURCH",
    })
    expect(inactiveOutcome.status).toBe("error")
    expect("message" in inactiveOutcome ? inactiveOutcome.message : "").toBe(
      "هذا الحساب غير نشط"
    )

    // Active member recorded while SERVANT is the actor:
    const outcome = await checkInByProfileId(admin, {
      actorId: servantA.userId,
      profileId: member2.userId,
      type: "SERVICE",
    })
    expect(outcome.status).toBe("success")
    if (outcome.status !== "success") return

    // The score lands on the SUBJECT (member2), not on the acting servant.
    const { data: rows } = await admin
      .from("attendance_records")
      .select("id, recorded_by, session:attendance_sessions(type)")
      .eq("profile_id", member2.userId)
      .in("status", ["PRESENT", "LATE"])
    const serviceRow = (rows ?? []).find(
      (r) => (r.session as { type?: string } | null)?.type === "SERVICE"
    )
    expect(serviceRow).toBeTruthy()
    expect(serviceRow!.recorded_by).toBe(servantA.userId)

    const { data: scores } = await admin
      .from("score_records")
      .select("id, points, category")
      .eq("profile_id", member2.userId)
    const subjectScores = (scores ?? []).filter(
      (s) => s.category === "SERVICE_ATTENDANCE" && Number(s.points) > 0
    )
    expect(subjectScores.length).toBeGreaterThanOrEqual(1)
  })

  test("193. Board shows inactive people as disabled with a clear notice", async ({ page }) => {
    await login(page, servantA.phone, servantA.password)
    await page.goto("/app/servant/attendance")
    await page.getByRole("tab", { name: "المخدومين" }).click()

    const inactiveRow = page.locator("li", { hasText: memberInactive.displayName })
    await expect(inactiveRow.getByText("غير نشط")).toBeVisible()
    await expect(
      inactiveRow.getByRole("button", { name: "تسجيل حضور" })
    ).toBeDisabled()
  })
})