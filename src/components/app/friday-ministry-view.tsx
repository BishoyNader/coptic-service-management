"use client"

import { useCallback, useState } from "react"
import { Check, ChevronLeft, ChevronRight, Loader2, UserX, Users } from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/coptic/empty-state"
import { getFridayMinistryDataAction } from "@/app/actions/friday"
import type { FridayMinistryData, FridayScoreLine } from "@/services/friday-service"
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

function AttendanceChip({ present }: { present: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
        present ? "bg-coptic-teal/15 text-coptic-teal" : "bg-destructive/10 text-destructive"
      )}
    >
      {present ? "حاضر" : "غائب"}
    </span>
  )
}

/**
 * Combined per-Friday review used by servants and admins: who attended
 * (حاضر/غائب), every served member's Friday percentages, and every servant's
 * activity completion (نعم/لا). No numerical servant score is ever shown.
 */
export function FridayMinistryView({ initial }: { initial: FridayMinistryData }) {
  const [data, setData] = useState<FridayMinistryData>(initial)
  const [loading, setLoading] = useState(false)
  const schedule = data.year.schedule

  const load = useCallback(async (friday: string) => {
    setLoading(true)
    const res = await getFridayMinistryDataAction(friday)
    setLoading(false)
    if (res.ok) setData(res.data)
    else toast.error(res.message)
  }, [])

  const atFirst = schedule.length === 0 || data.date === schedule[0]
  const atLast = !nextFridayIn(schedule, data.date)
  const fridayNo = fridayIndexIn(schedule, data.date) + 1

  const everyone = [...data.servants, ...data.members]
  const presentCount = everyone.filter((p) => p.present).length
  const absentCount = everyone.length - presentCount

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="font-heading text-sm font-bold text-muted-foreground">
            متابعة الخدمة — جمعة {fridayNo}
          </h2>
          <p className="text-xs text-muted-foreground">
            {formatArabicDate(data.date)} — حاضر {presentCount} · غائب {absentCount}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const prev = previousFridayIn(schedule, data.date)
              if (prev) void load(prev)
            }}
            disabled={atFirst || loading}
            aria-label="الجمعة السابقة"
          >
            <ChevronRight className="size-4" />
          </Button>
          <select
            aria-label="اختار جمعة"
            value={data.date}
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
              const next = nextFridayIn(schedule, data.date)
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

      {/* Attendance recap */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full bg-coptic-teal/10 px-2.5 py-1 font-bold text-coptic-teal">
          {presentCount} حاضر
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-1 font-bold text-destructive">
          <UserX className="size-3" />
          {absentCount} غائب
        </span>
      </div>

      {/* Servants */}
      <section aria-label="الخدام" className="space-y-2">
        <h3 className="font-heading text-sm font-bold text-muted-foreground">الخدام — الأنشطة</h3>
        {data.servants.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-card/60 px-4 py-4 text-center text-sm text-muted-foreground">
            لا يوجد خدام نشطين
          </p>
        ) : (
          <div className="space-y-2">
            {data.servants.map((s) => (
              <div key={s.id} data-testid={`ministry-servant-${s.id}`} className="rounded-2xl bg-card p-3 shadow-sm ring-1 ring-foreground/5">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-coptic-gold-soft text-[11px] font-bold text-coptic-gold">
                    {s.full_name.trim().charAt(0)}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{s.full_name}</p>
                  <AttendanceChip present={s.present} />
                </div>
                {s.activities.length === 0 ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    مفيش أنشطة خدام مفعّلة
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.activities.map((a) => (
                      <span
                        key={a.activityId}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                          a.recorded ? "bg-coptic-teal/15 text-coptic-teal" : "bg-muted text-muted-foreground"
                        )}
                      >
                        {a.name}
                        {a.recorded ? <Check className="size-3" /> : <span>— لا</span>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Served members */}
      <section aria-label="المخدومين" className="space-y-2">
        <h3 className="font-heading text-sm font-bold text-muted-foreground">
          المخدومين — درجات الجمعة
        </h3>
        {data.members.length === 0 ? (
          <EmptyState
            icon={<Users className="size-6" />}
            title="لا يوجد مخدومين"
            description="مفيش مخدومين نشطين لعرض نتائجهم"
          />
        ) : (
          <div className="space-y-2">
            {data.members.map((m) => (
              <div key={m.id} data-testid={`ministry-member-${m.id}`} className="rounded-2xl bg-card p-3 shadow-sm ring-1 ring-foreground/5">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-coptic-gold-soft text-[11px] font-bold text-coptic-gold">
                    {m.full_name.trim().charAt(0)}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{m.full_name}</p>
                  <AttendanceChip present={m.present} />
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold",
                      percentTone(m.totalPercent)
                    )}
                  >
                    {m.totalPercent}%
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.lines.map((line) => (
                    <ScoreChip key={line.key} line={line} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ScoreChip({ line }: { line: FridayScoreLine }) {
  const recordable = line.max > 0
  if (!recordable) return null
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-lg bg-secondary/50 px-2 py-1 text-[10px] font-medium text-muted-foreground"
      )}
    >
      {line.label}
      <b className={cn("text-[10px]", percentTone(line.percent))}>
        {line.percent}%
      </b>
      <span className="text-[10px] text-muted-foreground/70">
        {line.points}/{line.max}
      </span>
    </span>
  )
}