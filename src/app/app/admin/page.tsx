import { redirect } from "next/navigation"
import Link from "next/link"
import { ScanLine, Users, Cake, CheckCheck, Activity } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { toDateString } from "@/lib/dates"
import { StatCard } from "@/components/app/stat-cards"
import { NileDivider } from "@/components/coptic/brand"
import { EmptyState } from "@/components/coptic/empty-state"
import { Button } from "@/components/ui/button"

export default async function AdminHomePage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.ADMIN) redirect("/")

  const today = toDateString(new Date())

  const [membersResult, todayAttendance] = await Promise.all([
    supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "SERVED_MEMBER")
      .eq("status", "ACTIVE"),
    supabase
      .from("attendance_records")
      .select("id", { count: "exact", head: true })
      .gte("attended_at", `${today}T00:00:00`)
      .lte("attended_at", `${today}T23:59:59`)
      .in("status", ["PRESENT", "LATE"]),
  ])

  const activeMembers = membersResult.count ?? 0
  const todayCount = todayAttendance.count ?? 0

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
          iconClass="bg-coptic-teal/10 text-coptic-teal"
        />
        <StatCard
          icon={CheckCheck}
          label="حضور اليوم"
          value={todayCount}
          iconClass="bg-coptic-gold-soft text-coptic-gold"
        />
        <StatCard
          icon={Cake}
          label="أعياد الميلاد القادمة"
          value="0"
          hint="لا يوجد أعياد قريبة"
          iconClass="bg-secondary text-muted-foreground"
        />
        <StatCard
          icon={Activity}
          label="النشاط الأخير"
          value="—"
          hint="لا يوجد نشاط اليوم"
          iconClass="bg-secondary text-muted-foreground"
        />
      </div>

      <NileDivider />

      <EmptyState
        icon={<Activity className="size-7" />}
        title="لا يوجد نشاط حديث"
        description="حضور وأحداث النهارده هتظهر هنا"
        action={
          <Link href="/app/admin/members">
            <Button variant="outline">تصفح المخدومين</Button>
          </Link>
        }
      />
    </div>
  )
}