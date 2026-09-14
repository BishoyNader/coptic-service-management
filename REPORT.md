# PHASE 13 — Confirmed Birthday Product Requirements — Final Report

Date: 2026-09-14 · Stack: Next.js 16.3.4 / React 19.2.8 / TypeScript / Tailwind v4 / Supabase (Postgres 17, local) · e2e: Playwright

Nothing was committed. All work ships uncommitted as one reviewable changeset (see "Changed files").

---

## 1. Role-based date-of-birth (DOB) entry

| Role | Can enter/edit their own DOB | Can edit others' DOB |
|---|---|---|
| SERVED_MEMBER (مخدوم) | ✅ own account page (`/app/member/account`, field `تاريخ الميلاد`) | ❌ RLS + server rejection |
| SERVANT (خادم) | ✅ own account page (`/app/servant/account`) | ✅ only `date_of_birth` of any **ACTIVE SERVED_MEMBER**, via `/app/servant/members` |
| ADMIN (أمين خدمة) | ✅ (profile form) | ✅ full profile via super-admin/admin member-management (unchanged, out of scope) |
| SUPER_ADMIN (أمين عام) | ✅ (profile form) | ✅ full profile via `/app/super-admin/members` (unchanged, out of scope) |

Servant-managed entry is implemented as:

- `src/services/profile-service.ts` → `updateServantManagedDob()` — server-side authorization: caller must be `SERVANT`; target must exist, be `SERVED_MEMBER`, `ACTIVE`. **Only `date_of_birth` is ever written.** Uses a service-role client (RLS bypass) while all checks are enforced in the service.
- `src/app/actions/profile.ts` → `servantUpdateMemberDobAction()` — server action resolving the caller from the session cookie (never trusts a client-supplied role), validates UUID, re-runs the service, writes an audit log (`PROFILE_UPDATED`, scope `SERVANT_MANAGED_DOB`).
- `src/app/app/servant/members/page.tsx` + `src/components/app/servant-member-dob-list.tsx` — ACTIVE SERVED_MEMBER rows (name + DOB only, **no phone / QR / address leaked**), inline date editor that calls the action.

Error strings (tested): `غير مصرح`, `المخدوم غير موجود`, `يمكن تحديث تاريخ ميلاد المخدومين فقط`, `الحساب غير نشط`, `تاريخ الميلاد لا يمكن أن يكون في المستقبل`.

## 2. Personal birthday notifications

- Annual notification on each user's birthday via `runBirthdayAutomation()` (invoked by cron route or the admin "run automation" buttons).
- Eligibility: ACTIVE profiles with role **SERVANT or SERVED_MEMBER** and a non-null DOB whose month/day matches the Cairo target date (Feb-29 → Feb-28 in non-leap years).
- One notification per recipient: title `🎂 عيد ميلاد سعيد!`, body `كل سنة وإنت طيب يا {name} ❤️`, `audience = [rawRole]` (per-subject role resolution), attributed to the configured sender.
- Strict dedup: `birthday_reminders(profile_id, reminder_for)` unique row; re-running the same day creates zero duplicates and rolls back on any partial write.
- Stored/toast style preserved from prior phases (requirement allowed preserving existing notification style).

## 3. Servant-only upcoming-30-day birthday lists

- New route `/app/servant/birthdays` (servant-only; non-servants are redirected by both middleware and the page guard).
- UI (`src/components/app/servant-birthday-board.tsx`): **two independent, clearly separated lists** via tabs `الخدام` / `المخدومين`, each restricted to ACTIVE profiles with a DOB within the next **30 Cairo calendar days**.
- Rows show name + day count (`عيد ميلاده النهاردة 🎉` when 0, otherwise `بعد N يوم`) + the DOB (+ `✓ تم إرسال التهنئة` if already reminded). There is **no send-greeting control** — servants cannot send greetings.
- Independent empty states: `لا توجد أعياد قريبة للخدام` and `لا توجد أعياد قريبة للمخدومين`.
- Admin & super-admin 30-day pages are unchanged: still SERVED_MEMBER-only (Phase 12 test asserts this) and expose the "run automation" button; administratively unchanged.

## 4. Authorization enforcement (defense in depth)

| Layer | Behavior |
|---|---|
| Route layout/guard | `page redirect("/")` if `role !== SERVANT` on servant pages |
| Middleware (proxy) | `/app/{servant,…}` role-segment enforcement before React runs |
| Server action | resolves caller from session, checks `ROLES.SERVANT`, UUID-validates target |
| Service | role + target role/status + DOB-validity checks before the write |
| RLS | `profiles_select_servant_scope` (read scope) + `profiles_update_own_or_admin` (direct writes to other rows silently dropped) |
| DB | CHECK `profiles_date_of_birth_not_future` rejects future DOB at the storage layer |

A served member (or any non-servant) reaching the servant birthdays route is bounced to `/app/member`; even if data-layer reached, RLS limits reads to the invoker's own row (verified by test).

## 5. RLS scope verification (runtime)

- Direct client `UPDATE profiles SET date_of_birth=…` by a SERVANT against another row → **no-op** (RLS drops), row untouched.
- Same by SERVED_MEMBER → no-op.
- `notification_recipients` read by a non-recipient → 0 rows (recipient-based RLS).
- `birthdays_for_today()` EXECUTE granted to **service_role only** (ACL audited in DB: `{postgres=X/postgres, service_role=X/postgres}`); anon/authenticated cannot call it.
- `SECURITY DEFINER` + `set search_path to 'public'` on the function.

