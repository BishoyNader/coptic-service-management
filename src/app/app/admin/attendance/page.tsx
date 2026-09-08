import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { ScanLine, History } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { toAttendanceRows } from "@/services/attendance-service"
import { ROLES } from "@/lib/roles"
import { cairoDayEnd, cairoDayStart, cairoDateString } from "@/lib/cairo"
import { ATTENDANCE_TYPE_LABELS, ATTENDANCE_SOURCE_LABELS } from "@/lib/constants"
import { formatCairoTime } from "@/lib/cairo"
import { EmptyState } from "@/components/coptic/empty-state"
import { AttendanceCheckIn } from "@/components/app/attendance-check-in"
import { ManualAttendanceDialog } from "@/components/app/manual-attendance-dialog"
import { NileDivider } from "@/components/coptic/brand"

export const metadata: Metadata = { title: "تسجيل حضور" }

export default async function AdminAttendancePage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.ADMIN) redirect("/")

  const now = new Date()
  const dayStart = cairoDayStart(now).toISOString()
  const dayEnd = cairoDayEnd(now).toISOString()

  const [recordsResult, peopleResult] = await Promise.all([
    supabase
      .from("attendance_records")
      .select(
        "id, attended_at, points, source, status, session:attendance_sessions(type), profile:profiles!attendance_records_profile_id_fkey(full_name, role)"
      )
      .gte("attended_at", dayStart)
      .lt("attended_at", dayEnd)
      .neq("status", "ARCHIVED")
      .order("attended_at", { ascending: false })
      .limit(100),
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

  const today = cairoDateString(now)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-xl font-extrabold">تسجيل حضور</h1>
        <p className="text-sm text-muted-foreground">قاعةُ الخدمة — اليوم {today}</p>
      </div>

      <AttendanceCheckIn defaultType="CHURCH" />

      <div className="flex items-center justify-between">
        <div>
          <p className="font-heading font-bold">سجل النهارده</p>
          <p className="text-xs text-muted-foreground">{records.length} حضور مسجّل</p>
        </div>
        <ManualAttendanceDialog people={people} />
      </div>

      {records.length === 0 ? (
        <EmptyState
          icon={<ScanLine className="size-7" />}
          title="لسه مفيش حضور النهارده"
          description="ابدأ بتسجيل أول حضور 📷"
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

      <div className="flex items-center justify-center gap-2 rounded-2xl bg-card/60 py-3 text-xs text-muted-foreground">
        <History className="size-4" />
        التاريخ الكامل والقدرة على تصحيح السجلات متاحان لمسؤول الخدمة العامة
      </div>
      <NileDivider className="mx-auto w-2/3" />
    </div>
  )
}