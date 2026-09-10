import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { ScanLine } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { toAttendanceRows } from "@/services/attendance-service"
import { ROLES } from "@/lib/roles"
import { cairoDateString, daysAgoUtcISO } from "@/lib/cairo"
import { EmptyState } from "@/components/coptic/empty-state"
import { AttendanceManagement } from "@/components/app/attendance-management"
import { AttendanceCheckIn } from "@/components/app/attendance-check-in"
import { ManualAttendanceDialog } from "@/components/app/manual-attendance-dialog"
import { ATTENDANCE_PAGE_SIZE } from "@/lib/pagination"
import { loadMoreAttendanceAction } from "@/app/actions/listing"

export const metadata: Metadata = { title: "الحضور" }

export default async function SuperAdminAttendancePage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const since = daysAgoUtcISO(90)

  const [recordsResult, peopleResult] = await Promise.all([
    supabase
      .from("attendance_records")
      .select(
        "id, attended_at, points, source, status, session:attendance_sessions(type), profile:profiles!attendance_records_profile_id_fkey(full_name, role)"
      )
      .gte("attended_at", since)
      .order("attended_at", { ascending: false })
      .order("id")
      .limit(ATTENDANCE_PAGE_SIZE),
    supabase
      .from("profiles")
      .select("id, full_name, role, phone")
      .in("role", [ROLES.SERVED_MEMBER, ROLES.SERVANT])
      .eq("status", "ACTIVE")
      .order("full_name")
      .limit(300),
  ])

  const records = toAttendanceRows((recordsResult.data ?? []) as never[])
  const people = (peopleResult.data ?? []).map((p) => ({
    id: p.id as string,
    fullName: p.full_name as string,
    role: p.role as "SERVED_MEMBER" | "SERVANT",
    phone: p.phone as string,
  }))

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="font-heading text-xl font-extrabold">سجل الحضور</h1>
          <p className="text-sm text-muted-foreground">
            متابعة كاملة للحضور — {cairoDateString(new Date())}
          </p>
        </div>
        <ManualAttendanceDialog people={people} />
      </div>

      <div className="rounded-2xl bg-secondary/40 p-1 ring-1 ring-foreground/5">
        <AttendanceCheckIn defaultType="CHURCH" />
      </div>

      {records.length === 0 ? (
        <EmptyState
          icon={<ScanLine className="size-7" />}
          title="مفيش سجلات حضور"
          description="ابدأ بتسجيل أول حضور 📷"
        />
      ) : (
        <>
          <AttendanceManagement records={records} loadMore={loadMoreAttendanceAction} />
          <p className="text-center text-xs text-muted-foreground">
            بسعة تحميل تدريجية — السجل بينزل على أجزاء عشان الأداء
          </p>
        </>
      )}
    </div>
  )
}