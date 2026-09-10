# Deployment & Production Readiness

Production is **Vercel (Next.js)** + **Supabase (Postgres/Auth)**, matching the
local monorepo layout. This runbook is additive hardening — no redesign.

Environment classes are documented in `.env.example`. A production server
**fails fast (500)** when the required Supabase variables are missing
(`src/lib/env.ts`), so a mis-deploy never silently runs degraded.

---

## 1. Environment matrix (production)

| Variable | Class | Required | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | PUBLIC | ✅ | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | PUBLIC | ✅ | anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | SERVER | ✅ | service_role — bypasses RLS, server-only |
| `CRON_SECRET` | SERVER | ✅ prod | ≥ 32 hex chars; `openssl rand -hex 32` |
| `SITE_URL` | SERVER | recommended | public origin, e.g. `https://app.church.org` |
| `TWILIO_ACCOUNT_SID` | SERVER | optional | SMS/WhatsApp delivery |
| `TWILIO_AUTH_TOKEN` | SERVER | optional | SMS/WhatsApp delivery |
| `TWILIO_SMS_FROM` | SERVER | optional | E.164 Twilio number |
| `TWILIO_WHATSAPP_FROM` | SERVER | optional | `whatsapp:+1...` |
| `ATTENDANCE_TEST_NOW` | TEST | — | **ignored in production** (hard NODE_ENV gate) |

> Twilio rules: SMS needs SID+token+`TWILIO_SMS_FROM`; WhatsApp needs
> SID+token+`TWILIO_WHATSAPP_FROM`. Missing vars → `PROVIDER_NOT_CONFIGURED`
> (in-app delivery still works; nothing is faked, every failure is logged to
> `notification_deliveries`).
> Rate limits are DB-backed and documented in `src/lib/rate-limit.ts`
> (register 8/h per IP, CSV exports 12/h per admin, broadcasts 60/h per admin).

## 2. Supabase readiness

- **Service role key** stays server-side only. Cloud projects **disable "secret
  key exposure"** warnings by keeping it out of Vercel public envs.
- **RLS is enabled on every table** (`rls_enabled` + restrictive policies from
  migrations `20260907…` → `20260915…`). Verify after linking:
  `select relname from pg_class where relrowsecurity = true;`
- **SECURITY DEFINER surface is minimal**: `consume_rate_limit` and
  `birthdays_for_today` are `EXECUTE … service_role only`; app RPCs were
  revoked from public in Phase 9; every definer function pins `search_path`.
- **Auth providers**: only phone is used today. Keep the public `anon` key
  publishable and the admin (`supabase_admin`/dashboard) password rotated.
- **Backups (daily, automatic)** are enabled for paid plans; see §6 [backup]
  for the restore drill. Do **not** rely on the local DB for production data.

## 3. Vercel readiness

1. `SITE_URL` → Vercel domain (`https://…`).
2. Set `NODE_VERSION`/engines: `>=20.9.0` (package.json `engines`).
3. Add all variables from §1 to the project env. Public/servers split per class.
4. Cron: birthday automation runs daily at 08:00 Cairo —
   `https://<host>/api/cron/birthdays` with header
   `Authorization: Bearer <CRON_SECRET>`. Configure as a Vercel Cron
   (`crons` in `vercel.json`), or any external scheduler (GitHub Actions
   `schedule`, cron-job.org) — the endpoint only accepts the Bearer secret.
   Add this root to `vercel.json`:
   ```json
   {
     "crons": [
       { "path": "/api/cron/birthdays", "schedule": "0 6 * * *" }
     ]
   }
   ```
   (08:00 Africa/Cairo == 06:00 UTC outside summer DST; confirm your
   scheduler’s timezone — Supabase Vercel crons run in UTC.)
5. **Region**: identical for Vercel and Supabase (e.g. `fra1`) to keep
   latencies low.
6. The app is RTL-first; no other framework-level setting is needed.

## 4. Security headers (already applied app-wide)

`next.config.ts` adds: CSP (`connect-src` includes the Supabase origin),
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy`, `Permissions-Policy` (camera allowed for QR attendance),
HSTS. `script-src` carries `'unsafe-inline'/'unsafe-eval'` because of Next.js
hydration/RSC. Verify any deployed domain with securityheaders.com after launch.

## 5. Launch checklist

- [ ] Supabase project linked; ENV vars loaded; `SITE_URL` set.
- [ ] `npm run typecheck && npm run lint && npm run build` clean.
- [ ] CI green on the branch.
- [ ] RLS verified on all tables; RPC grants verified (service-role only).
- [ ] Cron endpoint reachable with the Bearer secret → run it once manually;
      check `birthday_reminders` + `notification_deliveries` rows appear.
- [ ] Twilio trial/sandbox verified with a real number (if external delivery is
      wanted in prod).
- [ ] `vercel.json` crons (or external scheduler) registered.
- [ ] Cloud backup + restore drill done (see below).
- [ ] Production smoke test on `/`, `/login`, `/register`, a member and an
      admin page (QR camera included).

## 6. Backups & recovery (Supabase)

- Daily automated backups (7-day rolling) on paid plans; throttle both PITR
  time and download access to project owners.
- **Restore drill**: download last backup → spin a throwaway playground
  project → `supabase db restore` equivalent (or link + `supabase db push`) →
  verify login + one report + one export.
- Local dev database is disposable (`supabase db reset` re-applies all
  migrations idempotently). Application seed data lives only in local e2e
  suites.

## 7. Monitoring & observability

- **Errors**: Vercel Function/Edge logs + Supabase Logs Explorer. Audit trail
  lives app-side in `audit_log` (server actions record who/what/when).
- **Delivery health**: `notification_deliveries` rows carry `channel`,
  `status` (delivered/error `errorMessage`) — a simple dashboard query tells
  you if Twilio is failing.
- **Signals**: registration 429 events (rate limiter), provider
  not-configured rows, failed cron runs (watch the cron HTTP status + the
  `birthday_reminders` insert count for the day).
- **Alerting**: cheap effective tripwires — cron status 5xx, notification
  failure ratio > threshold, disk/backup health from Supabase dashboard.

## 8. Rollback

- App: Vercel instant rollback to the previous deployment.
- DB: no destructive schema changes committed in a single deploy — apply DB
  migrations together with the app version; restore-from-backup is the
  documented recovery path for schema/data incidents.
- Feature flag-free by design (small surface). Verify the previous deployment
  works off the same DB schema before relying on it.

## 9. Local stack reference

```bash
supabase start          # API :55321, Studio :55323
npm run dev             # http://localhost:3000
npx playwright test     # full e2e suite (deterministic, workers=1)
```