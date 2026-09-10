import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { ClipboardList } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { formatArabicDate } from "@/lib/dates"
import { cairoDateString } from "@/lib/cairo"
import { EmptyState } from "@/components/coptic/empty-state"
import { ServantActivityPanel } from "@/components/app/servant-activity-panel"

export const metadata: Metadata = { title: "الأنشطة" }

export default async function ServantActivitiesPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVANT) redirect("/")

  const todayInstant = new Date()
  const cairoToday = cairoDateString(todayInstant)
  const minDate = cairoDateString(new Date(todayInstant.getTime() - 90 * 86_400_000))

  const [{ data: activitiesData }, { data: recordsData }] = await Promise.all([
    supabase
      .from("activities")
      .select("id, name, icon, sort_order")
      .eq("for_role", ROLES.SERVANT)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("servant_activity_records")
      .select("id, recorded_on, activity_id, activity:activities(name, icon)")
      .eq("servant_id", profile.id)
      .order("recorded_on", { ascending: false })
      .limit(1000),
  ])

  const activities = (activitiesData ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    icon: (a.icon as string | null) ?? null,
  }))

  const history = (recordsData ?? []).map((r) => ({
    id: r.id as string,
    activityId: r.activity_id as string,
    recordedOn: r.recorded_on as string,
    activityName: ((r as { activity?: { name?: string | null } | null }).activity?.name ??
      "نشاط") as string,
  }))

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-heading text-xl font-extrabold">الأنشطة</h1>
        <p className="text-sm text-muted-foreground">
          سجّل مشاركتك في كل نشاط خدمة شاركت فيه — الضغط مرة تانية يلغي تسجيل اليوم
        </p>
      </div>

      {activities.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-7" />}
          title="مفيش أنشطة متاحة"
          description="مفيش أنشطة خدمة متاحة للتسجيل دلوقتي"
        />
      ) : (
        <ServantActivityPanel
          activities={activities}
          history={history}
          cairoToday={cairoToday}
          minDate={minDate}
        />
      )}

      {history.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-heading text-sm font-bold text-muted-foreground">
            سجل المشاركات السابقة
          </h2>
          <div className="space-y-2">
            {history.slice(0, 50).map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5"
              >
                <div className="flex size-11 items-center justify-center rounded-xl bg-coptic-teal/10 text-coptic-teal">
                  <ClipboardList className="size-5" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">{a.activityName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatArabicDate(a.recordedOn)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}