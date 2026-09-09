import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { listScoringRulesForSettings } from "@/services/settings-service"
import { ScoringRulesSettings } from "@/components/app/scoring-rules-settings"

export const metadata: Metadata = { title: "الإعدادات" }

export default async function SuperAdminSettingsPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const rules = await listScoringRulesForSettings(createAdminClient())

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-xl font-extrabold">الإعدادات</h1>
        <p className="text-sm text-muted-foreground">
          قواعد الدرجات — مسؤول عام فقط
        </p>
      </div>

      <ScoringRulesSettings rules={rules} />
    </div>
  )
}
