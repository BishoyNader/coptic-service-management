"use client"

import { useState, useTransition } from "react"
import {
  BookOpen,
  Check,
  Church,
  ClipboardList,
  Gem,
  GraduationCap,
  HeartHandshake,
  Home,
  Loader2,
  Lock,
  Shirt,
  Users,
  type LucideIcon,
} from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"
import {
  recordServantActivityAction,
  removeServantActivityAction,
} from "@/app/actions/servant-activities"

type ActivityEntry = { id: string; name: string; icon: string | null }
type HistoryEntry = { activityId: string; recordedOn: string }

type ServantActivityPanelProps = {
  activities: ActivityEntry[]
  history: HistoryEntry[]
  cairoToday: string
  minDate: string
}

const ICONS: Record<string, LucideIcon> = {
  Church,
  Shirt,
  Gem,
  Users,
  HeartHandshake,
  BookOpen,
  GraduationCap,
  Home,
}

/**
 * Simple, mobile-friendly servant activity recorder.
 *
 * A servant picks the Cairo date of the activity (defaults to today, never
 * in the future) and toggles each activity. Records for PAST dates are
 * immutable; only today's records can be undone — the server enforces this
 * even though the UI hides the removal affordance.
 */
export function ServantActivityPanel({
  activities,
  history,
  cairoToday,
  minDate,
}: ServantActivityPanelProps) {
  const [date, setDate] = useState(cairoToday)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const recordedIds = new Set(
    history
      .filter((h) => h.recordedOn === date)
      .map((h) => h.activityId)
  )

  const isToday = date === cairoToday

  function toggle(activityId: string, recorded: boolean) {
    if (!recorded && date > cairoToday) return
    setBusyId(activityId)
    startTransition(async () => {
      const result = recorded
        ? await removeServantActivityAction(activityId, date)
        : await recordServantActivityAction(activityId, date)
      setBusyId(null)
      if (result.ok && !result.already) {
        toast.success(result.message)
      } else if (result.ok) {
        toast.info(result.message)
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label
          htmlFor="servant-activity-date"
          className="text-sm font-medium text-muted-foreground"
        >
          تاريخ النشاط
        </label>
        <input
          id="servant-activity-date"
          type="date"
          value={date}
          min={minDate}
          max={cairoToday}
          onChange={(e) => setDate(e.target.value || cairoToday)}
          className="rounded-lg border bg-card px-3 py-2 text-sm"
        />
      </div>

      <div className="grid grid-cols-1 gap-2">
        {activities.map((activity) => {
          const recorded = recordedIds.has(activity.id)
          const disabled = recorded && !isToday
          const Icon = activity.icon ? ICONS[activity.icon] : ClipboardList

          return (
            <button
              key={activity.id}
              type="button"
              disabled={disabled || busyId !== null || isPending}
              onClick={() => toggle(activity.id, recorded)}
              className={cn(
                "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-start shadow-sm ring-1 transition",
                recorded
                  ? "bg-coptic-teal/10 ring-coptic-teal/30"
                  : "bg-card ring-foreground/5 hover:ring-foreground/15",
                disabled && "opacity-80"
              )}
            >
              <span
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-xl",
                  recorded
                    ? "bg-coptic-teal/15 text-coptic-teal"
                    : "bg-muted text-muted-foreground"
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <span className="flex-1">
                <span className="font-medium">{activity.name}</span>
                {!isToday && recorded && (
                  <span className="block text-[11px] text-muted-foreground">
                    سجل قديم — لا يمكن تعديله
                  </span>
                )}
              </span>
              {busyId === activity.id && isPending ? (
                <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
              ) : recorded ? (
                disabled ? (
                  <Lock className="size-5 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <Check className="size-5 text-coptic-teal" aria-hidden="true" />
                )
              ) : (
                <span className="text-sm font-semibold text-coptic-teal">سجّل</span>
              )}
            </button>
          )
        })}
      </div>

      <p className="text-[11px] text-muted-foreground">
        المشاركات المسجلة في تاريخ سابق لا يمكن تعديلها — يمكن إلغاء تسجيل اليوم فقط.
      </p>
    </div>
  )
}