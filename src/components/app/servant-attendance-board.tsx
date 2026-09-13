"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  Camera,
  Check,
  HandHelping,
  Loader2,
  Search,
  Users,
  X,
} from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"
import { ATTENDANCE_TYPE_LABELS } from "@/lib/constants"
import { ROLE_LABELS, ROLES } from "@/lib/roles"
import { formatCairoTime } from "@/lib/cairo"
import type { AttendanceType } from "@/lib/types"
import {
  fetchAttendanceBoardPageAction,
  manualAttendanceAction,
  type BoardPerson,
} from "@/app/actions/attendance"
import { AttendanceCheckIn } from "@/components/app/attendance-check-in"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

type BoardTab = "SERVANT" | "SERVED_MEMBER"

type Summary = {
  servantsPresent: number
  membersPresent: number
  ownPresent: boolean
}

type ServantAttendanceBoardProps = {
  initialServants: BoardPerson[]
  initialMembers: BoardPerson[]
  servantsTotal: number
  membersTotal: number
  summary: Summary
  todayLabel: string
  actorId: string
}

/**
 * Attendance board for SERVANT: a compact QR scanner, two tabs (خدام /
 * مخدومين), per-person today status and a fast record dialog. All recording
 * goes through the server actions; attendance is stored centrally and the
 * authoritative state always comes from the database.
 *
 * Synchronization: mutations trigger `router.refresh()`, which re-fetches the
 * server-rendered page (board lists, summary counts, duplicates) so every
 * already-open browser sees the same database-backed result after a refresh.
 * This is NOT live realtime: an open page on another device does not repaint
 * until it refreshes or navigates (Supabase Realtime is intentionally not
 * configured in this phase).
 */
