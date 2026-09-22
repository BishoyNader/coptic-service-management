import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { ScanLine } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getProfile } from "@/services/profile-service"
import { toAttendanceRows } from "@/services/attendance-service"
import { ROLES } from "@/lib/roles"
import { cairoDayEnd, cairoDayStart, cairoDateString } from "@/lib/cairo"
import { ATTENDANCE_TYPE_LABELS, ATTENDANCE_SOURCE_LABELS } from "@/lib/constants"
import { formatCairoTime } from "@/lib/cairo"
import { getServerNow } from "@/services/attendance-service"
import { getFridayAttendanceGrid, getFridayMinistryData } from "@/services/friday-service"
import { getActiveStudyYear } from "@/services/study-year-service"
import { getActiveScoringRules } from "@/services/scoring-service"
import { getServantClassId } from "@/services/member-scoring-service"
import { currentFridayIn } from "@/lib/friday"
import { EmptyState } from "@/components/coptic/empty-state"
import { AttendanceCheckIn } from "@/components/app/attendance-check-in"
import { ManualAttendanceDialog } from "@/components/app/manual-attendance-dialog"
import { FridayDashboard } from "@/components/app/friday-dashboard"
import { FridayPicker } from "@/components/app/friday-picker"
import { NileDivider } from "@/components/coptic/brand"

export const metadata: Metadata = { title: "تسجيل حضور" }

type Props = { searchParams: Promise<{ friday?: string }> }

export default async function ServantAttendancePage({ searchParams }: Props) {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVANT) redirect("/")

  const params = await searchParams
  const admin = createAdminClient()
  const now = getServerNow()

  const myClassId = await getServantClassId(admin, profile.id)
  const { data: myClass } = myClassId
    ? await admin.from("classes").select("name").eq("id", myClassId).maybeSingle()
    : { data: null }
  const myClassName = (myClass?.name as string | null | undefined) ?? null

  // Study year + schedule
  const studyYear = await getActiveStudyYear(admin, cairoDateString(now))
  const schedule = studyYear?.schedule ?? []

  // Selected Friday (from URL or default to current Friday)
  const selectedFriday =
    (params.friday && schedule.includes(params.friday))
      ? params.friday
      : (currentFridayIn(schedule, now) ?? cairoDateString(now))

  // Attendance records for the selected Friday
  const fridayDayStart = cairoDayStart(new Date(`${selectedFriday}T12:00:00Z`)).toISOString()
  const fridayDayEnd = cairoDayEnd(new Date(`${selectedFriday}T12:00:00Z`)).toISOString()

  const [recordsResult, peopleResult, rulesResult] = await Promise.all([
    supabase
      .from("attendance_records")
      .select(
        "id, attended_at, points, source, status, session:attendance_sessions(type), profile:profiles!attendance_records_profile_id_fkey(full_name, role)"
      )
      .gte("attended_at", fridayDayStart)
      .lt("attended_at", fridayDayEnd)
      .neq("status", "ARCHIVED")
      .order("attended_at", { ascending: false })
      .limit(100),
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
        <div>
          <h1 className="font-heading text-xl font-extrabold">تسجيل حضور</h1>
          <p className="text-sm text-muted-foreground">قاعةُ الخدمة</p>
          {myClassName && (
            <span className="mt-1.5 inline-block rounded-full bg-coptic-teal/10 px-3 py-1 text-xs font-bold text-coptic-teal">
              صفّك: {myClassName}
            </span>
          )}
        </div>
        {schedule.length > 0 && (
          <FridayPicker schedule={schedule} selected={selectedFriday} />
        )}
      </div>

      <AttendanceCheckIn defaultType="CHURCH" />

      <div className="flex items-center justify-between">
        <div>
          <p className="font-heading font-bold">سجل الجمعة</p>
          <p className="text-xs text-muted-foreground">{records.length} حضور مسجّل</p>
        </div>
        <ManualAttendanceDialog
          people={people}
          attendanceRules={rulesResult}
          selectedFriday={selectedFriday}
        />
      </div>

      {records.length === 0 ? (
        <EmptyState
          icon={<ScanLine className="size-7" />}
          title="لسه مفيش حضور الجمعة دي"
          description="ابدأ بتسجيل أول حضور"
        />
      ) : (
        <div className="space-y-2">
          {records.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-coptic-gold-soft font-heading text-sm font-bold text-coptic-gold">
                {r.fullName.trim().charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.fullName}</p>
                <p className="text-[11px] text-muted-foreground">
                  {ATTENDANCE_TYPE_LABELS[r.type]} — {formatCairoTime(r.attended_at)}
                </p>
              </div>
              <div className="text-end">
                <p className="text-xs font-bold">
                  {r.role === "SERVANT" ? (
                    "خادم"
                  ) : r.points > 0 ? (
                    <span className="text-coptic-gold">+{r.points}</span>
                  ) : (
                    <span className="text-muted-foreground">بدون نقاط</span>
                  )}
                </p>
                <p className="text-[10px] text-muted-foreground">{ATTENDANCE_SOURCE_LABELS[r.source]}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-border pt-6">
        <FridayDashboard initialGrid={fridayGrid} initialMinistry={fridayMinistry} />
      </div>

      <NileDivider className="mx-auto w-2/3" />
    </div>
  )
}
