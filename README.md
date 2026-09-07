# Attendance Tool — إدارة الخدمة

Coptic Orthodox Church service management web app. Arabic-first, RTL, mobile-first, with a full role-based dashboard for served members (مخدوم), servants (خدام), and church administration.

## Tech stack

- **Next.js 16** (App Router, React 19, TypeScript, `src/proxy.ts` for route protection)
- **Tailwind CSS v4** with a custom Coptic Orthodox design system (oklch palette, Cairo + Amiri fonts, lattice patterns)
- **shadcn/ui** (base-nova style) with Radix Base UI primitives
- **Supabase** (Postgres + Auth + PostgREST) with Row Level Security
- **qrcode.react** for the member QR codes

## Roles

| Role | Segments |
| --- | --- |
| `SERVED_MEMBER` | `/app/member/*` |
| `SERVANT` | `/app/servant/*` |
| `ADMIN` | `/app/admin/*` |
| `SUPER_ADMIN` | `/app/super-admin/*` |

Public registration is limited to served members and servants via `/register/member` and `/register/servant`. Admins are provisioned by church administrators.

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

### 3. Configure environment

Copy the required keys from `supabase status` into `.env.local` (see `.env.example`):

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
```

The auth config enables phone-based password sign-in locally via a placeholder Twilio provider — no SMS is ever sent (users are created by the admin API and OTP flows are unused).

### 4. Run the app

```bash
npm run dev
```

## Written for now (Phase 1 done)

- Public registration (hadar/servant), phone+password sign-in, session handling
- Personal 6-digit code + QR token minted per user (QR encodes only a random UUID)
- Role-based shell, dashboards, empty states for scores/notifications/attendance
- Supabase schema with RLS policies, audit logging, and seeded scoring rules

## Not built yet (Phase 2+)

- QR scanning and attendance recording for servants/admins
- Scoring entry and point balances
- Admin/super-admin management of members, servants, and roles
- Notifications (SMS/WhatsApp) and birthday reminders
- Reports and settings

## Useful scripts

```bash
npm run dev        # start the dev server
npm run build      # production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```