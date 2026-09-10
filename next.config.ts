import type { NextConfig } from "next";

/**
 * Security hardening (Phase 10).
 * - CSP tuned for this app: Supabase REST + WSS for the configured project,
 *   camera capture (QR attendance) via `media-src`, dev-time HMR websockets
 *   only in development.
 * - Anti-busting / anti-exfil headers applied to every response.
 *
 * NOTE: script-src keeps 'unsafe-inline'/'unsafe-eval' because the Next.js
 * App Router hydration + RSC flight payloads require them; the CSP still
 * locks down data exfiltration vectors (connect-src, frame-ancestors,
 * object-src, base-uri).
 */

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:55321";

const supabaseHost = SUPABASE_URL.replace(/^https?:\/\//, "");

const cspConnectSrc = ["'self'", SUPABASE_URL, `wss://${supabaseHost}`];

if (process.env.NODE_ENV !== "production") {
  cspConnectSrc.push(
    "ws://localhost:*",
    "http://localhost:*",
    "ws://127.0.0.1:*",
    "http://127.0.0.1:*"
  );
}

const contentSecurityPolicy = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob:`,
  `font-src 'self' data:`,
  `media-src 'self' blob:`,
  `connect-src ${cspConnectSrc.join(" ")}`,
  `worker-src 'self' blob:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `frame-ancestors 'none'`,
  `form-action 'self'`,
  `frame-src 'self'`,
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(), microphone=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;