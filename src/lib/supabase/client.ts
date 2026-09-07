import { createBrowserClient } from "@supabase/ssr"

/**
 * Browser Supabase client. Runs under the anonymous key and is bound by
 * Row Level Security. Never put the service-role key anywhere near this file.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export type SupabaseBrowserClient = ReturnType<typeof createClient>