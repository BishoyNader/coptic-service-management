# FINAL REPORT — Friday-Based Attendance & Scoring Model (Phases 5–18)

Date: 2026-09-16 · Stack: Next.js 16.3.4 / React 19.2.8 / TypeScript / Tailwind v4 / Supabase (Postgres 17, local) · e2e: Playwright

Nothing was committed or pushed. All work ships uncommitted as one reviewable changeset (see "Changes").

---

## 1. Git recovery
- Branch `main`, HEAD `e2120593d3c205a98557e1882c4ec856f7233152` "add" (2026-09-15).
- Local == `origin/main`; working tree had **uncommitted** fixes on top (deployment fix + audit) plus this session's new work.
- Low-level verification: `git fetch` clean, no drift. Recovering to the pushed state proved correct: the committed HEAD alone does **not** compile (it carries the build error below), so the recovery point is `origin/main` + the pre-existing uncommitted fix.

## 2. Deployment error (root cause)
- `npm run build` failed with `TS2304 Cannot find name 'cairoDateString'` and `Cannot find name 'today'` in `src/components/app/servant-child-records.tsx` (lines 54, 206–207).
- Cause: an earlier incomplete edit renamed `cairoToday → lastFriday` (and added `isCairoFriday`/`mostRecentCairoFriday` imports) but **missed** importing `cairoDateString` and missed two stale `today` references in `max=` / `onChange` of the date input.
- Fix (in working tree): import `cairoDateString`; `max={lastFriday}`; `onChange={(e) => setDate(e.target.value || lastFriday)}`.

## 3. Previous work (audit of the interrupted agent)
- Full schema/migration audit (16 migrations), attendance engine, scoring engine, member-scoring-service, servant activities hub, role/RLS model — all preserved.
- Confirmed the Friday-only DB constraint (`20260921000000_attendance_friday_only.sql`) and Saturday-anchored weekly model (`WEEK_START_DAY = 6`).
- Created `src/lib/friday.ts` (schedule module) and a first draft of `src/services/friday-service.ts`.

## 4. Remaining work completed
- Cleaned `friday-service.ts`: removed N+1 servant-activities query (now queried once), removed dead `activityNames`/`void`, added per-Friday window filters, verified `SCORE_CATEGORY_ICONS`/`addDaysDate` imports compile.
- New `src/app/actions/friday.ts` (role-gated server actions), three client components, page wiring, member tab, board snap, lint fix, validator script, e2e spec. All verified (section 11).
- **Made `phase15` deterministic** (previously time-dependent): replaced "record attendance today" steps with a fixed ministry Friday + fixed non-Friday, added serial mode (prevents mid-file reseed cascade after a failure), scoped board assertions to the single created activity, and assertion hardening.
- **Fixed a real product bug — PostgREST embedded-resource date filter leak:** filtering `attendance_records` by `.eq("session.session_date", …)` used a LEFT JOIN, so records from **other** dates were returned with `session: null` (the component substituted type `CHURCH`). A child day-view for a non-Friday could show Friday attendance. Fixed everywhere by forcing `session:attendance_sessions!inner(…)`, which excludes non-matching rows (verified empirically).
- **Hardened `servant-child-records`** against out-of-order loads: a request-sequence guard drops stale responses so a slower previous-date/member response cannot overwrite the selected view.
- Removed all temporary `[DEBUG …]` instrumentation from front-end/backend and the e2e spec; deleted the throwaway isolation spec.

## 5. Changes
Modified:
- `src/components/app/servant-child-records.tsx` — deployment fix + Friday hint (uses `isFriday`) + stale-response seq guard.
- `src/app/app/servant/attendance/page.tsx`, `src/app/app/admin/attendance/page.tsx`, `src/app/app/super-admin/attendance/page.tsx` — Friday dashboard section.
- `src/app/app/member/scores/page.tsx` + `src/components/app/member-scores.tsx` — new "درجات الجمعة" tab.
- `src/components/app/servant-scoring-board.tsx` — additive Friday snap on history pick; default/editing semantics unchanged.
- `src/app/actions/attendance.ts`, `src/app/actions/children.ts`, `src/services/member-scoring-service.ts`, `src/services/servant-day-service.ts` — `session:attendance_sessions!inner(…)` (PostgREST date-filter leak fix).
- `src/app/app/servant/attendance/page.tsx` — same `!inner` fix on its inline board-rows query.

Added:
- `src/lib/friday.ts` — `MINISTRY_FRIDAY_START="2026-09-18"`, `MINISTRY_FRIDAY_END="2027-09-24"`, `fridaySchedule()`, `isMinistryFriday()`, `lastFridayOnOrBefore()`, `ministryFridayIndex/At()`, `next/previousMinistryFriday()`, `currentMinistryFriday()`, `fridayArabicLabel()`, `addDaysDate()`.
- `src/services/friday-service.ts` — `getFridayAttendanceGrid()`, `getMemberFridayView()`, `getFridayMinistryData()` + types.
- `src/app/actions/friday.ts` — `getFridayAttendanceGridAction`, `getFridayMinistryDataAction`, `getMemberFridayResultsAction`.
- `src/components/app/friday-dashboard.tsx`, `friday-attendance-grid.tsx`, `friday-ministry-view.tsx`, `member-friday-results.tsx`.
- `scripts/validate-friday-schedule.mjs`, `e2e/phase17-friday-model.spec.ts`.

