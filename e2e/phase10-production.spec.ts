import { test, expect } from "@playwright/test"
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"
import { config as loadEnv } from "dotenv"
import { createAdminClient } from "../src/lib/supabase/admin"
import { requireEnvVar, assertSupabaseConnection } from "../src/lib/env"
import { resolveServerNow } from "../src/services/attendance-service"

/**
 * PHASE 10 — Production hardening & deployment readiness.
 *
 * Numbering continues from Phase 9 (ends at 177). Covers, on a live stack:
 *   178+179  security headers served on every response incl. CSP wiring;
 *   180      server-side env fail-fast guard (import-time safe by design);
 *   181      DB-backed rate limiter works and honors EXECUTE restrictions;
 *   182      public registration is throttled per source address (429);
 *   183      birthdays_for_today (SECURITY DEFINER, returns phone PII) is
 *            no longer callable by anon/authenticated — service role only;
 *   184      the test-clock override can never run under production NODE_ENV.
 */

loadEnv({ path: ".env.local" })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const APP_BASE = "http://localhost:3000"

function anonClient(): SupabaseClient {
  return createSupabaseClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function randomIp(): string {
  return `203.0.113.${Math.floor(2 + Math.random() * 253)}`
}

function randomPhone(): string {
  return "01" + String(Math.floor(100000000 + Math.random() * 900000000)).padStart(9, "0")
}

const createdUserIds: string[] = []

let admin: SupabaseClient

test.describe("PHASE 10 — Production hardening", () => {
  test.beforeAll(() => {
    admin = createAdminClient()
  })

  test("178. Security headers are served on HTML responses", async ({ request }) => {
    for (const path of ["/", "/login"]) {
      const res = await request.get(`${APP_BASE}${path}`)
      expect(res.ok(), `${path} should respond`).toBeTruthy()
      const csp = res.headers()["content-security-policy"]
      expect(csp, "CSP header present").toBeTruthy()
      expect(csp).toContain("default-src 'self'")
      expect(csp).toContain("object-src 'none'")
      expect(csp).toContain("frame-ancestors 'none'")
      expect(csp).toContain(SUPABASE_URL)
      expect(res.headers()["x-content-type-options"]).toBe("nosniff")
      expect(res.headers()["x-frame-options"]).toBe("DENY")
      expect(res.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin")
      expect(res.headers()["permissions-policy"]).toContain("camera=(self)")
    }
  })

  test("179. Missing production env vars fail fast, dev/test do not", () => {
    const sentinel = "__ATTENDANCE_TOOL_SENTINEL_NOT_SET__"
    expect(() => requireEnvVar(sentinel)).toThrow(/Missing required environment variable/)

    const savedNode = process.env.NODE_ENV
    const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const savedKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const savedSecret = process.env.SUPABASE_SERVICE_ROLE_KEY
    const env = process.env as unknown as Record<string, string | undefined>
    try {
      env.NODE_ENV = "test"
      delete env.NEXT_PUBLIC_SUPABASE_URL
      delete env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      delete env.SUPABASE_SERVICE_ROLE_KEY
      expect(() => assertSupabaseConnection()).not.toThrow()

      env.NODE_ENV = "production"
      expect(() => assertSupabaseConnection()).toThrow(/Invalid production configuration/)
    } finally {
      env.NODE_ENV = savedNode ?? "test"
      if (savedUrl) env.NEXT_PUBLIC_SUPABASE_URL = savedUrl
      if (savedKey) env.NEXT_PUBLIC_SUPABASE_ANON_KEY = savedKey
      if (savedSecret) env.SUPABASE_SERVICE_ROLE_KEY = savedSecret
    }
  })

  test("180. consume_rate_limit enforces a budget and honours EXECUTE restrictions", async () => {
    const key = `phase10:${Date.now()}:${Math.floor(Math.random() * 1e6)}`

    const { data: first } = await admin.rpc("consume_rate_limit", {
      p_key: key,
      p_limit: 1,
      p_window_seconds: 60,
    })
    const { data: second } = await admin.rpc("consume_rate_limit", {
      p_key: key,
      p_limit: 1,
      p_window_seconds: 60,
    })
    expect(first).toBe(true)
    expect(second).toBe(false)

    const memberKey = `phase10:${Date.now()}:${Math.floor(Math.random() * 1e6)}`
    const { data: freshAllowed } = await admin.rpc("consume_rate_limit", {
      p_key: memberKey,
      p_limit: 5,
      p_window_seconds: 30,
    })
    expect(freshAllowed).toBe(true)

    const anon = anonClient()
    const { error: anonError } = await anon.rpc("consume_rate_limit", {
      p_key: `phase10:anon:${Date.now()}`,
      p_limit: 1,
      p_window_seconds: 60,
    })
    expect(anonError, "anon must not call the limiter").not.toBeNull()

    await admin.from("request_throttles").delete().in("throttle_key", [key, memberKey])
  })

  test("181. Registering from the same address is throttled after 8 attempts", async ({ request }) => {
    const ip = randomIp()
    const attempt = () =>
      request.post(`${APP_BASE}/api/auth/register`, {
        headers: { "x-forwarded-for": ip },
        data: { role: "SERVED_MEMBER" },
      })

    for (let i = 0; i < 8; i++) {
      const res = await attempt()
      expect(res.status(), `attempt ${i + 1} rejected as valid`).toBe(400)
    }

    const blocked = await attempt()
    expect(blocked.status(), "9th attempt is throttled").toBe(429)
  })

  test("182. birthdays_for_today is service-role only (phone PII)", async () => {
    const anon = anonClient()
    const { data: anonData, error: anonError } = await anon.rpc("birthdays_for_today", {
      target_date: "2026-09-10",
    })
    expect(anonError, "anon must be denied").not.toBeNull()
    expect(anonData).toBeNull()

    const phone = `+20${randomPhone().replace(/^0/, "")}`
    const password = "Secret!12345"
    const { data: seeded, error: seedError } = await admin.auth.admin.createUser({
      phone,
      password,
      phone_confirm: true,
      email_confirm: true,
      user_metadata: { full_name: "مخدوم اختبار", role: "SERVED_MEMBER" },
    })
    expect(seedError, "seed user").toBeNull()
    const userId = seeded?.user?.id ?? null
    if (!seeded || !userId) throw new Error("seed user missing")
    createdUserIds.push(userId)
    await admin.from("profiles").insert({
      id: userId,
      role: "SERVED_MEMBER",
      full_name: "مخدوم اختبار",
      phone,
    })

    const authClient = anonClient()
    const { error: signInError } = await authClient.auth.signInWithPassword({ phone, password })
    expect(signInError, "sign in as member").toBeNull()

    const { error: authError } = await authClient.rpc("birthdays_for_today", {
      target_date: "2026-09-10",
    })
    expect(authError, "authenticated user must be denied").not.toBeNull()

    const { data, error } = await admin.rpc("birthdays_for_today", {
      target_date: "2026-09-10",
    })
    expect(error, "service role still works").toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  test("183. The test-clock override cannot run under production NODE_ENV", () => {
    const override = "2020-01-01T12:00:00.000Z"
    const asDate = new Date(override)

    const devNow = resolveServerNow(override, process.env.NODE_ENV !== "production")
    expect(devNow.getTime()).toBe(asDate.getTime())

    const prodNow = resolveServerNow(override, false)
    expect(prodNow.getTime()).not.toBe(asDate.getTime())
    expect(prodNow.getTime()).toBeGreaterThan(new Date("2021-01-01").getTime())
  })

  test.afterAll(async () => {
    await admin.from("profiles").delete().in("id", createdUserIds)
    await Promise.all(
      createdUserIds.map((id) => admin.auth.admin.deleteUser(id))
    )
  })
})