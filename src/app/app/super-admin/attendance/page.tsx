import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { ScanLine } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { toDateString } from "@/lib/dates"
import { EmptyState } from "@/components/coptic/empty-state"

export const metadata: Metadata = { title: "الحضور" }

type RecordRow = {
  id: string
  attended_at: string
  points: number
  source: string
  profile: { full_name: string; role: string } | null
}

export default async function SuperAdminAttendancePage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const today = toDateString(new Date())

  const { data } = await supabase
    .from("attendance_records")
    .select("id, attended_at, points, source, profile:profiles(full_name, role)")
    .gte("attended_at", `${today}T00:00:00`)
    .lte("attended_at", `${today}T23:59:59`)
    .order("attended_at", { ascending: false })
    .limit(50)

  const records = (data ?? []) as unknown as RecordRow[]
  const count = records.length

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-xl font-extrabold">سجل الحضور</h1>
        <p className="text-sm text-muted-foreground">{count ?? 0} حضور النهارده</p>
      </div>

      {!records || records.length === 0 ? (
        <EmptyState
          icon={<ScanLine className="size-7" />}
          title="لا توجد سجلات حضور"
          description="سجلات الحضور هتظهر هنا بعد تفعيل الماسح الضوئي"
        />
      ) : (
        <div className="space-y-2">
          {records.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5"
            >
              <div>
                <p className="font-medium">{r.profile?.full_name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {new Date(r.attended_at).toLocaleTimeString("ar-EG", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <span className="rounded-full bg-coptic-gold-soft px-2.5 py-1 text-xs font-bold text-coptic-gold">
                +{r.points}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}