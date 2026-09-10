import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { runBirthdayAutomation } from "@/services/birthday-automation"
import { timingSafeEqual } from "crypto"

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * GET /api/cron/birthdays — Run the daily birthday automation.
 *
 * Protected by the CRON_SECRET environment variable, transmitted ONLY via
 * the `Authorization: Bearer <CRON_SECRET>` header (never a query string, so
 * the secret can't leak into logs/analytics). In production, call from a cron
 * scheduler with that header.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/birthdays
 *
 * The function is idempotent — running it multiple times on the same day
 * will not duplicate reminders.
 */
export async function GET(request: Request) {
  const authorization = request.headers.get("authorization")
  const secret = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null

  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on the server" },
      { status: 500 }
    )
  }

  if (!secret || !safeCompare(secret, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const admin = createAdminClient()

    const result = await runBirthdayAutomation(admin, {
      externalChannels: ["SMS", "WHATSAPP"],
    })

    return NextResponse.json({
      ok: true,
      ...result,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
