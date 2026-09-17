"use client"

import { useCallback, useState } from "react"
import { CalendarCheck, ChevronLeft, ChevronRight, History, Loader2, Trophy } from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { getMemberFridayResultsAction } from "@/app/actions/friday"
import type { FridayMemberView, FridayScoreLine } from "@/services/friday-service"
import {
  fridayIndexIn,
  nextFridayIn,
  previousFridayIn,
} from "@/lib/friday"
import { formatArabicDate } from "@/lib/dates"

function percentTone(percent: number): string {
  return percent >= 80
    ? "bg-coptic-teal/15 text-coptic-teal"
    : percent >= 50
      ? "bg-coptic-gold-soft/40 text-coptic-gold"
      : "bg-destructive/10 text-destructive"
}

/**
 * A served member's own per-Friday results.
 *
 * The member navigates ministry Fridays and sees: their presence (حاضر/غائب),
 * a percentage per activity (recorded ones scored, unrecorded ones shown at
 * 0% — never hidden), their previous-Friday history, and their ministry-year
 * total. Only the caller's own data is rendered; no ranking, no other members.
 */
export function MemberFridayResults({ initial, initialDate }: { initial: FridayMemberView; initialDate: string }) {
  const [date, setDate] = useState(initialDate)
  const [view, setView] = useState<FridayMemberView>(initial)
  const [loading, setLoading] = useState(false)
  const schedule = view.year.schedule

  const load = useCallback(async (friday: string) => {
    setLoading(true)
    const res = await getMemberFridayResultsAction(friday)
    setLoading(false)
    if (res.ok) {
      setView(res.view)
      setDate(friday)
    } else {
      toast.error(res.message)
    }
  }, [])

  const atFirst = schedule.length === 0 || date === schedule[0]
  const atLast = !nextFridayIn(schedule, date)
  const fridayNo = fridayIndexIn(schedule, date) + 1

  return (
    <div className="space-y-4">
      {/* Navigation + readiness card */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="font-heading text-sm font-bold text-muted-foreground">
            نتائج الجمعة — جمعة {fridayNo}
          </h2>
          <p className="text-xs text-muted-foreground">{formatArabicDate(date)}</p>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const prev = previousFridayIn(schedule, date)
              if (prev) void load(prev)
            }}
            disabled={atFirst || loading}
            aria-label="الجمعة السابقة"
          >
            <ChevronRight className="size-4" />
          </Button>
          <select
            aria-label="اختار جمعة"
            value={date}
            onChange={(e) => void load(e.target.value)}
            disabled={loading}
            className="rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-xs font-medium outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            {schedule.map((f, i) => (
              <option key={f} value={f}>
                جمعة {i + 1} — {formatArabicDate(f)}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const next = nextFridayIn(schedule, date)
              if (next) void load(next)
            }}
            disabled={atLast || loading}
            aria-label="الجمعة التالية"
          >
            <ChevronLeft className="size-4" />
          </Button>
          {loading ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <span className="text-[10px] text-muted-foreground">
              {fridayNo} / {schedule.length}
            </span>
          )}
        </div>
      </div>

      {/* This Friday */}
      <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold",
              view.selected.present
                ? "bg-coptic-teal/15 text-coptic-teal"
                : "bg-destructive/10 text-destructive"
            )}
          >
            <CalendarCheck className="size-3.5" />
            {view.selected.present ? "حاضر" : "غائب"}
          </span>
          <div className="ms-auto text-end">
            <p className="text-[10px] text-muted-foreground">
              {view.selected.totalPoints} / {view.selected.totalMax} نقطة
            </p>
            <p
              className={cn(
                "font-heading text-2xl font-bold",
                percentTone(view.selected.totalPercent)
              )}
            >
              {view.selected.totalPercent}%
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {view.selected.lines.map((line) => (
            <PerFridayRow key={line.key} line={line} />
          ))}
        </div>
      </div>

      {/* Ministry-year total */}
      <div className="flex items-center gap-3 rounded-2xl bg-coptic-gold-soft/30 p-4 ring-1 ring-coptic-gold/10">
        <Trophy className="size-7 text-coptic-gold" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-coptic-gold">إجمالي سنة الخدمة</p>
          <p className="text-[11px] text-muted-foreground">
            {view.yearly.fridays} جمعة · {view.yearly.totalPoints} / {view.yearly.totalMax} نقطة
          </p>
        </div>
        <span className={cn("font-heading text-2xl font-bold", percentTone(view.yearly.totalPercent))}>
          {view.yearly.totalPercent}%
        </span>
      </div>

      {/* History */}
      {view.history.length > 0 && (
        <div className="space-y-2">
          <h3 className="flex items-center gap-1.5 font-heading text-sm font-bold text-muted-foreground">
            <History className="size-4" />
            الجمع السابقة
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {view.history.map((h) => (
              <button
                key={h.date}
                type="button"
                onClick={() => void load(h.date)}
                className="flex items-center gap-2 rounded-xl bg-card px-3 py-2 text-start shadow-sm ring-1 ring-foreground/5 transition-colors hover:bg-secondary/50"
              >
                <span
                  className={cn(
                    "flex size-2.5 shrink-0 rounded-full",
                    h.present ? "bg-coptic-teal" : "bg-destructive"
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-[11px]">
                  {formatArabicDate(h.date)}
                </span>
                <span className={cn("text-[11px] font-bold", percentTone(h.totalPercent))}>
                  {h.totalPercent}%
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PerFridayRow({ line }: { line: FridayScoreLine }) {
  const recordable = line.max > 0
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={cn("size-2.5 shrink-0 rounded-full", recordable ? "bg-coptic-teal/70" : "bg-muted-foreground/30")} />
      <span className="w-36 min-w-0 truncate text-xs font-medium">{line.label}</span>
      {recordable ? (
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-coptic-gold"
            style={{ width: `${Math.min(100, line.percent)}%` }}
          />
        </div>
      ) : (
        <div className="h-1.5 min-w-0 flex-1 rounded-full bg-secondary" />
      )}
      <span className="w-24 text-end text-[10px] text-muted-foreground">
        {line.points} / {line.max}
      </span>
      <span className={cn("w-12 text-end text-[11px] font-bold", recordable ? percentTone(line.percent) : "text-muted-foreground/50")}>
        {recordable ? `${line.percent}%` : "—"}
      </span>
    </div>
  )
}