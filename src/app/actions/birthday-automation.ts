"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminRole } from "@/lib/roles"
import { runBirthdayAutomation, type BirthdayAutomationResult } from "@/services/birthday-automation"

export type RunBirthdayAutomationResult =
  | { ok: true; result: BirthdayAutomationResult }
  | { ok: false; message: string }

/**
 * Admin / Super Admin: manually run the birthday automation for today.
 * Used for local development and testing.
 */
export async function runBirthdayAutomationAction(): Promise<RunBirthdayAutomationResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: "غير مصرح" }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile || !isAdminRole(profile.role)) {
    return { ok: false, message: "غير مصرح" }
  }

  const admin = createAdminClient()
  const result = await runBirthdayAutomation(admin, {
    senderId: user.id,
  })

  return { ok: true, result }
}
