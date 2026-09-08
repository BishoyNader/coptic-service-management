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

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

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

const { data: sessions } = await admin.from("attendance_sessions").select("id, type, session_date")
console.log("attendance_sessions:", (sessions ?? []).length)
for (const s of sessions ?? []) {
  await admin.from("attendance_sessions").delete().eq("id", s.id)
}

const { count: auditCount } = await admin.from("audit_logs").select("id", { count: "exact" })
console.log("audit_logs to clean:", auditCount ?? 0)
if ((auditCount ?? 0) > 0) {
  await admin.from("audit_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000")
}

const { count } = await admin.from("profiles").select("id", { count: "exact" })
console.log("remaining profiles:", count)