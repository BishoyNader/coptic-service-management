import { test, expect } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"
import { config as loadEnv } from "dotenv"
import { createAdminClient } from "../src/lib/supabase/admin"
import { createAnonClient } from "./helpers"
import { cairoDateString } from "../src/lib/cairo"
import { resolveServerNow } from "../src/services/attendance-service"
import { isUuid } from "../src/lib/validation"

/**
 * PHASE 9 — Quality, reliability & UX hardening.
 *
 * Numbering starts at 166. Covers: test-time clock gating, service-role-only
 * RPCs, the concurrent check-in race, void/type-change RPCs, servant activity
 * self-recording RLS (role gate + future-date backstop + same-day removal),
 * and DB/server backups for date-of-birth and future-dates integrity.
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

async function createUser(
  admin: SupabaseClient,
  role: "SERVED_MEMBER" | "SERVANT",
  phone: string,
  password: string,
  opts: { name?: string } = {}
) {
  const normalized = normalizePhone(phone)
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    phone: normalized,
    password,
    phone_confirm: true,
    email_confirm: true,
    user_metadata: { full_name: opts.name ?? "مستخدم فحص الجودة", role },
  })
  if (authError) throw new Error(`seed auth: ${authError.message}`)
  const userId = authData.user.id

  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    role,
    full_name: opts.name ?? (role === "SERVANT" ? "خادم فحص الجودة" : "مخدوم فحص الجودة"),
    phone: normalized,
  })
  if (profileError) throw new Error(`seed profile: ${profileError.message}`)

  return { userId, phone: normalized, phoneRaw: phone, password, displayName: opts.name }
}

test.describe("PHASE 9 — Quality, reliability & UX hardening", () => {
  test.describe.configure({ mode: "serial" })
  const createdPhones: string[] = []
  const createdSessionIds: string[] = []
  let admin: SupabaseClient
  let superSeed: Awaited<ReturnType<typeof createUser>>
  let servantSeed: Awaited<ReturnType<typeof createUser>>
  let memberSeed: Awaited<ReturnType<typeof createUser>>
  let churchSessionId: string
  let serviceSessionId: string

  test.beforeAll(async () => {
    admin = createAdminClient()

    superSeed = await createUser(admin, "SERVED_MEMBER", randomPhone(), "QualityAdmin1!", {
      name: "رئيس عمليات الجودة",
    })
    createdPhones.push(superSeed.phoneRaw)

    servantSeed = await createUser(admin, "SERVANT", randomPhone(), "QualityServ7!", {
      name: "خادم فحص الجودة",
    })
    createdPhones.push(servantSeed.phoneRaw)

    memberSeed = await createUser(admin, "SERVED_MEMBER", randomPhone(), "QualityMember7!", {
      name: "مخدوم فحص الجودة",
    })
    createdPhones.push(memberSeed.phoneRaw)

    const today = cairoDateString(new Date())
    const { data: sessions, error: sessionError } = await admin
      .from("attendance_sessions")
      .insert({
        type: "CHURCH",
        title: "قداس فحص الجودة",
        session_date: today,
        created_by: superSeed.userId,
      })
      .select("id")
      .single()
    if (sessionError) throw new Error(`seed session: ${sessionError.message}`)
    churchSessionId = sessions.id as string
    createdSessionIds.push(churchSessionId)

    const { data: serviceSessions, error: serviceSessionError } = await admin
      .from("attendance_sessions")
      .insert({
        type: "SERVICE",
        title: "خدمة فحص الجودة",
        session_date: today,
        created_by: superSeed.userId,
      })
      .select("id")
      .single()
    if (serviceSessionError) throw new Error(`seed service session: ${serviceSessionError.message}`)
    serviceSessionId = serviceSessions.id as string
    createdSessionIds.push(serviceSessionId)
  })

  async function cleanupTestData() {
    const userIds: string[] = []
    for (const phone of createdPhones.map(normalizePhone)) {
      const { data } = await admin.from("profiles").select("id").eq("phone", phone).maybeSingle()
      if (data) userIds.push(data.id as string)
    }
    if (userIds.length) {
      await admin.from("servant_activity_records").delete().in("servant_id", userIds)
      await admin.from("attendance_records").delete().in("profile_id", userIds)
      await admin.from("score_records").delete().in("profile_id", userIds)
      await admin.from("audit_logs").delete().eq("entity", "TEST_ATTENDANCE")
      await admin.from("attendance_sessions").delete().in("id", createdSessionIds)
    }
    for (const uid of userIds) {
      await admin.auth.admin.deleteUser(uid)
    }
    createdSessionIds.length = 0
  }

  test.afterAll(async () => {
    if (process.env.KEEP_PHASE9_DATA === "1") return
    await cleanupTestData()
  })

  // ---------------------------------------------------------------------------
  // A. Clock gating — the E2E time override must never run in production
  // ---------------------------------------------------------------------------

  test("166. resolveServerNow ignores the override when not allowed", () => {
    const override = "2030-01-01T00:00:00.000Z"
    const now = resolveServerNow(override, false)
    expect(now.toISOString()).not.toBe(override)
    expect(Math.abs(now.getTime() - Date.now())).toBeLessThan(5_000)
  })

  test("167. resolveServerNow honors a valid override when allowed", () => {
    const override = "2026-01-15T09:30:00.000Z"
    expect(resolveServerNow(override, true).toISOString()).toBe(override)
  })

  test("168. resolveServerNow falls back to now for an invalid override", () => {
    const now = resolveServerNow("not-a-date", true)
    expect(Math.abs(now.getTime() - Date.now())).toBeLessThan(5_000)
  })

  // ---------------------------------------------------------------------------
  // B. Transactional RPCs are locked to the service role
  // ---------------------------------------------------------------------------

  test("169. RPC record_attendance_with_score is blocked for client roles", async () => {
    const anon = createAnonClient()
    const params = {
      p_session_id: churchSessionId,
      p_profile_id: memberSeed.userId,
      p_attended_at: new Date().toISOString(),
      p_points: 10,
      p_recorded_by: superSeed.userId,
      p_source: "QR",
      p_score_category: "CHURCH_ATTENDANCE",
      p_score_rule_id: null,
      p_session_date: cairoDateString(new Date()),
    }

    const { error: anonError } = await anon.rpc("record_attendance_with_score", params)
    expect(anonError).not.toBeNull()

    const memberClient = createAnonClient()
    await memberClient.auth.signInWithPassword({
      phone: memberSeed.phone,
      password: memberSeed.password,
    })
    const { error: memberError } = await memberClient.rpc(
      "record_attendance_with_score",
      params
    )
    expect(memberError).not.toBeNull()
  })

  test("170. Parallel check-ins for the same session record exactly one row", async () => {
    const params = {
      p_session_id: churchSessionId,
      p_profile_id: memberSeed.userId,
      p_attended_at: new Date().toISOString(),
      p_points: 10,
      p_recorded_by: superSeed.userId,
      p_source: "QR",
      p_score_category: "CHURCH_ATTENDANCE",
      p_score_rule_id: null,
      p_session_date: cairoDateString(new Date()),
    }

    const [a, b] = await Promise.all([
      admin.rpc("record_attendance_with_score", params),
      admin.rpc("record_attendance_with_score", params),
    ])

    const statuses = [a.data?.status, b.data?.status]
    expect(statuses.filter((s) => s === "success").length).toBe(1)
    expect(statuses.filter((s) => s === "duplicate").length).toBe(1)

    const { data: rows } = await admin
      .from("attendance_records")
      .select("id")
      .eq("profile_id", memberSeed.userId)
      .eq("session_id", churchSessionId)
      .neq("status", "ARCHIVED")
    expect(rows?.length).toBe(1)
  })

  test("171. void_attendance archives the record exactly once", async () => {
    const params = {
      p_session_id: serviceSessionId,
      p_profile_id: memberSeed.userId,
      p_attended_at: new Date().toISOString(),
      p_points: 10,
      p_recorded_by: superSeed.userId,
      p_source: "MANUAL",
      p_score_category: "SERVICE_ATTENDANCE",
      p_score_rule_id: null,
      p_session_date: cairoDateString(new Date()),
    }
    const { data: created, error: createError } = await admin.rpc(
      "record_attendance_with_score",
      params
    )
    expect(createError).toBeNull()
    expect(created?.status).toBe("success")

    const first = await admin.rpc("void_attendance", { p_record_id: created.id })
    expect(first.data).toMatchObject({ ok: true })

    const { data: row } = await admin
      .from("attendance_records")
      .select("status")
      .eq("id", created.id)
      .maybeSingle()
    expect(row?.status).toBe("ARCHIVED")

    const second = await admin.rpc("void_attendance", { p_record_id: created.id })
    expect(second.data).toMatchObject({ ok: false, error: "already_archived" })
  })

  // ---------------------------------------------------------------------------
  // C. Servant activity self-recording (RLS)
  // ---------------------------------------------------------------------------

  test("172. SERVANT self-records and same-day removes their own activity (RLS)", async () => {
    const servantClient = createAnonClient()
    const { error: signInError } = await servantClient.auth.signInWithPassword({
      phone: servantSeed.phone,
      password: servantSeed.password,
    })
    expect(signInError).toBeNull()

    const { data: activity } = await admin
      .from("activities")
      .select("id")
      .eq("code", "ATTENDED_LITURGY")
      .maybeSingle()
    expect(activity).toBeTruthy()

    const { data: inserted, error: insertError } = await servantClient
      .from("servant_activity_records")
      .insert({
        servant_id: servantSeed.userId,
        activity_id: activity!.id,
        recorded_by: servantSeed.userId,
      })
      .select("id")
      .single()
    expect(insertError).toBeNull()
    expect(inserted?.id).toBeTruthy()

    const { data: ownRows } = await servantClient
      .from("servant_activity_records")
      .select("id")
      .eq("servant_id", servantSeed.userId)
    expect(ownRows?.length).toBeGreaterThanOrEqual(1)

    const { error: deleteError } = await servantClient
      .from("servant_activity_records")
      .delete()
      .eq("id", inserted!.id)
    expect(deleteError).toBeNull()

    const { data: after } = await admin
      .from("servant_activity_records")
      .select("id")
      .eq("id", inserted!.id)
      .maybeSingle()
    expect(after).toBeNull()
  })

  test("173. SERVANT cannot record a FUTURE activity date (DB backstop)", async () => {
    const servantClient = createAnonClient()
    await servantClient.auth.signInWithPassword({
      phone: servantSeed.phone,
      password: servantSeed.password,
    })
    const { data: activity } = await admin
      .from("activities")
      .select("id")
      .eq("code", "WORE_TUNIC")
      .maybeSingle()
    expect(activity).toBeTruthy()

    const today = cairoDateString(new Date())
    const future = new Date(new Date().getTime() + 2 * 86_400_000).toISOString().slice(0, 10)
    expect(future > today).toBe(true)

    const { error } = await servantClient.from("servant_activity_records").insert({
      servant_id: servantSeed.userId,
      activity_id: activity!.id,
      recorded_by: servantSeed.userId,
      recorded_on: future,
    })
    expect(error).not.toBeNull()
  })

  test("174. SERVANT cannot delete a PAST activity record via the UI layer", async () => {
    const servantClient = createAnonClient()
    await servantClient.auth.signInWithPassword({
      phone: servantSeed.phone,
      password: servantSeed.password,
    })
    const { data: activity } = await admin
      .from("activities")
      .select("id")
      .eq("code", "ATTENDED_SERVICE")
      .maybeSingle()
    expect(activity).toBeTruthy()

    const yesterday = new Date(new Date().getTime() - 86_400_000).toISOString().slice(0, 10)
    const { data: past } = await servantClient
      .from("servant_activity_records")
      .insert({
        servant_id: servantSeed.userId,
        activity_id: activity!.id,
        recorded_by: servantSeed.userId,
        recorded_on: yesterday,
      })
      .select("id")
      .single()
    expect(past?.id).toBeTruthy()

    const res = await servantClient
      .from("servant_activity_records")
      .delete({ count: "exact" })
      .eq("id", past!.id)
    expect(res.error).toBeNull()
    expect(res.count).toBe(0)

    const { data: stillThere } = await admin
      .from("servant_activity_records")
      .select("id")
      .eq("id", past!.id)
      .maybeSingle()
    expect(stillThere).toBeTruthy()
  })

  test("175. A MEMBER cannot self-insert servant activity rows (role gate)", async () => {
    const memberClient = createAnonClient()
    await memberClient.auth.signInWithPassword({
      phone: memberSeed.phone,
      password: memberSeed.password,
    })
    const { data: activity } = await admin
      .from("activities")
      .select("id")
      .eq("code", "GAVE_LESSON")
      .maybeSingle()
    expect(activity).toBeTruthy()

    const { error } = await memberClient.from("servant_activity_records").insert({
      servant_id: memberSeed.userId,
      activity_id: activity!.id,
      recorded_by: memberSeed.userId,
    })
    expect(error).not.toBeNull()
  })

  // ---------------------------------------------------------------------------
  // D. Date-of-birth integrity (DB CHECK + server validation)
  // ---------------------------------------------------------------------------

  test("176. A FUTURE date_of_birth is rejected at the DB level", async () => {
    const memberClient = createAnonClient()
    await memberClient.auth.signInWithPassword({
      phone: memberSeed.phone,
      password: memberSeed.password,
    })

    const future = new Date(new Date().getTime() + 5 * 86_400_000).toISOString().slice(0, 10)
    const { error } = await memberClient
      .from("profiles")
      .update({ date_of_birth: future })
      .eq("id", memberSeed.userId)
    expect(error).not.toBeNull()

    const { data: profile } = await admin
      .from("profiles")
      .select("date_of_birth")
      .eq("id", memberSeed.userId)
      .maybeSingle()
    expect(profile?.date_of_birth).toBeNull()
  })

  test("177. The registration API rejects a future date_of_birth", async ({ request }) => {
    const phone = randomPhone()
    createdPhones.push(phone)
    const futureDob = new Date(new Date().getTime() + 10 * 86_400_000).toISOString().slice(0, 10)
    const response = await request.post("http://localhost:3000/api/auth/register", {
      data: {
        role: "SERVED_MEMBER",
        fullName: "مخدوم تاريخ مستقبلي",
        phone,
        password: "FutureDob7!",
        confirmPassword: "FutureDob7!",
        dateOfBirth: futureDob,
      },
    })
    expect(response.status()).toBe(400)
    const body = await response.json()
    expect(body.ok).toBe(false)
    expect(body.field).toBe("dateOfBirth")
  })

  test("178. Random UUIDs are validated before any RPC touch", () => {
    expect(isUuid(randomUuid())).toBe(true)
    expect(isUuid("not-a-uuid")).toBe(false)
    expect(isUuid(undefined)).toBe(false)
    expect(isUuid("00000000-0000-4000-8000-000000000000")).toBe(true)
  })
})