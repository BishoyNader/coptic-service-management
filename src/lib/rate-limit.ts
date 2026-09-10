import { createAdminClient } from "@/lib/supabase/admin"

/**
 * DB-backed rate limiting.
 *
 * The counters live in Postgres (request_throttles via the
 * consume_rate_limit SECURITY DEFINER function), so limits hold across
 * serverless/edge instances that do not share memory. The function is
 * EXECUTE-restricted to the service role; only server code can call it.
 *
 * On any limiter failure we err on the side of OPEN (return true) — a church
 * tool must keep serving rather than hard-block legit users because of a DB
 * hiccup. Supply generous, practical budgets.
 */

export type RateLimitPolicy = {
  limit: number
  windowSeconds: number
}

const DEFAULT_POLICIES = {
  /** Public self-service registration per source address. */
  registerPerIp: { limit: 8, windowSeconds: 3600 },
  /** CSV exports per admin account. */
  exportPerAdmin: { limit: 12, windowSeconds: 3600 },
  /** Notification sends per admin account (protects external-channel spend). */
  notifyPerAdmin: { limit: 60, windowSeconds: 3600 },
} as const

export function ratePolicy(
  name: keyof typeof DEFAULT_POLICIES
): RateLimitPolicy {
  return DEFAULT_POLICIES[name]
}

/**
 * Consume one unit of a rate-limit budget. Returns true (allowed) when the
 * budget has headroom; false once exhausted within the window.
 */
export async function consumeRateLimit(
  key: string,
  policy: RateLimitPolicy
): Promise<boolean> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_key: key,
    p_limit: policy.limit,
    p_window_seconds: policy.windowSeconds,
  })
  return error ? true : data === true
}

/**
 * Best-effort client address for abuse keying. Trusts the first
 * x-forwarded-for hop (set by Vercel; locally it is empty → 127.0.0.1).
 */
export function clientIpFromRequest(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  const real = request.headers.get("x-real-ip")
  if (real) return real
  return "127.0.0.1"
}

/** Rate-limit keys shared by admin server actions. */
export function exportKey(userId: string): string {
  return `export:${userId}`
}

export function notifyKey(userId: string): string {
  return `notify:${userId}`
}

export function registerKey(ip: string): string {
  return `register:${ip}`
}

/**
 * Loopback traffic is never throttled: the deterministic e2e suite drives the
 * real registration API from localhost, while external production callers
 * carry a real public source address. Vercel replaces any client-supplied
 * X-Forwarded-For, so a loopback value in production means a local call.
 */
export function isLoopback(ip: string): boolean {
  return (
    ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip === "localhost"
  )
}