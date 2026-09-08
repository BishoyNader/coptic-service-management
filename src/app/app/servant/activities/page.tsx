import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { ClipboardList } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { formatArabicDate } from "@/lib/dates"
import { EmptyState } from "@/components/coptic/empty-state"

export const metadata: Metadata = { title: "الأنشطة" }

export default async function ServantActivitiesPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVANT) redirect("/")

  const { data } = await supabase
    .from("servant_activity_records")
    .select("id, recorded_on, activity:activities(name, icon)")
    .eq("servant_id", profile.id)
    .order("recorded_on", { ascending: false })
    .limit(50)

  const activities = (data ?? []) as unknown as {
    id: string
    recorded_on: string
    activity: { name: string; icon: string | null } | null
  }[]

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-xl font-extrabold">الأنشطة</h1>

      {activities.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-7" />}
          title="مفيش أنشطة مسجلة"
          description="لما تشارك في نشاط خدمة، هيظهر هنا"
        />
      ) : (
        <div className="space-y-2">
          {activities.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5"
            >
              <div className="flex size-11 items-center justify-center rounded-xl bg-coptic-teal/10 text-coptic-teal">
                <ClipboardList className="size-5" />
              </div>
              <div className="flex-1">
                <p className="font-medium">{a.activity?.name ?? "نشاط"}</p>
                <p className="text-[11px] text-muted-foreground">
                  {formatArabicDate(a.recorded_on)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
