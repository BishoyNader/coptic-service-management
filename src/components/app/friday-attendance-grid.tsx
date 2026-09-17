"use client"

import { useCallback, useState } from "react"
import { ChevronLeft, ChevronRight, Loader2, Users } from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/coptic/empty-state"
import { getFridayAttendanceGridAction } from "@/app/actions/friday"
import type { FridayAttendanceGrid } from "@/services/friday-service"
import {
  fridayIndexIn,
  nextFridayIn,
  previousFridayIn,
} from "@/lib/friday"
import { formatArabicDate } from "@/lib/dates"

function compactFriday(date: string): string {
  const d = new Date(`${date}T12:00:00`)
  return `${d.getDate()}/${d.getMonth() + 1}`
}

/**
 * Friday-based attendance grid for servants and admins.
 *
 * Columns are ministry Fridays (present/absent), never calendar days — the
 * ministry tracks attendance on Fridays only. Absence is explicit: a person
 * with no attendance record on a Friday shows غائب on a red chip; a missing
 * score is never interpreted as absence.
 */
export function FridayAttendanceGrid({ initialGrid }: { initialGrid: FridayAttendanceGrid }) {
  const [grid, setGrid] = useState<FridayAttendanceGrid>(initialGrid)
  const [loading, setLoading] = useState(false)
  const schedule = grid.year.schedule

  const load = useCallback(async (friday: string) => {
    setLoading(true)
    const res = await getFridayAttendanceGridAction(friday)
    setLoading(false)
    if (res.ok) {
      setGrid(res.grid)
    } else {
      toast.error(res.message)
    }
  }, [])

  const atFirst = schedule.length === 0 || grid.date === schedule[0]
  const atLast = !nextFridayIn(schedule, grid.date)

  const presentCount = grid.people.filter((p) => p.rows.at(-1)?.present).length
  const absentCount = grid.people.length - presentCount
  const fridayNo = fridayIndexIn(schedule, grid.date) + 1

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="font-heading text-sm font-bold text-muted-foreground">
            حضور الجمعة — جمعة {fridayNo}
          </h2>
          <p className="text-xs text-muted-foreground">
            {formatArabicDate(grid.date)} — حاضر {presentCount} · غائب {absentCount}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const prev = previousFridayIn(schedule, grid.date)
              if (prev) void load(prev)
            }}
            disabled={atFirst || loading}
            aria-label="الجمعة السابقة"
          >
            <ChevronRight className="size-4" />
          </Button>
          <select
            aria-label="اختار جمعة"
            value={grid.date}
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
              const next = nextFridayIn(schedule, grid.date)
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

      {grid.people.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6" />}
          title="لا يوجد خدام أو مخدومين"
          description="مفيش حسابات نشطة لعرض الحضور"
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="bg-card">
                <th
                  scope="col"
                  className="sticky inset-inline-start-0 z-10 bg-card px-3 py-2 text-end text-[11px] font-bold text-muted-foreground"
                  style={{ position: "sticky" }}
                >
                  الاسم
                </th>
                {grid.window.map((w) => (
                  <th
                    key={w}
                    scope="col"
                    className={cn(
                      "px-2 py-2 text-center text-[11px] font-bold",
                      w === grid.date ? "text-coptic-gold" : "text-muted-foreground"
                    )}
                  >
                    {compactFriday(w)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.people.map((person) => (
                <tr key={person.id} data-testid={`grid-person-${person.id}`} className="bg-card">
                  <td
                    className="sticky inset-inline-start-0 z-10 bg-card px-3 py-2"
                    style={{ position: "sticky" }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-coptic-gold-soft text-[11px] font-bold text-coptic-gold">
                        {person.full_name.trim().charAt(0)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">{person.full_name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {person.role === "SERVANT" ? "خادم" : "مخدوم"}
                        </p>
                      </div>
                    </div>
                  </td>
                  {person.rows.map((row) => (
                    <td
                      key={row.date}
                      className={cn(
                        "px-2 py-2 text-center align-middle",
                        row.date === grid.date && "bg-secondary/40"
                      )}
                    >
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                          row.present
                            ? "bg-coptic-teal/15 text-coptic-teal"
                            : "bg-destructive/10 text-destructive"
                        )}
                      >
                        {row.present ? "حاضر" : "غائب"}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        الغياب يظهر بوضوح بجانب الحضور — الغياب مش تقييم، وغياب الدرجات مش غياب.
        الحضور يُسجَّل يوم الجمعة فقط.
      </p>
    </div>
  )
}