# Attendance Tool — إدارة الخدمة

Coptic Orthodox Church service management web app. Arabic-first, RTL, mobile-first, with a full role-based dashboard for served members (مخدوم), servants (خدام), and church administration.

## Tech stack

- **Next.js 16** (App Router, React 19, TypeScript, `src/proxy.ts` for route protection)
- **Tailwind CSS v4** with a custom Coptic Orthodox design system (oklch palette, Cairo + Amiri fonts, lattice patterns)
- **shadcn/ui** (base-nova style) with Radix Base UI primitives
- **Supabase** (Postgres + Auth + PostgREST) with Row Level Security
- **qrcode.react** for the member QR codes
- **Playwright** for end-to-end tests

## Roles & route map

| Role | Segments | Home |
| --- | --- | --- |
| `SERVED_MEMBER` | `/app/member/*` | member dashboard + personal QR |
| `SERVANT` | `/app/servant/*` | servant dashboard + check-in |
| `ADMIN` | `/app/admin/*` | attendance, scoring, members, birthdays, notifications |
| `SUPER_ADMIN` | `/app/super-admin/*` | everything above + users, servants, audit log, reports, settings |

Public registration is limited to served members and servants via `/register/member` and `/register/servant`. ADMIN and SUPER_ADMIN accounts are only provisioned by another super-admin (the privileged-user dialog) — never via public registration.

Full route map (from `npm run build`):

```
/auth/callback, /login, /register(/member|/servant), /forgot-password, /reset-password
/app/{member,servant,admin,super-admin}/{,account,notifications}
/app/servant/{qr,activities}
/app/member/{qr,scores}
/app/admin/{members,members/[id],attendance,scores,birthdays,notifications}
/app/super-admin/{users,user/[id],members,servants,attendance,scores,birthdays,audit-log,reports,settings,notifications}
/api/auth/{register,set-session}
```

## What's built

1. **Accounts & registration** — public member/servant sign-up (phone + password), phone+email sign-in, session handling, role-segmented shells.
2. **Identity & QR** — personal 6-digit code + QR per served member (QR encodes a random UUID only; privileged accounts deliberately get **no** personal code/QR).
3. **Attendance** — servant/admin QR check-in (server-side, RLS-enforced), attendance sessions with active/inactive state, manual entry for phone-only attendees, today’s records on each dashboard.
4. **Scoring** — per-activity scores against seeded `scoring_rules`, point balances, member/activity score history, super-admin scoring-rules settings, empty states.
5. **Operations** — attendance/scores reports (period-filtered), audit log, notification composer with per-role targeting (SMS provider stub — never actually sent), birthday list with greeting reminders, member/service management, admin reset-password per user.
6. **Account & access hardening** — see below.

## Access & account hardening (Phase 6)

- **Privileged provisioning only** — `Super Admin → Users → إضافة حساب ذو صلاحية`: creates an ADMIN/SUPER_ADMIN auth user + profile + audit entry in a single server-side operation (never trusts a browser role/user id, never weakens RLS).
- **RLS hardening** — triggers on `profiles` raise `42501` whenever a user edits their own `role`/`status` (or other protected fields) while the server-side privileged operations run under the service role, keeping admission/attendance boundaries live.
- **Auditing** — every privileged action writes `audit_logs`; the actor identity comes from the verified auth session, never from request payloads. Passwords are never logged or stored in plaintext.
- **Password recovery (designed)** — email-only self-recovery; forgot-password returns one generic message for both email and phone (no account enumeration). The recovery link lands on `/auth/callback` (tokens arrive in the URL fragment, which server routes cannot read), the browser client posts them to `/api/auth/set-session`, and the user is taken to `/reset-password`. Admin-initiated reset (`admin.auth.admin.updateUserById`) is the universal path for phone-only accounts.
- **Route protection** — `src/proxy.ts` enforces login and role segments; public prefixes are `/login`, `/register`, `/forgot-password`, `/reset-password`, `/auth/callback`. Authenticated users visiting the recovery pages are allowed through so a fresh recovery session can finish.
- **Honest dashboards** — admin/super-admin homes show real aggregates (active members, today's attendance, upcoming birthdays, latest activity) and empty-state messages; no placeholder copy.

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Start the local Supabase stack

Local ports are custom so they don't clash with other projects: API `55321`, DB `55322`, Studio `55323`, Mailpit `55324`, analytics `55327`.

```bash
supabase start        # apply migrations + seed config (no demo data)
supabase status       # print the API URL and auth keys
```

`supabase db reset` recreates the local database from migrations. It moves containers onto new IPs, so re-point the local gateway afterwards or auth calls will 502:

```bash
docker restart supabase_kong_Attendance-Tool
```

Note: `supabase migration list`/`db push` can fail against a local-only stack (no project ref); migrate by applying the SQL inside a container instead:

```bash
docker exec -i supabase_db_Attendance-Tool psql -U postgres -d postgres < supabase/migrations/<file>.sql
```

### 3. Configure environment

Copy the required keys from `supabase status` into `.env.local` (see `.env.example`):

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
```

The auth config enables phone-based password sign-in locally via a placeholder Twilio provider — no SMS is ever sent (users are created by the admin API and OTP flows are unused). `supabase/config.toml` already whitelists `http://localhost:3000`, `http://127.0.0.1:3000`, and `https://127.0.0.1:3000` as redirect URLs for the recovery email link.

### 4. Run the app

```bash
npm run dev
```

In development the recovery link must be opened on the same host the app runs on (localhost is used by the E2E helpers; `next.config.ts` whitelists both `localhost` and `127.0.0.1` as dev origins).

## Testing

End-to-end tests live in `e2e/` (`phase2`, `manual-crud`, `phase3` attendance, `phase4-scores`, `phase5/5b/5c` notifications + birthdays + reports/settings, `phase6-account-access`). A dev server and the Supabase stack are expected to be running.

```bash
npx playwright test              # full suite
npx playwright test e2e/phase6-account-access.spec.ts
node scripts/clean-test-data.mjs # wipe test data and verify the DB baseline
```

`scripts/clean-test-data.mjs` asserts the baseline: exactly the 5 seeded users (`+201000000031`…`+201000000035`), the 12 seeded `scoring_rules`, and zero rows in every data table (audit, attendance, scores, notifications, reminders). The E2E helpers (`e2e/helpers.ts`) share phone generation, seeding, login/logout, and per-suite cleanup so no flow leaves records behind.

## Useful scripts

```bash
npm run dev        # start the dev server
npm run build      # production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```