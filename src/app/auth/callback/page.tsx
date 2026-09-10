"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"

/**
 * Auth callback for email recovery links.
 *
 * Supabase delivers magic-link tokens in the URL *fragment* (implicit flow)
 * or as a PKCE `code` in the query string. A server route cannot read the
 * fragment and the SSR browser client skips URL detection, so this client
 * page parses the tokens itself, persists them into the cookie session via
 * /api/auth/set-session, then forwards to /reset-password.
 *
 * Everything is read from window.location (query + hash) so no Suspense
 * boundary or useSearchParams is needed.
 */
export default function AuthCallbackPage() {
  const router = useRouter()
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const query = new URLSearchParams(window.location.search)
        let accessToken: string | null = null
        let refreshToken: string | null = null

        const fragment = parseFragmentTokens(window.location)
        if (fragment) {
          accessToken = fragment.access_token
          refreshToken = fragment.refresh_token
        } else {
          const code = query.get("code")
          if (!code) throw new Error("no recovery token")
          const { createClient } = await import("@/lib/supabase/client")
          const supabase = createClient()
          const { data, error: exError } = await supabase.auth.exchangeCodeForSession(code)
          if (exError || !data.session) throw exError ?? new Error("code exchange failed")
          accessToken = data.session.access_token
          refreshToken = data.session.refresh_token
        }

        if (!accessToken || !refreshToken) throw new Error("no tokens")

        const res = await fetch("/api/auth/set-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }),
        })
        if (!res.ok) throw new Error("session persist failed")
        if (cancelled) return

        const next = query.get("next") ?? "/reset-password"
        router.replace(next)
        router.refresh()
      } catch {
        if (!cancelled) setError(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-3xl bg-card p-8 text-center shadow-sm ring-1 ring-foreground/5">
        <p className="font-heading text-lg font-extrabold">تحقق من الرابط</p>
        <p className="text-sm text-muted-foreground">
          الرابط غير صالح أو منتهي — اطلب رابط إعادة تعيين جديد وافتحه على نفس المتصفح.
        </p>
      </div>
    )
  }

  return (
    <div className="flex justify-center py-20">
      <Loader2 className="size-7 animate-spin text-muted-foreground" />
    </div>
  )
}

function parseFragmentTokens(
  location: Pick<Location, "hash">
): { access_token: string; refresh_token: string } | null {
  const raw = location.hash.replace(/^#/, "")
  if (!raw) return null
  const params = new URLSearchParams(raw)
  const accessToken = params.get("access_token")
  const refreshToken = params.get("refresh_token")
  if (!accessToken || !refreshToken) return null
  return { access_token: accessToken, refresh_token: refreshToken }
}