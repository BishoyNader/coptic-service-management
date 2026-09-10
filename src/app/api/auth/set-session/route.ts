import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

/**
 * Persists a browser session (obtained client-side from the recovery/email
 * link, where tokens arrive in the URL fragment) into the cookie session
 * used by the server clients. POST only; validates a real token pair.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const accessToken = body?.access_token as string | undefined
  const refreshToken = body?.refresh_token as string | undefined

  if (!accessToken || !refreshToken) {
    return NextResponse.json({ ok: false, message: "missing tokens" }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  })

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 401 })
  }

  return NextResponse.json({ ok: true })
}