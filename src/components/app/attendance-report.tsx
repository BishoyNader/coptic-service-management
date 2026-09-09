"use client"

import { useCallback, useEffect, useState } from "react"
import { CalendarSearch, Church, Flame, Loader2, ScanLine } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/coptic/empty-state"
import { getAttendanceReportAction } from "@/app/actions/reports"
import type { AttendanceReport } from "@/services/reports-service"
import { ROLE_LABELS, type AppRole } from "@/lib/roles"
import { addDaysDate } from "@/services/scoring-rules"
import { cairoDateString } from "@/lib/cairo"

const SOURCE_LABELS: Record<"QR" | "CODE" | "MANUAL", string> = {
  QR: "QR",
  CODE: "كود",
  MANUAL: "يدوي",
}

function ReportRangePicker({
  from,
  to,
  onFrom,
  onTo,
  onApply,
  loading,
  label,
  panel,
}: {
  from: string
  to: string
  onFrom: (v: string) => void
  onTo: (v: string) => void
  onApply: () => void
  loading: boolean
  label: string
  panel: string
}) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-2xl bg-card p-3 shadow-sm ring-1 ring-foreground/5">
      <RangeField
        label="من"
        value={from}
        onChange={onFrom}
        testId={`${panel}-from`}
      />
      <RangeField label="إلى" value={to} onChange={onTo} testId={`${panel}-to`} />
      <Button onClick={onApply} disabled={loading} className="gap-1.5" data-testid={`${panel}-apply`}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : <CalendarSearch className="size-4" />}
        عرض التقرير
      </Button>
      <span className="ms-auto text-[11px] text-muted-foreground">{label}</span>
    </div>
  )
}

function RangeField({
  label,
  value,
  onChange,
  testId,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  testId: string
}) {
  return (
    <div className="space-y-1">
      <span className="block text-[11px] text-muted-foreground">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        data-testid={testId}
        className="w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
      />
    </div>
  )
}

export function AttendanceReportPanel() {
  const today = () => cairoDateString(new Date())
  const [from, setFrom] = useState(() => addDaysDate(today(), -30))
  const [to, setTo] = useState(() => today())
  const [resolved, setResolved] = useState({ from: addDaysDate(today(), -30), to: today() })
  const [report, setReport] = useState<AttendanceReport | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true)
    const res = await getAttendanceReportAction({ from, to })
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

  const empty =
    !loading && (!report || report.rows.length === 0)

  return (
    <div className="space-y-4" data-testid="attendance-report">
      <ReportRangePicker
        from={from}
        to={to}
        onFrom={setFrom}
        onTo={setTo}
        onApply={() => setResolved({ from, to })}
        loading={loading}
        label="آخر 30 يوم افتراضيًا"
        panel="attendance-report"
      />

      {loading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          جاري تحميل تقرير الحضور…
        </div>
      ) : empty ? (
        <EmptyState
          icon={<ScanLine className="size-7" />}
          title="لا توجد سجلات حضور في هذه الفترة"
          description="وسّع نطاق التاريخ أو ابدأ تسجيل الحضور أولًا"
        />
      ) : (
        report && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="إجمالي الحضور" value={report.totals.records} />
              <StatCard label="قداس" value={report.totals.church} />
              <StatCard label="خدمة" value={report.totals.service} />
              <StatCard label="النقاط" value={report.totals.points} />
            </div>

            <div className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-foreground/5">
              {report.rows.map((row) => (
                <div
                  key={row.fullName}
                  data-testid="attendance-report-row"
                  className="flex flex-wrap items-center gap-2 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{row.fullName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {ROLE_LABELS[row.role as AppRole]}
                    </p>
                  </div>
                  <Chip icon={<Church className="size-3" />} label={`قداس ${row.church}`} />
                  <Chip icon={<Flame className="size-3" />} label={`خدمة ${row.service}`} />
                  <Chip label={`سجلات ${row.records}`} />
                  <Chip label={`${row.points} نقطة`} gold />
                  <span className="flex gap-1">
                    {(Object.keys(row.source) as Array<keyof typeof row.source>).map(
                      (key) =>
                        row.source[key] > 0 && (
                          <span
                            key={key}
                            className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground"
                          >
                            {SOURCE_LABELS[key]} {row.source[key]}
                          </span>
                        )
                    )}
                  </span>
                </div>
              ))}
            </div>
          </>
        )
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-card p-3 text-center shadow-sm ring-1 ring-foreground/5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-lg font-extrabold text-coptic-teal">{value}</p>
    </div>
  )
}

function Chip({
  icon,
  label,
  gold,
}: {
  icon?: React.ReactNode
  label: string
  gold?: boolean
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${
        gold ? "bg-coptic-gold-soft text-coptic-gold" : "bg-secondary text-muted-foreground"
      }`}
    >
      {icon}
      {label}
    </span>
  )
}
