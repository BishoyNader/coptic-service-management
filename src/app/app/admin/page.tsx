import { redirect } from "next/navigation"
import Link from "next/link"
import { ScanLine, Users, Cake, CheckCheck, Activity } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { getUpcomingBirthdays } from "@/services/birthday-service"
import { ROLES } from "@/lib/roles"
import { cairoDayStart, cairoDayEnd, formatCairoTime } from "@/lib/cairo"
import { ATTENDANCE_SOURCE_LABELS } from "@/lib/constants"
import { StatCard } from "@/components/app/stat-cards"
import { NileDivider } from "@/components/coptic/brand"
import { EmptyState } from "@/components/coptic/empty-state"
import { Button } from "@/components/ui/button"

export default async function AdminHomePage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.ADMIN) redirect("/")

  const now = new Date()
  const dayStart = cairoDayStart(now).toISOString()
  const dayEnd = cairoDayEnd(now).toISOString()

  const [membersResult, todayRecordsResult, birthdays] = await Promise.all([
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "SERVED_MEMBER")
      .eq("status", "ACTIVE"),
    supabase
      .from("attendance_records")
      .select(
        "id, attended_at, source, profile:profiles!attendance_records_profile_id_fkey(full_name, role)"
      )
      .gte("attended_at", dayStart)
      .lt("attended_at", dayEnd)
      .neq("status", "ARCHIVED")
      .order("attended_at", { ascending: false })
      .limit(8),
    getUpcomingBirthdays(supabase),
  ])

  const activeMembers = membersResult.count ?? 0
  const todayRecords = ((todayRecordsResult.data ?? []) as never[]) as {
    id: string
    attended_at: string
    source: string
    profile: { full_name: string; role: string } | null
  }[]
  const todayCount = todayRecords.length
  const lastActivity = todayRecords[0]

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-extrabold">أهلًا بيك 👋</h1>
          <p className="text-sm text-muted-foreground">لوحة الخدمة اليومية</p>
        </div>
      </div>

      <Link href="/app/admin/attendance">
        <div className="group relative flex items-center gap-4 overflow-hidden rounded-3xl bg-coptic-teal p-5 text-primary-foreground shadow-md">
          <div className="pointer-events-none absolute inset-0 coptic-lattice-gold opacity-60" />
          <div className="relative flex size-14 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur transition-transform group-hover:scale-105">
            <ScanLine className="size-7" />
          </div>
          <div className="relative">
            <p className="font-heading text-lg font-bold">📷 تسجيل حضور</p>
            <p className="text-sm text-primary-foreground/85">امسح QR أو ادخل الكود</p>
          </div>
        </div>
      </Link>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={Users}
          label="عدد المخدومين"
          value={activeMembers}
          hint={activeMembers === 0 ? "لسه مفيش مخدومين" : "مخدوم نشط"}
          iconClass="bg-coptic-teal/10 text-coptic-teal"
        />
        <StatCard
          icon={CheckCheck}
          label="حضور اليوم"
          value={todayCount}
          hint={todayCount === 0 ? "لسه مفيش حضور مسجل" : "تسجيل اليوم"}
          iconClass="bg-coptic-gold-soft text-coptic-gold"
        />
        <StatCard
          icon={Cake}
          label="أعياد الميلاد القادمة"
          value={birthdays.length}
          hint={
            birthdays.length === 0
              ? "لا يوجد أعياد في خلال 30 يوم"
              : "على مدار الـ 30 يوم الجاي"
          }
          iconClass="bg-coptic-terra/10 text-coptic-terra"
        />
        <StatCard
          icon={Activity}
          label="آخر نشاط"
          value={lastActivity ? formatCairoTime(lastActivity.attended_at) : "لا يوجد"}
          hint={
            lastActivity
              ? `${lastActivity.profile?.full_name ?? "—"} — ${
                  ATTENDANCE_SOURCE_LABELS[lastActivity.source as keyof typeof ATTENDANCE_SOURCE_LABELS] ??
                  lastActivity.source
                }`
              : "سجّل أول حضور النهارده"
          }
          iconClass="bg-secondary text-muted-foreground"
        />
      </div>

      <NileDivider />

      {todayRecords.length === 0 ? (
        <EmptyState
          icon={<Activity className="size-7" />}
          title="لسه مفيش حضور مسجل النهارده"
          description="أول تسجيل حضور هيظهر هنا فورًا"
          action={
            <Link href="/app/admin/attendance">
              <Button>تسجيل حضور</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-muted-foreground">أحدث الحضور اليوم</p>
          {todayRecords.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-coptic-gold-soft font-heading text-sm font-bold text-coptic-gold">
                {r.profile?.full_name.trim().charAt(0) ?? "؟"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.profile?.full_name ?? "—"}</p>
                <p className="text-[11px] text-muted-foreground">
                  {ATTENDANCE_SOURCE_LABELS[r.source as keyof typeof ATTENDANCE_SOURCE_LABELS] ??
                    r.source}
                </p>
              </div>
              <span className="text-xs font-semibold text-muted-foreground">
                {formatCairoTime(r.attended_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}