import { createClient as createSupabaseClient } from "@supabase/supabase-js"

/**
 * Service-role Supabase client. Server-only.
 *
 * The service role bypasses Row Level Security, so this client may only be
 * imported from Server Actions / Route Handlers / server utilities and must
 * never be exposed to the browser.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  )
}

export type SupabaseAdminClient = ReturnType<typeof createAdminClient>