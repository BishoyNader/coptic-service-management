import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { getCopticCalendarDay, getUpcomingFeasts } from "@/services/coptic-calendar-service"
import { cairoDateString } from "@/lib/cairo"
import { ChurchPageClient } from "@/components/app/church-page-client"
import { getChurchSettingsAction } from "@/app/actions/church-settings"

export const metadata: Metadata = { title: "عن الخدمة" }

export default async function ChurchInfoPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile) redirect("/")

  const isAdmin = profile.role === ROLES.SUPER_ADMIN

  const admin = createAdminClient()
  const today = cairoDateString(new Date())

  const [settingsResult, calendarResult, feastsResult, counts] = await Promise.all([
    getChurchSettingsAction(),
    getCopticCalendarDay(undefined, today),
    getUpcomingFeasts(14),
    Promise.all([
      admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "SERVED_MEMBER")
        .eq("status", "ACTIVE"),
      admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "SERVANT")
        .eq("status", "ACTIVE"),
    ]),
  ])

  const settings = settingsResult.ok ? settingsResult.settings : null
  const memberCount = counts[0].count ?? 0
  const servantCount = counts[1].count ?? 0

  return (
    <ChurchPageClient
      settings={settings}
      calendarResult={calendarResult}
      feastsResult={feastsResult}
      memberCount={memberCount}
      servantCount={servantCount}
      isAdmin={isAdmin}
    />
  )
}
