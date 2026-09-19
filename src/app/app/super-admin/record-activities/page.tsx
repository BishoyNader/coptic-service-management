import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { cairoDateString } from "@/lib/cairo"
import { getServerNow } from "@/services/attendance-service"
import { getServantDayData } from "@/services/servant-day-service"
import { getScoringBoardData } from "@/services/member-scoring-service"
import { ServantActivitiesHub, type HubServant } from "@/components/app/servant-activities-hub"

export const metadata: Metadata = { title: "نشاط الخدام" }

const SELF_HISTORY_DAYS = 14
const MIN_DATE_DAYS = 90

export default async function SuperAdminRecordActivitiesPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const admin = createAdminClient()
  const todayInstant = getServerNow()
  const cairoToday = cairoDateString(todayInstant)
  const minDate = cairoDateString(new Date(todayInstant.getTime() - MIN_DATE_DAYS * 86_400_000))
  const historySince = cairoDateString(
    new Date(todayInstant.getTime() - SELF_HISTORY_DAYS * 86_400_000)
  )

  const { data: servantProfiles } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("role", ROLES.SERVANT)
    .eq("status", "ACTIVE")
    .order("full_name", { ascending: true })

  const servants: HubServant[] = (servantProfiles ?? []).map((s) => ({
    id: s.id as string,
    fullName: (s.full_name as string) ?? "خادم",
  }))

  let initialServantId: string | null = null
  let initialServerDay: Awaited<ReturnType<typeof getServantDayData>> | null = null

  if (servants.length > 0) {
    initialServantId = servants[0].id
    initialServerDay = await getServantDayData(admin, servants[0].id, cairoToday, historySince)
  }

  const board = await getScoringBoardData(admin, cairoToday)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-heading text-xl font-extrabold">نشاط الخدام</h1>
        <p className="text-sm text-muted-foreground">
          سجّل أنشطة الخدام ودرجات المخدومين من مكان واحد
        </p>
      </div>

      <ServantActivitiesHub
        currentUserId={profile.id}
        isSuperAdmin={true}
        cairoToday={cairoToday}
        minDate={minDate}
        servants={servants}
        initialServantId={initialServantId}
        initialDay={initialServerDay}
        initialBoard={board}
      />
    </div>
  )
}
