import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { ScanLine } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getProfile } from "@/services/profile-service"
import { toAttendanceRows } from "@/services/attendance-service"
import { ROLES } from "@/lib/roles"
import { cairoDateString } from "@/lib/cairo"
import { getServerNow } from "@/services/attendance-service"
import { getFridayAttendanceGrid, getFridayMinistryData } from "@/services/friday-service"
import { getActiveStudyYear } from "@/services/study-year-service"
import { getActiveScoringRules } from "@/services/scoring-service"
import { currentFridayIn } from "@/lib/friday"
import { EmptyState } from "@/components/coptic/empty-state"
import { AttendanceManagement } from "@/components/app/attendance-management"
import { AttendanceCheckIn } from "@/components/app/attendance-check-in"
import { ManualAttendanceDialog } from "@/components/app/manual-attendance-dialog"
import { FridayDashboard } from "@/components/app/friday-dashboard"
import { FridayPicker } from "@/components/app/friday-picker"
import { ATTENDANCE_PAGE_SIZE } from "@/lib/pagination"
import { loadMoreAttendanceAction } from "@/app/actions/listing"

export const metadata: Metadata = { title: "الحضور" }

type Props = { searchParams: Promise<{ friday?: string }> }

export default async function SuperAdminAttendancePage({ searchParams }: Props) {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const params = await searchParams
  const admin = createAdminClient()
  const now = getServerNow()

  // Study year + schedule
  const studyYear = await getActiveStudyYear(admin, cairoDateString(now))
  const schedule = studyYear?.schedule ?? []

  // Selected Friday (from URL or default to current Friday)
  const selectedFriday =
    (params.friday && schedule.includes(params.friday))
      ? params.friday
      : (currentFridayIn(schedule, now) ?? cairoDateString(now))

  const [recordsResult, peopleResult, rulesResult] = await Promise.all([
    supabase
      .from("attendance_records")
      .select(
        "id, attended_at, points, source, status, session:attendance_sessions(type), profile:profiles!attendance_records_profile_id_fkey(full_name, role)"
      )
      .neq("status", "ARCHIVED")
      .order("attended_at", { ascending: false })
      .order("id")
      .limit(ATTENDANCE_PAGE_SIZE),
    supabase
      .from("profiles")
      .select("id, full_name, role, phone, served_members(class)")
      .in("role", [ROLES.SERVED_MEMBER, ROLES.SERVANT])
      .eq("status", "ACTIVE")
      .order("full_name")
      .limit(300),
    getActiveScoringRules(admin),
  ])

  const records = toAttendanceRows((recordsResult.data ?? []) as never[])
  const people = (peopleResult.data ?? []).map((p) => ({
    id: p.id as string,
    fullName: p.full_name as string,
    role: p.role as "SERVED_MEMBER" | "SERVANT",
    phone: p.phone as string,
    className: (p.served_members as { class?: string } | null)?.class ?? null,
  }))

  const [fridayGrid, fridayMinistry] = await Promise.all([
    getFridayAttendanceGrid(admin, selectedFriday),
    getFridayMinistryData(admin, selectedFriday),
  ])

  return (
    <div className="space-y-8">
      {/* Friday picker at top */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="font-heading text-xl font-extrabold">سجل الحضور</h1>
            <p className="text-sm text-muted-foreground">
              متابعة كاملة للحضور
            </p>
          </div>
          <ManualAttendanceDialog
            people={people}
            attendanceRules={rulesResult}
            selectedFriday={selectedFriday}
          />
        </div>
        {schedule.length > 0 && (
          <FridayPicker schedule={schedule} selected={selectedFriday} />
        )}
      </div>

      <div className="rounded-2xl bg-secondary/40 p-1 ring-1 ring-foreground/5">
        <AttendanceCheckIn defaultType="CHURCH" />
      </div>

      {records.length === 0 ? (
        <EmptyState
          icon={<ScanLine className="size-7" />}
          title="مفيش سجلات حضور"
          description="ابدأ بتسجيل أول حضور"
        />
      ) : (
        <>
          <AttendanceManagement records={records} loadMore={loadMoreAttendanceAction} />
          <p className="text-center text-xs text-muted-foreground">
            بسعة تحميل تدريجية — السجل بينزل على أجزاء عشان الأداء
          </p>
        </>
      )}

      <div className="border-t border-border pt-6">
        <FridayDashboard initialGrid={fridayGrid} initialMinistry={fridayMinistry} />
      </div>
    </div>
  )
}
