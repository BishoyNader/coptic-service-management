"use client"

import { useState, useTransition } from "react"
import {
  CalendarDays,
  Cake,
  MoonStar,
  Loader2,
  TriangleAlert,
  Snowflake,
  Bell,
} from "lucide-react"
import type {
  CopticCalendarResult,
  UpcomingFeastsResult,
} from "@/services/coptic-calendar-service"
import { Button } from "@/components/ui/button"

const TYPE_META = {
  feast: { label: "عيد", Icon: Cake },
  lordlyFeast: { label: "عيد سيدي", Icon: MoonStar },
  fast: { label: "صوم", Icon: Snowflake },
} as const

type NotifyAction = () => Promise<{
  ok: boolean
  message: string
  created: string[]
  skipped: string[]
}>

type Props = {
  today: string
  result: CopticCalendarResult
  upcomingResult?: UpcomingFeastsResult
  notifyAction?: NotifyAction
}

/** Arabic relative label for a feast date relative to today. */
function relativeLabel(feastDate: string, today: string): string {
  const [fy, fm, fd] = feastDate.split("-").map(Number)
  const [ty, tm, td] = today.split("-").map(Number)
  const diffDays = Math.round(
    (Date.UTC(fy, fm - 1, fd) - Date.UTC(ty, tm - 1, td)) / 86_400_000
  )
  if (diffDays === 0) return "اليوم"
  if (diffDays === 1) return "غدًا"
  if (diffDays === 2) return "بعد يومين"
  return `بعد ${diffDays} أيام`
}

export function CopticCalendarPage({
  today,
  result,
  upcomingResult,
  notifyAction,
}: Props) {
  const [notifStatus, setNotifStatus] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleNotify = () => {
    if (!notifyAction) return
    startTransition(async () => {
      setNotifStatus(null)
      const res = await notifyAction()
      setNotifStatus(res.message)
    })
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Today's Coptic Date header */}
      {result.ok ? (
        <header className="rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="size-4" />
            <span>التاريخ القبطي اليوم</span>
          </div>
          <h1 className="mt-2 font-heading text-2xl font-bold text-coptic-teal">
            {result.day.copticDate.monthString} {result.day.copticDate.day}،{" "}
            {result.day.copticDate.year}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.day.copticDate.dateString}
          </p>
        </header>
      ) : (
        <div
          className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-8 text-center"
        >
          <TriangleAlert className="size-10 text-muted-foreground" />
          <p className="font-medium">تعذر تحميل التقويم القبطي</p>
          <p className="text-sm text-muted-foreground">{result.message}</p>
        </div>
      )}

      {/* Today's celebrations */}
      {result.ok && (
        <section aria-label="احتفالات اليوم">
          <h2 className="mb-3 font-heading text-lg font-bold">احتفالات اليوم</h2>
          {result.day.celebrations.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-6 text-center">
              <CalendarDays className="size-7 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">لا توجد احتفالات اليوم</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {result.day.celebrations.map((c) => {
                const meta = TYPE_META[c.type] ?? TYPE_META.feast
                const Icon = meta.Icon
                return (
                  <li
                    key={`${c.name}-${c.type}`}
                    className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-4"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex size-10 items-center justify-center rounded-xl bg-coptic-teal/10 text-coptic-teal">
                        <Icon className="size-5" />
                      </span>
                      <div>
                        <p className="font-semibold">{c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {meta.label}
                          {c.isMoveable ? " · احتفال متحرك" : " · احتفال ثابت"}
                        </p>
                      </div>
                    </div>
                    <span className="rounded-full bg-coptic-gold-soft px-3 py-1 text-xs font-semibold text-coptic-gold">
                      اليوم
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {/* Upcoming feasts */}
      {upcomingResult && (
        <section aria-label="الأعياد القادمة">
          <h2 className="mb-3 font-heading text-lg font-bold">الأعياد القادمة</h2>
          {!upcomingResult.ok ? (
            <div className="flex items-center gap-3 rounded-2xl border border-dashed p-4">
              <TriangleAlert className="size-5 shrink-0 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{upcomingResult.message}</p>
            </div>
          ) : upcomingResult.days.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-6 text-center">
              <CalendarDays className="size-7 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">لا توجد أعياد قبطية في الأيام السبعة القادمة</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {upcomingResult.days.map((day) => {
                const label = relativeLabel(day.date, today)
                const isToday = day.date === today
                return day.celebrations.map((c) => {
                  const meta = TYPE_META[c.type] ?? TYPE_META.feast
                  const Icon = meta.Icon
                  return (
                    <li
                      key={`${day.date}-${c.name}`}
                      className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-4"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex size-10 items-center justify-center rounded-xl bg-coptic-teal/10 text-coptic-teal">
                          <Icon className="size-5" />
                        </span>
                        <div>
                          <p className="font-semibold">{c.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {meta.label} ·{" "}
                            {day.copticDate.monthString} {day.copticDate.day}،{" "}
                            {day.copticDate.year}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          isToday
                            ? "bg-coptic-gold-soft text-coptic-gold"
                            : "bg-secondary text-muted-foreground"
                        }`}
                      >
                        {label}
                      </span>
                    </li>
                  )
                })
              })}
            </ul>
          )}
        </section>
      )}

      {/* Feast notification button — Super Admin only */}
      {notifyAction && (
        <section aria-label="إشعارات الأعياد" className="space-y-2">
          <Button
            onClick={handleNotify}
            disabled={isPending}
            variant="outline"
            className="flex w-full items-center gap-2"
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Bell className="size-4" />
            )}
            {isPending ? "جارٍ الإرسال..." : "إرسال إشعارات الأعياد القادمة"}
          </Button>
          {notifStatus && (
            <p className="text-center text-sm text-muted-foreground">{notifStatus}</p>
          )}
        </section>
      )}
    </div>
  )
}

export function CopticCalendarPageSkeleton() {
  return (
    <div className="min-h-64 space-y-6" dir="rtl">
      <div className="h-32 animate-pulse rounded-2xl border bg-card" />
      <div className="h-24 animate-pulse rounded-2xl border bg-card" />
    </div>
  )
}

export function CopticCalendarPageLoadingFallback() {
  return (
    <div className="flex min-h-64 items-center justify-center" dir="rtl">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  )
}