## 6. Access-level matrix (new Friday surfaces)
| Role | Grid/ministry actions | Member Friday results | Can see others' data | Ranking |
|---|---|---|---|---|
| SERVED_MEMBER | ❌ (action + page gate) | ✅ own rows only (resolved from session) | ❌ | ❌ |
| SERVANT | ✅ | — | ✅ all ACTIVE ministers (no ownership restriction, matches board) | ❌ |
| ADMIN | ✅ | — | ✅ | ❌ |
| SUPER_ADMIN | ✅ | — | ✅ | ❌ |
| Anonymous | ❌ (redirect) | ❌ | — | — |

Every action re-validates: logged-in profile role, real calendar date, actually-Friday, not future. Member view keys strictly to the caller's own `profile_id`; no cross-member read path exists.

## 7. Friday schedule (confirmed)
- Verified by `node scripts/validate-friday-schedule.mjs`: **exactly 54 Fridays**, first `2026-09-18`, last `2027-09-24`, all real Fridays with strict 7-day gaps; snap samples agree with `lastFridayOnOrBefore`.
- Attribution rule implemented everywhere: weekly-card/score/attendance rows bucket to `lastFridayOnOrBefore(rowDate)`; attendance rows sit exactly on Fridays (DB-enforced ISO-DOW=5 CHECK). Pre-year rows (e.g. the 2026-09-11 test Friday) bucket to `""` and are excluded from every Friday view and the yearly total, keeping member/ministry totals in sync.

## 8. Scoring model
- Without numerical servant scores. Servants: حضور/غائب + activities نعم/لا. Served members: per-activity percentage.
- `percent = points / max`; attendance categories use max active rule value; `WEEKLY_COMMITMENT`/`SERVICE_COMMITMENT` max = 10; `TUNIC`/`COMMUNION`/`BONUS` = rule value; graded activities use `max_score`. Unscored activities show 0% (never hidden).
- Member yearly total = points over (54 × per-Friday achievable max).

## 9. Attendance model
- Columns in the grid/ministry views are **ministry Fridays**, never civil days. Absence = absence of an `attendance_record` → explicit غائب chip. A missing score is never treated as absence.

## 10. Security
- Existing auth/RLS preserved. New reads use the admin client only inside role-gated pages/actions; member reads keyed to session id; services re-validate target roles/status. No secrets introduced; nothing logged.

## 11. Tests
- `npm run typecheck` ✅ · `npm run lint` ✅ (0 errors/warnings) · `npm run build` ✅ (routes incl. all wired pages).
- `node scripts/validate-friday-schedule.mjs` ✅ (54 Fridays).
- `e2e/phase17-friday-model.spec.ts` ✅ **4/4** — attendance grid حضور/غائب, ministry review (servant combined Friday review incl. weekly-card scoring), member own-results tab (no ranking), unauthenticated redirect, no member→others exposure. Graded-percentage assertions are explicitly deferred (visible `[phase17]` console warning) until the ministry year reaches a Friday ≤ DB `current_date` — the DB has no future-safe leaderboard buckets; attendance assertions always run, so no test silently skips.
- `e2e/phase15-scoring-board-activities.spec.ts` ✅ **13/13** (deterministic dates — previously time-dependent "today"-attendance tests now pin a ministry Friday/non-Friday, so they pass on any real date; serial mode).
- `e2e/phase16-servant-scoring-auth.spec.ts` ✅ **32/32**.
- Full regression sweep (this session's re-run, excludes manual-crud/phase14-time-readonly): **49 passed, 0 failed**; zero `[DEBUG …]` lines in the server log during the final Phase 15 run.

## 12. Remaining issues
- Graded-activity % assertions in `phase17` stay deferred (with an explicit warning) until the ministry year opens relative to DB `current_date`; the Friday-model engine itself is fully tested via the weekly-card path today.
- No package-script/CI hook invokes `scripts/validate-friday-schedule.mjs` yet.
- `SCORE_CATEGORY_ICONS` is exported from `scoring-rules.ts` (compiles) but remains a server-side icon-name source; UI maps icon names independently (pre-existing).
- Dates are hard-coded to the ministry year; a future ministry year needs its bounds updated in `src/lib/friday.ts`.
- `src/app/actions/children.ts` and `src/app/actions/attendance.ts` retain pre-existing informational `console.log` service logs (unchanged from before this work).

## 13. Deployment readiness
- `next build`, typecheck, lint all green on the recovered base. The original deployment-blocking TS errors are fixed. No commit/push performed per instructions; deploy the working tree as one changeset.
- Full E2E: Phase 15 **13/13**, Phase 16 **32/32**, Phase 17 **4/4** — all green on a clean local Supabase with scheduled Friday seeding. The `!inner` embedded-filter fix closes a genuine cross-date attendance leak and is included in the changeset.