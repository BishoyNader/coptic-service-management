import { createClient } from "@supabase/supabase-js"
import { config as loadEnv } from "dotenv"

loadEnv({ path: ".env.local" })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:55321"
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY not found in .env.local")

const REAL_PHONES = [
  "+201000000031",
  "+201000000032",
  "+201000000033",
  "+201000000034",
  "+201000000035",
]

const EMPTY_TABLES = [
  "notification_recipients",
  "notifications",
  "birthday_reminders",
  "servant_activity_records",
  "score_records",
  "attendance_records",
  "audit_logs",
  "attendance_sessions",
]

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}

// 1) Explicitly clear data tables that can accumulate even after profiles are
//    removed (orphans, cascades, transactional leftovers).
for (const table of EMPTY_TABLES) {
  const { error } = await admin.from(table).delete().neq(table === "attendance_sessions" ? "id" : "id", "00000000-0000-0000-0000-000000000000")
  if (error) fail(`clearing ${table}: ${error.message}`)
}

// 2) Delete every auth user whose profile is not one of the real baseline users.
const { data: profiles } = await admin
  .from("profiles")
  .select("id, phone, role, full_name")
  .order("full_name")

const testUsers = (profiles ?? []).filter((p) => !REAL_PHONES.includes(p.phone))

console.log("profiles:", (profiles ?? []).length, "| test users to remove:", testUsers.length)
for (const p of testUsers) {
  const { error } = await admin.auth.admin.deleteUser(p.id)
  console.log(error ? `  ERR ${p.phone} ${error.message}` : `  del ${p.full_name} (${p.phone})`)
}

// 3) Verify the baseline: exactly the real profiles and no accumulated data.
const { data: remainingProfiles } = await admin
  .from("profiles")
  .select("phone, role")
  .order("phone")

if ((remainingProfiles ?? []).length !== REAL_PHONES.length) {
  fail(
    `expected ${REAL_PHONES.length} profiles, got ${remainingProfiles?.length ?? 0}:\n` +
      (remainingProfiles ?? []).map((p) => `  ${p.phone} ${p.role}`).join("\n")
  )
}

for (const phone of REAL_PHONES) {
  if (!(remainingProfiles ?? []).some((p) => p.phone === phone)) {
    fail(`baseline profile missing: ${phone}`)
  }
}

const { count: apCount } = await admin
  .from("profiles")
  .select("id", { count: "exact" })

const { count: rulesCount } = await admin
  .from("scoring_rules")
  .select("id", { count: "exact" })

if (rulesCount !== 12) fail(`expected 12 scoring_rules, got ${rulesCount}`)

for (const table of EMPTY_TABLES) {
  const { count } = await admin.from(table).select("id", { count: "exact" })
  if ((count ?? 0) !== 0) fail(`table not empty after cleanup: ${table} (${count})`)
}

console.log(`OK baseline verified: ${apCount} profiles, ${rulesCount} scoring_rules, all data tables empty.`)