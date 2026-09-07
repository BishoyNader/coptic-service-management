import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

/**
 * Server-side Supabase client authenticated as the current user via
 * cookies. RLS is enforced — used inside Server Components and
 * Server Actions / Route Handlers where the user session is expected.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — safe to ignore when
            // middleware has already refreshed the session.
          }
        },
      },
    }
  )
}

export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>