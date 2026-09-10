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
 * Protected by the CRON_SECRET environment variable.
 * In production, call this from a cron scheduler (e.g. Vercel Cron, cron-job.org)
 * with the Authorization header: "Bearer <CRON_SECRET>".
 *
 * For local development, call it manually:
 *   curl http://localhost:3000/api/cron/birthdays?secret=YOUR_CRON_SECRET
 *
 * The function is idempotent — running it multiple times on the same day
 * will not duplicate reminders.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const secret = url.searchParams.get("secret") ?? request.headers.get("authorization")?.replace("Bearer ", "")

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
