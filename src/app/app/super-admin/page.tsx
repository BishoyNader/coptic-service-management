import { redirect } from "next/navigation"
import Link from "next/link"
import { Users, HeartHandshake, Shield, CheckCheck, Cake, UserRound } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { getUpcomingBirthdays } from "@/services/birthday-service"
import { ROLES } from "@/lib/roles"
import { cairoDayStart, cairoDayEnd, formatCairoTime } from "@/lib/cairo"
import { toDateString } from "@/lib/dates"
import { StatCard } from "@/components/app/stat-cards"
import { NileDivider } from "@/components/coptic/brand"
import { Button } from "@/components/ui/button"

export default async function SuperAdminHomePage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const now = new Date()
  const dayStart = cairoDayStart(now).toISOString()
  const dayEnd = cairoDayEnd(now).toISOString()
  const today = toDateString(now)

  const [members, servants, admins, todayAttendance, scoresToday, birthdays] = await Promise.all([
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "SERVED_MEMBER")
      .eq("status", "ACTIVE"),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "SERVANT")
      .eq("status", "ACTIVE"),
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .in("role", ["ADMIN", "SUPER_ADMIN"])
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
      .limit(5),
    supabase
      .from("score_records")
      .select("id", { count: "exact", head: true })
      .eq("session_date", today),
    getUpcomingBirthdays(supabase),
  ])

  const todayRecords = ((todayAttendance.data ?? []) as never[]) as {
    id: string
    attended_at: string
    profile: { full_name: string; role: string } | null
  }[]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-xl font-extrabold">لوحة التحكم العامة</h1>
        <p className="text-sm text-muted-foreground">نظرة عامة على الخدمة</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="المخدومين"
          value={members.count ?? 0}
          icon={Users}
          iconClass="bg-coptic-teal/10 text-coptic-teal"
        />
        <StatCard
          label="الخدام"
          value={servants.count ?? 0}
          icon={HeartHandshake}
          iconClass="bg-coptic-gold-soft text-coptic-gold"
        />
        <StatCard
          label="المسؤولين"
          value={admins.count ?? 0}
          icon={Shield}
          iconClass="bg-coptic-navy/10 text-coptic-navy"
        />
        <StatCard
          label="حضور اليوم"
          value={todayRecords.length}
          hint={todayRecords.length === 0 ? "لسه مفيش حضور" : "تسجيل اليوم"}
          icon={CheckCheck}
          iconClass="bg-coptic-gold-soft text-coptic-gold"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="أعياد قادمة"
          value={birthdays.length}
          hint={birthdays.length === 0 ? "لا يوجد في خلال 30 يوم" : "على مدار 30 يوم"}
          icon={Cake}
          iconClass="bg-coptic-terra/10 text-coptic-terra"
        />
        <StatCard
          label="درجات اليوم"
          value={scoresToday.count ?? 0}
          hint="نقاط مسجلة اليوم"
          icon={UserRound}
          iconClass="bg-secondary text-muted-foreground"
        />
      </div>

      <NileDivider />

      {todayRecords.length === 0 ? (
        <p className="rounded-2xl bg-card px-5 py-8 text-center text-sm text-muted-foreground ring-1 ring-foreground/5">
          لسه مفيش حضور مسجل النهارده — أول تسجيل هيظهر هنا فورًا.
        </p>
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
                  {r.profile?.role === "SERVANT" ? "خادم" : "مخدوم"}
                </p>
              </div>
              <span className="text-xs font-semibold text-muted-foreground">
                {formatCairoTime(r.attended_at)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
        <Link href="/app/super-admin/users">
          <Button variant="outline">إدارة المستخدمين</Button>
        </Link>
        <Link href="/app/super-admin/attendance">
          <Button variant="outline">سجل الحضور</Button>
        </Link>
        <Link href="/app/super-admin/birthdays">
          <Button variant="outline">أعياد الميلاد</Button>
        </Link>
      </div>
    </div>
  )
}