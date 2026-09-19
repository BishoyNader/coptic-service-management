import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { listScoringRulesForSettings } from "@/services/settings-service"
import { SettingsPageContent } from "@/components/app/settings-page-content"

export const metadata: Metadata = { title: "الإعدادات" }

export default async function SuperAdminSettingsPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const admin = createAdminClient()
  const rules = await listScoringRulesForSettings(admin)

  return <SettingsPageContent rules={rules} />
}
