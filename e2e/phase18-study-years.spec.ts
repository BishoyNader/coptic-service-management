import { test, expect } from "@playwright/test";
import {
  cleanupPhones,
  createSeedAdmin,
  createSupabaseAdmin,
  login,
} from "./helpers";

// Dedicated phone set for this phase (no overlap with other suites).
const SUPER_PHONE = "+201000000188";
const SUPER_PASSWORD = "Phase18Super9!";

// Seeded by migration 20260922000000_study_years.sql.
const SEED_NAME = "2026/2027";
const SEED_START = "2026-09-18";
const SEED_END = "2027-09-24";

// Create-form target, disjoined from the seeded year's date range.
const NEW_NAME = "2028/2029";
const NEW_START = "2028-09-22";
const NEW_END = "2029-09-28";

// Independent Friday oracle (never mirrors the app's derivation).
function countFridays(start: string, end: string): number {
  const cursor = new Date(`${start}T12:00:00Z`);
  const stop = new Date(`${end}T12:00:00Z`);
  let count = 0;
  while (cursor <= stop) {
    if (cursor.getUTCDay() === 5) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

const SEED_FRIDAYS = countFridays(SEED_START, SEED_END);
const NEW_FRIDAYS = countFridays(NEW_START, NEW_END);

let actorId = "";
let seedYearId = "";

test.beforeAll(async () => {
  const admin = createSupabaseAdmin();
  await cleanupPhones(admin, [SUPER_PHONE]);

  const { userId } = await createSeedAdmin(
    admin,
    "SUPER_ADMIN",
    SUPER_PHONE,
    SUPER_PASSWORD,
  );
  actorId = userId;

  // The page asserts on the migration-seeded year; require it so a missing
  // migration fails loudly instead of a confusing "row not visible".
  const { data: seed } = await admin
    .from("study_years")
    .select("id")
    .eq("name", SEED_NAME)
    .maybeSingle();
  if (!seed)
    throw new Error(
      `seeded "${SEED_NAME}" study year missing (run migrations)`,
    );
  seedYearId = seed.id as string;

  // Deterministic start: drop leftovers of this suite and restore the single
  // active year to the canonical seed (in case an interrupted run left it off).
  await admin.from("study_years").delete().eq("name", NEW_NAME);
  await admin.rpc("set_active_study_year", { p_study_year_id: seedYearId });
});

test.afterAll(async () => {
  if (process.env.KEEP_PHASE18_DATA === "1") return;
  const admin = createSupabaseAdmin();

  await admin.from("audit_logs").delete().eq("actor_id", actorId);

  if (seedYearId) {
    await admin.rpc("set_active_study_year", { p_study_year_id: seedYearId });
  }
  await admin.from("study_years").delete().eq("name", NEW_NAME);

  await cleanupPhones(admin, [SUPER_PHONE]);
});

test("Super admin sees the seeded 2026/2027 study year listed active with 54 Fridays", async ({
  page,
}) => {
  await login(page, SUPER_PHONE, SUPER_PASSWORD);
  await page.goto("/app/super-admin/study-years");

  const row = page.getByTestId(`study-year-row-${SEED_NAME}`);
  await expect(row).toBeVisible();
  await expect(row.getByText(SEED_START)).toBeVisible();
  await expect(row.getByText(SEED_END)).toBeVisible();
  await expect(
    row.getByText(`${SEED_FRIDAYS} جمعة`, { exact: true }),
  ).toBeVisible();
  await expect(row.getByTestId(`active-badge-${SEED_NAME}`)).toBeVisible();

  // An active row exposes the deactivate action; the seed is the only active year.
  await expect(
    page.getByTestId("study-years-list").getByText("مفعّل"),
  ).toHaveCount(1);
});

test("Super admin creates the 2028/2029 study year which appears with 54 Fridays", async ({
  page,
}) => {
  await login(page, SUPER_PHONE, SUPER_PASSWORD);
  await page.goto("/app/super-admin/study-years");

  await page.getByLabel("اسم عام الخدمة").fill(NEW_NAME);
  await page.getByLabel("بداية عام الخدمة").fill(NEW_START);
  await page.getByLabel("نهاية عام الخدمة").fill(NEW_END);

  // The live Friday-schedule preview is derived from the entered range.
  const preview = page.getByTestId("create-year-preview");
  await expect(preview).toContainText(`${NEW_FRIDAYS} جمعة`);

  await page.getByRole("button", { name: "إضافة عام الخدمة" }).click();

  const row = page.getByTestId(`study-year-row-${NEW_NAME}`);
  await expect(row).toBeVisible();
  await expect(row.getByText(NEW_START)).toBeVisible();
  await expect(row.getByText(NEW_END)).toBeVisible();
  await expect(
    row.getByText(`${NEW_FRIDAYS} جمعة`, { exact: true }),
  ).toBeVisible();

  // A newly created year is inactive; the seed stays the only active year.
  await expect(row.getByTestId(`active-badge-${NEW_NAME}`)).toHaveCount(0);
  await expect(row.getByTestId(`activate-${NEW_NAME}`)).toBeVisible();
  await expect(
    page.getByTestId("study-years-list").getByText("مفعّل"),
  ).toHaveCount(1);
});

test("Super admin deactivates then reactivates the 2028/2029 study year", async ({
  page,
}) => {
  await login(page, SUPER_PHONE, SUPER_PASSWORD);
  await page.goto("/app/super-admin/study-years");

  const row = page.getByTestId(`study-year-row-${NEW_NAME}`);
  await expect(row).toBeVisible();
  const seedRow = page.getByTestId(`study-year-row-${SEED_NAME}`);
  await expect(seedRow).toBeVisible();

  // Activate the new year -> the seed loses the active badge (single-active rule).
  await row.getByTestId(`activate-${NEW_NAME}`).click();
  await expect(row.getByTestId(`active-badge-${NEW_NAME}`)).toBeVisible();
  await expect(seedRow.getByTestId(`active-badge-${SEED_NAME}`)).toHaveCount(0);
  await expect(
    page.getByTestId("study-years-list").getByText("مفعّل"),
  ).toHaveCount(1);

  // Deactivate it -> no active year remains.
  await row.getByTestId(`deactivate-${NEW_NAME}`).click();
  await expect(row.getByTestId(`active-badge-${NEW_NAME}`)).toHaveCount(0);
  await expect(
    page.getByTestId("study-years-list").getByText("مفعّل"),
  ).toHaveCount(0);

  // Re-activate it.
  await row.getByTestId(`activate-${NEW_NAME}`).click();
  await expect(row.getByTestId(`active-badge-${NEW_NAME}`)).toBeVisible();
  await expect(
    page.getByTestId("study-years-list").getByText("مفعّل"),
  ).toHaveCount(1);
});
