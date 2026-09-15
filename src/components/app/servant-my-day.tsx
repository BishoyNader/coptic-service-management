"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarDays, Check, Church, Clock, Loader2, Users } from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/coptic/empty-state"
import { formatArabicDate } from "@/lib/dates"
import { formatCairoTime } from "@/lib/cairo"
import { ATTENDANCE_TYPE_LABELS } from "@/lib/constants"
import { manualAttendanceAction } from "@/app/actions/attendance"
import { ServantActivityPanel } from "@/components/app/servant-activity-panel"
import type { AttendanceType } from "@/lib/types"

export type MyDayAttendance = {
  id: string
  type: AttendanceType
  points: number
  attendedAt: string
  date?: string
}

/**
 * Servant's own day: today's attendance (record your presence in one tap)
 * plus a recent two-week attendance summary above the standard activity
 * panel. Attendance writes go through the server-side manualAttendanceAction
 * (the board's ordinary path), so the engine's time/duplicate rules hold.
 */
export function ServantMyDay({
  profileId,
  cairoToday,
  minDate,
  todayAttendance,
  recentAttendance,
  activities,
  history,
  embedded = false,
  servantId,
  onChanged,
}: {
  profileId: string
  cairoToday: string
  minDate: string
  todayAttendance: MyDayAttendance[]
  recentAttendance: MyDayAttendance[]
  activities: { id: string; name: string; icon: string | null }[]
  history: { activityId: string; recordedOn: string }[]
  /** Render inside another page (hide the page heading). */
  embedded?: boolean
  /** Subject servant when recording on behalf of another servant (super admin). */
  servantId?: string
  /** Called after any successful write so the parent can refresh its data. */
  onChanged?: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<AttendanceType | null>(null)

  const present = (type: AttendanceType) =>
    todayAttendance.find((t) => t.type === type) ?? null

  const handleRecord = async (type: AttendanceType) => {
    setBusy(type)
    const res = await manualAttendanceAction(profileId, type)
    setBusy(null)
    if (res.status === "success") {
      toast.success(`تم تسجيل الحضور (${res.points} نقطة)`)
      if (!embedded) router.refresh()
      onChanged?.()
    } else if (res.status === "duplicate") {
      toast.info(res.message)
      if (!embedded) router.refresh()
      onChanged?.()
    } else {
      toast.error(res.message)
    }
  }

  const showHeading = !embedded

  return (
    <div className="space-y-6">
      {showHeading && (
        <div className="space-y-1">
          <h1 className="font-heading text-xl font-extrabold">حضوري وأنشطتي</h1>
          <p className="text-sm text-muted-foreground">
            سجّل حضورك اليوم وتابع مشاركاتك في أنشطة الخدمة — كل حاجة في مكان واحد
          </p>
        </div>
      )}

      {/* Own attendance — today */}
      <section aria-label="حضور اليوم" className="space-y-2">
        <h2 className="font-heading text-sm font-bold text-muted-foreground">
          حضور اليوم — {formatArabicDate(cairoToday)}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(["CHURCH", "SERVICE"] as AttendanceType[]).map((type) => {
            const record = present(type)
            return (
              <div
                key={type}
                data-testid="my-day-attendance-card"
                className={cn(
                  "flex items-center justify-between gap-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5",
                  record && "ring-coptic-teal/30"
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex size-11 shrink-0 items-center justify-center rounded-xl",
                      record ? "bg-coptic-teal/15 text-coptic-teal" : "bg-muted text-muted-foreground"
                    )}
                  >
                    <Church className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">{ATTENDANCE_TYPE_LABELS[type]}</p>
                    {record ? (
                      <p className="flex items-center gap-1 text-[11px] text-coptic-teal">
                        <Check className="size-3" />
                        تم تسجيله — +{record.points} · {formatCairoTime(record.attendedAt)}
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">لم يسجّل حضورك بعد</p>
                    )}
                  </div>
                </div>
                {!record && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleRecord(type)}
                    disabled={busy !== null}
                    className="h-9 gap-1"
                  >
                    {busy === type ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                    سجّل
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* Own attendance — recent two weeks */}
      <section aria-label="حضور آخر أسبوعين" className="space-y-2">
        <h2 className="font-heading text-sm font-bold text-muted-foreground">
          حضور آخر أسبوعين
        </h2>
        {recentAttendance.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/60 px-4 py-6 text-center text-sm text-muted-foreground">
            <CalendarDays className="mx-auto mb-2 size-5" />
            لا يوجد حضور مسجّل في آخر أسبوعين
          </div>
        ) : (
          <div className="space-y-2">
            {recentAttendance.map((r) => (
              <div
                key={r.id}
                data-testid="my-day-recent-item"
                className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-coptic-teal/10 text-coptic-teal">
                  <Check className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{formatArabicDate(r.date ?? "")}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {ATTENDANCE_TYPE_LABELS[r.type]} ·{" "}
                    <Clock className="inline size-3" /> {formatCairoTime(r.attendedAt)}
                  </p>
                </div>
                <span className="text-sm font-bold text-coptic-gold">+{r.points}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Own activities (reused panel) */}
      <section aria-label="الأنشطة" className="space-y-2">
        <h2 className="font-heading text-sm font-bold text-muted-foreground">الأنشطة</h2>
        {activities.length === 0 ? (
          <EmptyState
            icon={<Users className="size-7" />}
            title="مفيش أنشطة متاحة"
            description="مفيش أنشطة خدمة متاحة للتسجيل دلوقتي"
          />
        ) : (
          <ServantActivityPanel
            activities={activities}
            history={history}
            cairoToday={cairoToday}
            minDate={minDate}
            servantId={servantId}
            onChanged={onChanged}
          />
        )}
      </section>
    </div>
  )
}