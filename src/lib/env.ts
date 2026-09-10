/**
 * Server/edge-safe environment helpers.
 *
 * PUBLIC variables (NEXT_PUBLIC_*) are inlined by Next into the browser
 * bundle and are safe to read anywhere. SERVER variables are guarded here so
 * a production process fails fast with a clear message instead of silently
 * running degraded.
 *
 * Failure is intentionally lazy: assertions run when a client is created (a
 * real request), never at import time, so `next build` and isolated tooling
 * do not crash on a missing local dotenv. In development/test the assertions
 * are skipped so the local flow never blocks on prod-only variables.
 */

/** Live check (not captured at import) so configuration guards react to env. */
export function isProduction(): boolean {
  return process.env.NODE_ENV === "production"
}

/** True when the app is running outside production (dev or test). */
export function requireEnvVar(name: string, opts?: { when?: boolean }): string {
  if (opts?.when === false) return process.env[name] ?? ""
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

/**
 * Fail-fast guard for the three Supabase connection variables. Enforced only
 * in production — in dev/test the local flow works with a partial dotenv.
 */
export function assertSupabaseConnection(): void {
  if (!isProduction()) return
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const
  const missing = required.filter((name) => !process.env[name])
  if (missing.length > 0) {
    throw new Error(
      `Invalid production configuration — missing required environment variables: ${missing.join(
        ", "
      )}`
    )
  }
}

/** Production requires a real CRON_SECRET; dev can run without the cron job. */
export function assertCronSecret(): string | null {
  const secret = process.env.CRON_SECRET
  if (isProduction() && !secret) {
    throw new Error("Invalid production configuration — missing CRON_SECRET")
  }
  return secret ?? null
}

/** Canonical site origin, used for Supabase redirect/CORS documentation. */
export function getSiteUrl(): string {
  return process.env.SITE_URL || "http://localhost:3000"
}

/** True when the TWILIO external-delivery variables are all present. */
export function isTwilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_SMS_FROM || process.env.TWILIO_WHATSAPP_FROM)
  )
}