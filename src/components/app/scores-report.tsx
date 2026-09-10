"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { BarChart3, Crown, Loader2, Star } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/coptic/empty-state"
import { getScoresReportAction } from "@/app/actions/reports"
import { exportScoresReportAction } from "@/app/actions/exports"
import type { ScoresReport } from "@/services/reports-service"
import { ROLE_LABELS, type AppRole } from "@/lib/roles"
import { SCORING_CATEGORY_LABELS, type ScoringCategory } from "@/lib/constants"
import { periodForDate, type ScorePeriod } from "@/services/scoring-rules"
import { ExportButton } from "./export-button"

function ScoresRangePicker({
  month,
  from,
  to,
  onFrom,
  onTo,
  onApply,
  loading,
}: {
  month: ScorePeriod | null
  from: string
  to: string
  onFrom: (v: string) => void
  onTo: (v: string) => void
  onApply: () => void
  loading: boolean
}) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-card p-3 shadow-sm ring-1 ring-foreground/5">
      <span className="text-[11px] text-muted-foreground">من</span>
      <input
        type="date"
        value={from}
        onChange={(e) => onFrom(e.target.value)}
        aria-label="من"
        data-testid="scores-report-from"
        className="rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
      />
      <span className="text-[11px] text-muted-foreground">إلى</span>
      <input
        type="date"
        value={to}
        onChange={(e) => onTo(e.target.value)}
        aria-label="إلى"
        data-testid="scores-report-to"
        className="rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
      />
      <Button onClick={onApply} disabled={loading} className="gap-1.5" data-testid="scores-report-apply">
        {loading ? <Loader2 className="size-4 animate-spin" /> : <BarChart3 className="size-4" />}
        عرض التقرير
      </Button>
      {month ? (
        <span className="ms-auto text-[11px] text-muted-foreground">
          شهر {month.label} افتراضيًا
        </span>
      ) : null}
    </div>
  )
}

export function ScoresReportPanel() {
  const initialMonth = periodForDate("MONTHLY", new Date())
  const [from, setFrom] = useState(initialMonth.startDate)
  const [to, setTo] = useState(initialMonth.endDate)
  const [resolved, setResolved] = useState({
    from: initialMonth.startDate,
    to: initialMonth.endDate,
  })
  const [report, setReport] = useState<ScoresReport | null>(null)
  const [loading, setLoading] = useState(true)
  const requestIdRef = useRef(0)

  const load = useCallback(async (from: string, to: string) => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    const res = await getScoresReportAction({ from, to })
    if (requestId !== requestIdRef.current) return
    setLoading(false)
    if (res.ok) setReport(res.data)
    else toast.error(res.message)
  }, [])

  useEffect(() => {
    const run = async () => {
      await load(resolved.from, resolved.to)
    }
    void run()
  }, [resolved, load])

  const periodMatchesWindow =
    resolved.from === initialMonth.startDate && resolved.to === initialMonth.endDate

  return (
    <div className="space-y-4" data-testid="scores-report">
      <ScoresRangePicker
        month={periodMatchesWindow ? initialMonth : null}
        from={from}
        to={to}
        onFrom={setFrom}
        onTo={setTo}
        onApply={() => setResolved({ from, to })}
        loading={loading}
      />

      {!loading && report && report.rows.length > 0 ? (
        <div className="flex justify-end">
          <ExportButton
            action={() => exportScoresReportAction({ from: resolved.from, to: resolved.to })}
            label="تصدير CSV"
          />
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          جاري تحميل تقرير الدرجات…
        </div>
      ) : !report || report.rows.length === 0 ? (
        <EmptyState
          icon={<Star className="size-7" />}
          title="لا توجد درجات مسجلة في هذه الفترة"
          description="سجّل درجات المخدومين أولًا أو وسّع نطاق التاريخ"
        />
      ) : (
        <>
          <div className="rounded-2xl bg-card p-4 text-center shadow-sm ring-1 ring-foreground/5">
            <p className="text-[11px] text-muted-foreground">إجمالي الدرجات في الفترة</p>
            <p className="mt-1 font-heading text-2xl font-extrabold text-coptic-gold">
              {report.total} نقطة
            </p>
          </div>

          <div className="space-y-2">
            {report.rows.map((row, index) => (
              <div
                key={row.fullName}
                data-testid="scores-report-row"
                className="rounded-2xl bg-card p-3 shadow-sm ring-1 ring-foreground/5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold ${
                      index === 0 ? "bg-coptic-gold-soft text-coptic-gold" : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{row.fullName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {ROLE_LABELS[row.role as AppRole]}
                    </p>
                  </div>
                  {index === 0 ? <Crown className="size-4 text-coptic-gold" /> : null}
                  <span className="font-heading text-base font-extrabold text-coptic-teal">
                    {row.total}
                  </span>
                </div>
                {Object.keys(row.categories).length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(Object.keys(row.categories) as ScoringCategory[]).map((cat) => (
                      <span
                        key={cat}
                        className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-bold text-muted-foreground"
                      >
                        {SCORING_CATEGORY_LABELS[cat]} +{row.categories[cat]}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
