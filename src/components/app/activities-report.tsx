"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CalendarCheck2, Loader2, Users } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/coptic/empty-state"
import { getActivitiesReportAction } from "@/app/actions/reports"
import { exportActivitiesReportAction } from "@/app/actions/exports"
import type { ActivitiesReport } from "@/services/reports-service"
import { addDaysDate } from "@/services/scoring-rules"
import { cairoDateString } from "@/lib/cairo"
import { ExportButton } from "./export-button"

export function ActivitiesReportPanel() {
  const today = () => cairoDateString(new Date())
  const [from, setFrom] = useState(() => addDaysDate(today(), -30))
  const [to, setTo] = useState(() => today())
  const [resolved, setResolved] = useState({ from: addDaysDate(today(), -30), to: today() })
  const [report, setReport] = useState<ActivitiesReport | null>(null)
  const [loading, setLoading] = useState(true)
  const requestIdRef = useRef(0)

  const load = useCallback(async (from: string, to: string) => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    const res = await getActivitiesReportAction({ from, to })
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

  return (
    <div className="space-y-4" data-testid="activities-report">
      <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-card p-3 shadow-sm ring-1 ring-foreground/5">
        <span className="text-[11px] text-muted-foreground">من</span>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="من"
          data-testid="activities-report-from"
          className="rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
        />
        <span className="text-[11px] text-muted-foreground">إلى</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="إلى"
          data-testid="activities-report-to"
          className="rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
        />
        <Button
          onClick={() => setResolved({ from, to })}
          disabled={loading}
          className="gap-1.5"
          data-testid="activities-report-apply"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <CalendarCheck2 className="size-4" />}
          عرض التقرير
        </Button>
        <span className="ms-auto text-[11px] text-muted-foreground">آخر 30 يوم افتراضيًا</span>
      </div>

      {!loading && report && report.byActivity.length > 0 ? (
        <div className="flex justify-end">
          <ExportButton
            action={() => exportActivitiesReportAction({ from: resolved.from, to: resolved.to })}
            label="تصدير CSV"
          />
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          جاري تحميل تقرير الأنشطة…
        </div>
      ) : !report || report.byActivity.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck2 className="size-7" />}
          title="لا توجد أنشطة مسجلة في هذه الفترة"
          description="سجّل أنشطة الخدام أولًا أو وسّع نطاق التاريخ"
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-card p-3 text-center shadow-sm ring-1 ring-foreground/5">
              <p className="text-[11px] text-muted-foreground">إجمالي الأنشطة</p>
              <p className="mt-1 font-heading text-lg font-extrabold text-coptic-teal">
                {report.total}
              </p>
            </div>
            <div className="rounded-2xl bg-card p-3 text-center shadow-sm ring-1 ring-foreground/5">
              <p className="text-[11px] text-muted-foreground">خدام مشتركين</p>
              <p className="mt-1 font-heading text-lg font-extrabold text-coptic-gold">
                {report.servants}
              </p>
            </div>
          </div>

          <section className="space-y-2">
            <h2 className="font-heading text-sm font-bold text-muted-foreground">حسب النشاط</h2>
            <div className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-foreground/5">
              {report.byActivity.map((activity) => (
                <div
                  key={activity.code}
                  data-testid="activity-row"
                  className="flex flex-wrap items-center gap-2 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{activity.name}</p>
                    <p className="text-[11px] text-muted-foreground" dir="ltr">
                      {activity.code}
                    </p>
                  </div>
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
                    {activity.count} مرة
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-coptic-gold-soft px-2.5 py-1 text-[11px] font-bold text-coptic-gold">
                    <Users className="size-3" />
                    {activity.servants}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="font-heading text-sm font-bold text-muted-foreground">حسب الخادم</h2>
            <div className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-foreground/5">
              {report.rows.map((row) => (
                <div key={row.fullName} data-testid="activity-servant-row" className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold">{row.fullName}</p>
                    <span className="font-heading text-sm font-extrabold text-coptic-teal">
                      {row.total} نشاط
                    </span>
                  </div>
                  {Object.keys(row.activities).length > 0 ? (
                    <p className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                      {Object.entries(row.activities)
                        .map(([code, count]) => `${report.byActivity.find((a) => a.code === code)?.name ?? code} (${count})`)
                        .join(" • ")}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
