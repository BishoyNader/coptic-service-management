import { redirect } from "next/navigation"
import { Users, HeartHandshake, Shield, CheckCheck } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { toDateString } from "@/lib/dates"
import { StatCard } from "@/components/app/stat-cards"
import { NileDivider } from "@/components/coptic/brand"

export default async function SuperAdminHomePage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const today = toDateString(new Date())

  const [members, servants, admins, todayAttendance] = await Promise.all([
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
      .select("id", { count: "exact", head: true })
      .gte("attended_at", `${today}T00:00:00`)
      .lte("attended_at", `${today}T23:59:59`),
  ])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-xl font-extrabold">لوحة التحكم العامة</h1>
        <p className="text-sm text-muted-foreground">نظرة عامة على الخدمة</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="المخدومين" value={members.count ?? 0} icon={Users} iconClass="bg-coptic-teal/10 text-coptic-teal" />
        <StatCard label="الخدام" value={servants.count ?? 0} icon={HeartHandshake} iconClass="bg-coptic-gold-soft text-coptic-gold" />
        <StatCard label="المسؤولين" value={admins.count ?? 0} icon={Shield} iconClass="bg-secondary text-muted-foreground" />
        <StatCard label="حضور اليوم" value={todayAttendance.count ?? 0} icon={CheckCheck} iconClass="bg-coptic-gold-soft text-coptic-gold" />
      </div>

      <NileDivider />
      <p className="text-center text-xs text-muted-foreground">
        باقي الأقسام جاهزة للتفعيل في المرحلة القادمة
      </p>
    </div>
  )
}