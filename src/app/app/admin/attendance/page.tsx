import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { ScanLine } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { toDateString } from "@/lib/dates"
import { EmptyState } from "@/components/coptic/empty-state"

export const metadata: Metadata = { title: "تسجيل حضور" }

type RecordRow = {
  id: string
  attended_at: string
  points: number
  profile: { full_name: string } | null
}

export default async function AdminAttendancePage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.ADMIN) redirect("/")

  const today = toDateString(new Date())

  const { data } = await supabase
    .from("attendance_records")
    .select("id, attended_at, points, profile:profiles(full_name)")
    .gte("attended_at", `${today}T00:00:00`)
    .lte("attended_at", `${today}T23:59:59`)
    .order("attended_at", { ascending: false })
    .limit(20)

  const records = (data ?? []) as unknown as RecordRow[]

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-xl font-extrabold">تسجيل حضور</h1>

      <div className="relative flex flex-col items-center gap-3 overflow-hidden rounded-3xl bg-coptic-teal p-6 text-center text-primary-foreground shadow-md">
        <div className="pointer-events-none absolute inset-0 coptic-lattice-gold opacity-60" />
        <div className="relative flex size-16 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur">
          <ScanLine className="size-8" />
        </div>
        <div className="relative">
          <p className="font-heading text-lg font-bold">المسح الضوئي متاح قريبًا</p>
          <p className="text-sm text-primary-foreground/85">
            مسح QR وإدخال الكود هيبقى متاح في المرحلة الجاية
          </p>
        </div>
      </div>

      <EmptyState
        icon={<ScanLine className="size-7" />}
        title="لا توجد سجلات حضور"
        description="سجلات حضور النهارده هتظهر هنا بعد الماسح الضوئي"
      />

      {records && records.length > 0 ? (
        <div className="space-y-2">
          <p className="font-heading font-bold text-sm">سجل اليوم</p>
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
      ) : null}
    </div>
  )
}