## 6. Data & storage safety

- DOB stored as `YYYY-MM-DD`, never shifted across the Africa/Cairo boundary (test proves `1992-12-31` round-trips and a UTC-midnight parse would not).
- Clearing the field sets `NULL` and safely excludes the profile from automation + lists.
- Registration API still accepts DOB at sign-up; public registration creates only SERVED_MEMBER / SERVANT (unchanged).

## 7. Servant ↔ member assignment model (known gap, documented)

There is **no servant→served-member assignment table**. Per the confirmed role-scoped model, a SERVANT may manage the DOB of **any** ACTIVE SERVED_MEMBER. If the product later requires per-assignment authorization, add an `assignments` table and extend `updateServantManagedDob` (recommended future work).

## 8. Audit trail

Every servant-managed DOB write creates an audit log via the existing `audit_logs` table (actor, action `PROFILE_UPDATED`, entity `PROFILE`, metadata scope `SERVANT_MANAGED_DOB`); visible on the super-admin audit page (unchanged).

## 9. Branding change

- Old: `كنيسة القديسين للخدمات` → New: **`كنيسة السيدة العذراء وأي حوف`** (APP_TAGLINE).
- Sources: `src/lib/constants.ts` (single source of truth), `src/app/(auth)/layout.tsx` header, `src/app/layout.tsx` metadata (title/description), `src/components/coptic/brand.tsx` subtitle.
- Verified: grep for the old name across the repo → 0 matches; `/login` and `/register` render the new name.
- **Intentionally unchanged:** `APP_NAME` = `خدمتي`, role labels (`مسؤول خدمة`/`مسؤول عام`), and the BrandMark title `كنيسة الخدمة` (BrandMark component is unused in the app; marked out of scope).

## 10. Migration & DB state

- `supabase/migrations/20260917000000_servant_birthday_automation.sql` (uncommitted, from prior Phase 12 fix) — widens `birthdays_for_today()` to SERVANT+SERVED_MEMBER and re-asserts service-role-only EXECUTE. Verified applied (`schema_migrations` + function def audit).
- **No new migration was required** for Phase 13: the existing RLS rules, the DOB-not-future CHECK, and the prior function/grants already cover the boundaries.

## 11–13. Verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ clean |
| `npm run lint` | ✅ 0 errors, 1 pre-existing warning (`member-scores.tsx`: unused `SCORE_CATEGORY_ICONS`, unrelated) |
| `npm run build` | ✅ production build succeeds, all routes emit |
| Playwright e2e (full suite, single worker, locale ar-EG) | ✅ **272/272 passed (4.3m)**, including 23 new Phase 13 tests and the prior Phase 12 servant-birthday tests |

New regression spec: `e2e/phase13-confirmed-birthday-tool.spec.ts` — 23 serial tests mapping §1–§9:

- DOB entry (servant self, member self, servant-managed member), unauthorized targets, future-DOB rejection (service + DB backstop), date-only round-trip, cleared-DOB safety.
- Automation: recipient title/body/audience/sender, dedup rows, idempotent re-run, inbox delivery, RLS isolation, **ADMIN & SUPER_ADMIN excluded** as recipients.
- Lists: separation/no-mixing, member access blocked (middleware + page + RLS), ACTIVE-only, 30-day boundary (day 0, day 30 included; day 31 excluded), today copy, Dec→Jan rollover + Feb-29 leap/non-leap, ascending sort, independent empty states, server-rendered.
- Branding: `/login`+`/register`, source constants + brand file, `APP_NAME`/role-label stability.

## 14–18. Behavior matrix & risks

- **ADMIN / SUPER_ADMIN**: excluded from automatic birthday notifications (seed users with today-DOB proved never to be recipients or `birthdays_for_today` rows); their existing 30-day boards remain SERVED_MEMBER-only by design.
- **Access-Control matrices** (roles × actions) are implemented and regression-locked by the spec above.
- **Remaining risks:** (1) no assignment-level servant scoping (§7); (2) e2e boundary tests (day 29/30/31, Feb-29) are date-dependent and would need re-seeding if a test run straddles the Cairo midnight; (3) the exported CSV/auth-secret absence checks live in Phase 8 tests (unchanged, still green).
- **Deliverables:** feature implementation, DB audit, full green verification, and this report — uncommitted per instruction.

## Changed files

```
M src/app/(auth)/layout.tsx            M src/app/actions/profile.ts
M src/app/layout.tsx                   M src/components/coptic/brand.tsx
M src/lib/constants.ts                 M src/services/birthday-automation.ts   (prior Phase 12)
M src/services/birthday-service.ts     M src/services/profile-service.ts
?? src/app/app/servant/birthdays/page.tsx
?? src/app/app/servant/members/page.tsx
?? src/components/app/servant-birthday-board.tsx
?? src/components/app/servant-member-dob-list.tsx
?? e2e/phase12-servant-birthdays.spec.ts   (prior Phase 12)
?? e2e/phase13-confirmed-birthday-tool.spec.ts
?? supabase/migrations/20260917000000_servant_birthday_automation.sql  (prior Phase 12)
```