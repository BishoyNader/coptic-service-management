"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, ChevronLeft, Loader2, Trash2 } from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"
import { ATTENDANCE_TYPE_LABELS, ATTENDANCE_SOURCE_LABELS } from "@/lib/constants"
import { ROLE_LABELS, type AppRole } from "@/lib/roles"
import { cairoDateString, formatCairoDateTime } from "@/lib/cairo"
import type {
  AttendanceSource,
  AttendanceStatus,
  AttendanceType,
} from "@/lib/types"
import { correctAttendanceAction } from "@/app/actions/attendance"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export type AttendanceRow = {
  id: string
  attended_at: string
  points: number
  source: AttendanceSource
  status: AttendanceStatus
  type: AttendanceType
  fullName: string
  role: AppRole
}

type AttendanceManagementProps = {
  records: AttendanceRow[]
}

export function AttendanceManagement({ records }: AttendanceManagementProps) {
  const router = useRouter()
  const [date, setDate] = useState("")
  const [typeFilter, setTypeFilter] = useState<"ALL" | AttendanceType>("ALL")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<AttendanceRow | null>(null)
  const [confirmVoid, setConfirmVoid] = useState(false)
  const [pending, setPending] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return records
      .filter((r) => {
        if (date && cairoDateString(new Date(r.attended_at)) !== date) return false
        if (typeFilter !== "ALL" && r.type !== typeFilter) return false
        if (q && !r.fullName.toLowerCase().includes(q)) return false
        return true
      })
      .sort((a, b) => b.attended_at.localeCompare(a.attended_at))
  }, [records, date, typeFilter, query])

  const todayCount = records.filter(
    (r) => cairoDateString(new Date(r.attended_at)) === cairoDateString(new Date())
  ).length

  const applyChange = async (change: { type?: AttendanceType } | { voided: true }) => {
    if (!selected) return
    setPending(true)
    const res = await correctAttendanceAction(selected.id, change)
    setPending(false)
    setSelected(null)
    setConfirmVoid(false)
    if (res.ok) {
      toast.success(res.message)
      router.refresh()
    } else {
      toast.error(res.message)
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث بالاسم…"
            className="w-full rounded-xl border border-input bg-transparent px-4 py-2.5 pr-9 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
          />
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            aria-label="فلترة بالتاريخ"
            className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
          />
          <div className="flex items-center gap-1 rounded-xl bg-secondary/60 p-1">
            {(["ALL", "CHURCH", "SERVICE"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter(t)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                  typeFilter === t
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t === "ALL" ? "الكل" : ATTENDANCE_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {todayCount} حضور النهارده — {filtered.length} نتيجة فلترة
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/60 px-6 py-10 text-center">
          <p className="font-heading font-semibold text-foreground">مفيش سجلات حضور</p>
          <p className="mt-1 text-sm text-muted-foreground">ابدأ بتسجيل أول حضور 📷</p>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {filtered.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(r)}
                className="flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-start shadow-sm ring-1 ring-foreground/5 transition-colors hover:bg-secondary/40"
              >
                <RecordInitials name={r.fullName} role={r.role} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {r.fullName}
                    {r.status === "ARCHIVED" ? (
                      <span className="ms-1.5 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
                        ملغي
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {ATTENDANCE_TYPE_LABELS[r.type]} — {formatCairoDateTime(r.attended_at)}
                  </p>
                </div>
                <Points points={r.points} role={r.role} />
                <ChevronLeft className="size-4 text-muted-foreground" />
              </button>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-foreground/5 md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-start text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 text-start font-medium">الاسم</th>
                  <th className="px-4 py-2.5 text-start font-medium">النوع</th>
                  <th className="px-4 py-2.5 text-start font-medium">التاريخ والوقت</th>
                  <th className="px-4 py-2.5 text-start font-medium">النقاط</th>
                  <th className="px-4 py-2.5 text-start font-medium">الطريقة</th>
                  <th className="px-4 py-2.5 text-start font-medium">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(r)}
                    className="cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-secondary/40"
                  >
                    <td className="px-4 py-2.5 font-medium">{r.fullName}</td>
                    <td className="px-4 py-2.5">{ATTENDANCE_TYPE_LABELS[r.type]}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {formatCairoDateTime(r.attended_at)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Points points={r.points} role={r.role} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {ATTENDANCE_SOURCE_LABELS[r.source]}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.status === "ARCHIVED" ? (
                        <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-[11px] font-bold text-destructive">
                          ملغي
                        </span>
                      ) : (
                        <span className="rounded-full bg-coptic-teal/10 px-2.5 py-0.5 text-[11px] font-bold text-coptic-teal">
                          مسجّل
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Detail dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تفاصيل الحضور</DialogTitle>
            <DialogDescription>
              {selected ? `${selected.fullName} — ${ROLE_LABELS[selected.role]}` : null}
            </DialogDescription>
          </DialogHeader>

          {selected ? (
            <div className="space-y-2">
              <Row label="النوع" value={selected.status === "ARCHIVED" ? "ملغي" : ATTENDANCE_TYPE_LABELS[selected.type]} />
              <Row label="التاريخ والوقت" value={formatCairoDateTime(selected.attended_at)} />
              <Row
                label="النقاط"
                value={
                  selected.role === "SERVANT"
                    ? "بدون نقاط (خادم)"
                    : selected.points > 0
                      ? `+${selected.points} نقطة`
                      : "خارج نطاق التقييم"
                }
              />
              <Row label="الطريقة" value={ATTENDANCE_SOURCE_LABELS[selected.source]} />
            </div>
          ) : null}

          {selected && selected.status !== "ARCHIVED" ? (
            <>
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">تصحيح نوع الحضور</p>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary/60 p-1">
                  {(Object.keys(ATTENDANCE_TYPE_LABELS) as AttendanceType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      disabled={pending || selected.type === t}
                      onClick={() => void applyChange({ type: t })}
                      className={cn(
                        "rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-40",
                        selected.type === t
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {ATTENDANCE_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="destructive"
                  className="gap-1.5"
                  disabled={pending}
                  onClick={() => setConfirmVoid(true)}
                >
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  إلغاء تسجيل الحضور
                </Button>
              </DialogFooter>
            </>
          ) : null}

          {selected && selected.status === "ARCHIVED" ? (
            <p className="rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
              هذا السجل تم إلغاؤه ولا يظهر في النقاط أو التاريخ.
            </p>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Void confirmation */}
      <AlertDialog open={confirmVoid} onOpenChange={setConfirmVoid}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2 className="size-6" />
            </AlertDialogMedia>
            <AlertDialogTitle>إلغاء تسجيل الحضور؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم إلغاء السجل والحفاظ عليه مؤرشفًا في السجل التاريخي. لا يمكن التراجع عن هذا
              الإجراء من الواجهة.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>تراجع</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={() => void applyChange({ voided: true })}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              تأكيد الإلغاء
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function RecordInitials({ name, role }: { name: string; role: AppRole }) {
  return (
    <div
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-xl font-heading font-bold",
        role === "SERVANT" ? "bg-coptic-teal/10 text-coptic-teal" : "bg-coptic-gold-soft text-coptic-gold"
      )}
    >
      {name.trim().charAt(0)}
    </div>
  )
}

function Points({ points, role }: { points: number; role: AppRole }) {
  if (role === "SERVANT") {
    return <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-bold text-muted-foreground">—</span>
  }
  if (points <= 0) {
    return <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-bold text-muted-foreground">بدون نقاط</span>
  }
  return (
    <span className="rounded-full bg-coptic-gold-soft px-2.5 py-0.5 text-[11px] font-bold text-coptic-gold">
      +{points}
    </span>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-secondary/50 px-3 py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}