export function ServantAttendanceBoard({
  initialServants,
  initialMembers,
  servantsTotal,
  membersTotal,
  summary,
  todayLabel,
  actorId,
}: ServantAttendanceBoardProps) {
  const router = useRouter()

  const [tab, setTab] = useState<BoardTab>("SERVANT")
  const [servants, setServants] = useState<BoardPerson[]>(initialServants)
  const [members, setMembers] = useState<BoardPerson[]>(initialMembers)
  const [totals, setTotals] = useState({ SERVANT: servantsTotal, SERVED_MEMBER: membersTotal })
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [selected, setSelected] = useState<BoardPerson | null>(null)
  const queryRef = useRef(query)
  const tabRef = useRef(tab)
  useEffect(() => {
    queryRef.current = query
  }, [query])
  useEffect(() => {
    tabRef.current = tab
  }, [tab])

  // After a router.refresh() the server sends authoritative page-0 data for
  // both tabs. Reconcile state when there is no active client search so the
  // board always mirrors the database.
  useEffect(() => {
    if (queryRef.current.trim()) return
    setServants(initialServants)
    setMembers(initialMembers)
    setTotals({ SERVANT: servantsTotal, SERVED_MEMBER: membersTotal })
  }, [initialServants, initialMembers, servantsTotal, membersTotal])

  const currentList = tab === "SERVANT" ? servants : members
  const setCurrentList = (next: BoardPerson[]) =>
    tab === "SERVANT" ? setServants(next) : setMembers(next)

  const runSearch = async () => {
    setSearching(true)
    const res = await fetchAttendanceBoardPageAction({
      role: tabRef.current,
      query: queryRef.current,
      offset: 0,
    })
    if (res.ok) {
      setCurrentList(res.people)
      setTotals((t) => ({ ...t, [tabRef.current]: res.total }))
    } else {
      toast.error(res.message ?? "تعذر البحث")
    }
    setSearching(false)
  }

  const loadMore = async () => {
    setLoadingMore(true)
    const res = await fetchAttendanceBoardPageAction({
      role: tabRef.current,
      query: queryRef.current,
      offset: currentList.length,
    })
    if (res.ok) {
      const seen = new Set(currentList.map((p) => p.id))
      setCurrentList([...currentList, ...res.people.filter((p) => !seen.has(p.id))])
      setTotals((t) => ({ ...t, [tabRef.current]: res.total }))
    } else {
      toast.error(res.message ?? "تعذر تحميل المزيد")
    }
    setLoadingMore(false)
  }

  const markPresent = (personId: string, attendance: BoardPerson["attendance"]) => {
    const apply = (list: BoardPerson[]) =>
      list.map((p) => (p.id === personId ? { ...p, attendance } : p))
    setServants((prev) => apply(prev))
    setMembers((prev) => apply(prev))
  }

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="space-y-1">
        <h1 className="text-balance font-heading text-2xl font-extrabold">الحضور</h1>
        <p className="text-sm text-muted-foreground">
          سجّل حضور الخدام والمخدومين بسهولة — {todayLabel}
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <SummaryChip
          icon={<HandHelping className="size-4" />}
          label="خدام حاضرين"
          value={summary.servantsPresent}
        />
        <SummaryChip
          icon={<Users className="size-4" />}
          label="مخدومين حاضرين"
          value={summary.membersPresent}
        />
      </div>
      {!summary.ownPresent ? (
        <p className="rounded-xl bg-coptic-gold-soft/40 px-3 py-2 text-sm text-coptic-gold">
          لسه ماسجلتش حضورك اليوم — سجّله من قائمة الخدام
        </p>
      ) : null}

      {/* Compact QR scanner toggle */}
      <button
        type="button"
        onClick={() => setScannerOpen((o) => !o)}
        aria-expanded={scannerOpen}
        aria-label="فتح الماسح الضوئي"
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold transition-colors",
          scannerOpen
            ? "bg-secondary text-secondary-foreground"
            : "bg-coptic-teal text-primary-foreground shadow-sm"
        )}
      >
        {scannerOpen ? <X className="size-5" /> : <Camera className="size-5" />}
        {scannerOpen ? "إغلاق الماسح" : "مسح QR — تسجيل بالـ QR"}
      </button>

      {scannerOpen ? (
        <div className="rounded-2xl bg-secondary/40 p-1 ring-1 ring-foreground/5">
          <AttendanceCheckIn defaultType="CHURCH" />
        </div>
      ) : null}

      {/* Tabs */}
      <div role="tablist" aria-label="قائمة الحضور" className="grid grid-cols-2 gap-1 rounded-2xl bg-secondary/60 p-1">
        {(["SERVANT", "SERVED_MEMBER"] as BoardTab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`panel-${tab}`}
            onClick={() => setTab(t)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold transition-colors",
              tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "SERVANT" ? <HandHelping className="size-4" /> : <Users className="size-4" />}
            {t === "SERVANT" ? "الخدام" : "المخدومين"}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                void runSearch()
              }
            }}
            aria-label="ابحث بالاسم"
            placeholder="ابحث بالاسم…"
            className="h-11 w-full rounded-xl border border-input bg-transparent ps-9 pe-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
          />
        </div>
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={searching}
          className="flex h-11 w-24 items-center justify-center gap-1.5 rounded-xl bg-coptic-teal text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          بحث
        </button>
      </div>

      {/* People list */}
      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        className="space-y-2"
      >
        {currentList.length === 0 && !searching ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card/60 px-6 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
              <Users className="size-6" />
            </div>
            <p className="font-heading font-semibold">
              {query.trim()
                ? "مفيش نتايج مطابقة"
                : tab === "SERVANT"
                  ? "مفيش خدام متاحين"
                  : "مفيش مخدومين متاحين"}
            </p>
            <p className="text-sm text-muted-foreground">
              {query.trim() ? "جرب اسم تاني" : "هيظهر هُنا الشخصيات النشطة"}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {currentList.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                onRecord={() => setSelected(person)}
              />
            ))}
          </ul>
        )}

        {totals[tab] > currentList.length ? (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-card py-3 text-sm font-medium shadow-sm ring-1 ring-foreground/5 transition-colors hover:bg-secondary/50 disabled:opacity-50"
          >
            {loadingMore ? <Loader2 className="size-4 animate-spin" /> : null}
            تحميل المزيد
          </button>
        ) : null}
      </div>

      {/* Record dialog */}
      <RecordDialog
        key={selected?.id ?? "none"}
        person={selected}
        actorId={actorId}
        onRecorded={(attendance) => {
          if (selected) markPresent(selected.id, attendance)
          router.refresh()
        }}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}

function SummaryChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: number
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
      <span className="flex size-9 items-center justify-center rounded-xl bg-coptic-teal/10 text-coptic-teal">
        {icon}
      </span>
      <div className="leading-tight">
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        <p className="font-heading text-lg font-extrabold text-foreground">{value}</p>
      </div>
    </div>
  )
}

function PersonRow({
  person,
  onRecord,
}: {
  person: BoardPerson
  onRecord: () => void
}) {
  const present = !!person.attendance
  const inactive = person.status !== "ACTIVE"

  return (
    <li className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-coptic-gold-soft font-heading font-bold text-coptic-gold">
        {person.fullName.trim().charAt(0)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium">{person.fullName}</p>
          {person.isMe ? (
            <span className="shrink-0 rounded-full bg-coptic-teal/10 px-2 py-0.5 text-[10px] font-bold text-coptic-teal">
              أنت
            </span>
          ) : null}
        </div>
        {inactive ? (
          <p className="text-[11px] text-destructive">غير نشط</p>
        ) : present ? (
          <p className="text-[11px] text-muted-foreground">
            {formatCairoTime(person.attendance!.attended_at)} ·{" "}
            {ATTENDANCE_TYPE_LABELS[person.attendance!.type]}
            {person.role === "SERVED_MEMBER" && person.attendance!.points > 0
              ? ` · +${person.attendance!.points} نقطة`
              : ""}
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">لم يسجل الحضور</p>
        )}
      </div>
      <button
        type="button"
        onClick={onRecord}
        disabled={inactive || present}
        className={cn(
          "flex shrink-0 items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          present
            ? "bg-secondary text-muted-foreground"
            : "bg-coptic-teal text-primary-foreground"
        )}
        aria-label={`تسجيل حضور ${person.fullName}`}
      >
        {present ? <Check className="size-3.5" /> : null}
        {present ? "تم التسجيل" : "تسجيل حضور"}
      </button>
    </li>
  )
}

function RecordDialog({
  person,
  actorId,
  onRecorded,
  onClose,
}: {
  person: BoardPerson | null
  actorId: string
  onRecorded: (attendance: NonNullable<BoardPerson["attendance"]>) => void
  onClose: () => void
}) {
  const [type, setType] = useState<AttendanceType>("CHURCH")
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<
    { kind: "success" | "duplicate" | "error"; message: string; points?: number } | null
  >(null)

  if (!person) return null

  const inactive = person.status !== "ACTIVE"

  const confirm = async () => {
    setBusy(true)
    setFeedback(null)
    const res = await manualAttendanceAction(person.id, type)
    setBusy(false)

    if (res.status === "success") {
      setFeedback({
        kind: "success",
        message: "تم تسجيل الحضور",
        points: res.points,
      })
      onRecorded({
        attended_at: res.attendedAt!,
        type: res.type!,
        source: res.source!,
        points: res.points ?? 0,
      })
    } else if (res.status === "duplicate") {
      setFeedback({ kind: "duplicate", message: "تم تسجيل الحضور بالفعل" })
      onRecorded({
        attended_at: res.attendedAt!,
        type: res.type!,
        source: "MANUAL",
        points: res.points ?? 0,
      })
    } else {
      setFeedback({ kind: "error", message: res.message ?? "تعذر تسجيل الحضور" })
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تسجيل حضور</DialogTitle>
          <DialogDescription>اختر نوع الحضور ثم أكّد التسجيل</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl bg-coptic-teal/10 px-4 py-3 ring-1 ring-coptic-teal/30">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-coptic-teal font-heading text-lg font-extrabold text-primary-foreground">
              {person.fullName.trim().charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-heading font-bold">{person.fullName}</p>
              <p className="text-xs text-muted-foreground">
                {ROLE_LABELS[person.role]}
                {person.id === actorId ? " — أنت" : ""}
              </p>
            </div>
          </div>

          {inactive ? (
            <p className="flex items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              هذا الحساب غير نشط — لا يمكن تسجيل الحضور
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary/60 p-1">
                {(Object.keys(ATTENDANCE_TYPE_LABELS) as AttendanceType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={type === t}
                    onClick={() => {
                      setType(t)
                      setFeedback(null)
                    }}
                    className={cn(
                      "rounded-lg py-2.5 text-sm font-medium transition-colors",
                      type === t
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {ATTENDANCE_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>

              {person.role === "SERVED_MEMBER" ? (
                <p className="text-xs text-muted-foreground">
                  النقاط بتتحسب تلقائيًا من قوانين الحضور وتضاف لحساب {person.fullName}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  تسجيل حضور الخدام بدون نقاط
                </p>
              )}
            </>
          )}

          {feedback ? (
            feedback.kind === "error" ? (
              <p role="alert" className="flex items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                {feedback.message}
              </p>
            ) : (
              <div
                role="status"
                className="flex items-center justify-between gap-2 rounded-xl bg-coptic-teal/10 px-3 py-2.5 text-sm text-coptic-teal"
              >
                <span className="flex items-center gap-2 font-bold">
                  <Check className="size-4" />
                  {feedback.message}
                </span>
                {feedback.kind === "success" && person.role === ROLES.SERVED_MEMBER && (feedback.points ?? 0) > 0 ? (
                  <span className="font-heading font-extrabold">+{feedback.points} نقطة</span>
                ) : null}
              </div>
            )
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            disabled={busy || inactive || feedback?.kind === "success"}
            onClick={() => void confirm()}
            className="gap-1.5"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {busy ? "جارٍ التسجيل…" : feedback?.kind === "duplicate" ? "تم التسجيل" : "تسجيل الحضور"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}