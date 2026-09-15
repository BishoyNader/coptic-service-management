"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Check,
  Church,
  Clock,
  Loader2,
  Save,
  Star,
  Trash2,
  Users,
} from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/coptic/empty-state"
import { formatArabicDate } from "@/lib/dates"
import { formatCairoTime, isCairoFriday, mostRecentCairoFriday } from "@/lib/cairo"
import { ATTENDANCE_TYPE_LABELS, SCORING_CATEGORY_LABELS } from "@/lib/constants"
import {
  getChildDayViewAction,
  recordChildAttendanceAction,
  removeChildAttendanceAction,
  saveChildScoresAction,
  type ChildDayView,
} from "@/app/actions/children"
import type { WeeklyEntryState } from "@/services/scoring-service"
import type { AttendanceType } from "@/lib/types"

const COMMITMENT_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const ATTENDANCE_TYPES = Object.keys(ATTENDANCE_TYPE_LABELS) as AttendanceType[]

type ChildView = Extract<ChildDayView, { ok: true }>

/**
 * Servant-facing records board for the children they serve: attendance entry
 * per chosen Cairo date plus the weekly grades card and a recent history.
 * Writes go through the servant-gated children actions which re-validate the
 * caller's role and the target's role/status server-side.
 */
export function ServantChildRecords({
  members,
  currentUserId,
  minDate,
}: {
  members: { id: string; full_name: string }[]
  currentUserId: string
  minDate: string
}) {
  const router = useRouter()
  const lastFriday = cairoDateString(mostRecentCairoFriday())

  const [memberId, setMemberId] = useState<string>(members[0]?.id ?? "")
  const [date, setDate] = useState(lastFriday)
  const [view, setView] = useState<ChildView | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyType, setBusyType] = useState<AttendanceType | null>(null)
  const [busyRemoveId, setBusyRemoveId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const isFriday = isCairoFriday(date)

  const [commitment, setCommitment] = useState(0)
  const [serviceCommitment, setServiceCommitment] = useState(0)
  const [tunic, setTunic] = useState(false)
  const [communion, setCommunion] = useState(false)
  const [bonus, setBonus] = useState(false)

  const load = useCallback(
    async (profileId: string, when: string) => {
      await Promise.resolve()
      if (!profileId) {
        setView(null)
        return
      }
      setLoading(true)
      const res = await getChildDayViewAction(profileId, when)
      setLoading(false)
      if (!res.ok) {
        setView(null)
        toast.error(res.message)
        return
      }
      const entry = res.state
      setView(res)
      setCommitment(Number(entry.existing.WEEKLY_COMMITMENT ?? 0))
      setServiceCommitment(Number(entry.existing.SERVICE_COMMITMENT ?? 0))
      setTunic((entry.existing.TUNIC ?? 0) > 0)
      setCommunion((entry.existing.COMMUNION ?? 0) > 0)
      setBonus((entry.existing.BONUS ?? 0) > 0)
    },
    []
  )

  useEffect(() => {
    const run = async () => {
      await load(memberId, date)
    }
    void run()
  }, [memberId, date, load])

  const state: WeeklyEntryState | null = view?.state ?? null
  const configured = state?.configured ?? {}
  const cfg = (cat: keyof typeof SCORING_CATEGORY_LABELS) => Number(configured[cat] ?? 0)

  const attendancePoints =
    (state?.attendance.church.points ?? 0) + (state?.attendance.service.points ?? 0)
  const previewTotal =
    attendancePoints +
    commitment +
    (tunic ? cfg("TUNIC") : 0) +
    (communion ? cfg("COMMUNION") : 0) +
    serviceCommitment +
    (bonus ? cfg("BONUS") : 0)

  const recordAttendance = async (type: AttendanceType) => {
    if (!memberId) return
    setBusyType(type)
    const res = await recordChildAttendanceAction(memberId, type, date)
    setBusyType(null)
    if (res.ok) toast.success(res.message)
    else if (res.duplicate) toast.info(res.message)
    else toast.error(res.message)
    await load(memberId, date)
  }

  const removeAttendance = async (recordId: string) => {
    setBusyRemoveId(recordId)
    const res = await removeChildAttendanceAction(recordId)
    setBusyRemoveId(null)
    if (res.ok) {
      toast.success(res.message)
      await load(memberId, date)
    } else {
      toast.error(res.message)
    }
  }

  const handleSaveGrades = async () => {
    if (!memberId || !state) return
    setSaving(true)
    const res = await saveChildScoresAction({
      profileId: memberId,
      date,
      commitment,
      serviceCommitment,
      tunic,
      communion,
      bonus,
    })
    setSaving(false)
    if (res.ok) {
      toast.success(res.message ?? "تم حفظ الدرجات")
      await load(memberId, date)
      router.refresh()
    } else {
      toast.error(res.message ?? "تعذر الحفظ")
    }
  }

  if (members.length === 0) {
    return (
      <EmptyState
        icon={<Users className="size-7" />}
        title="لا يوجد مخدومين"
        description="مفيش مخدومين نشطين حاليًا لتسجيل حضورهم ودرجاتهم"
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* Selectors */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="child-records-member" className="text-sm font-medium">
            المخدوم
          </label>
          <select
            id="child-records-member"
            aria-label="اختار المخدوم"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="child-records-date" className="text-sm font-medium">
            تاريخ السجل
          </label>
          <input
            id="child-records-date"
            aria-label="تاريخ السجل"
            type="date"
            value={date}
            min={minDate}
            max={today}
            onChange={(e) => setDate(e.target.value || today)}
            className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
          />
        </div>
      </div>

      {!view ? (
        loading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            جاري تحميل السجلات…
          </div>
        ) : null
      ) : (
        <div className="space-y-4">
          {/* Attendance for the chosen date */}
          <section aria-label="الحضور" className="space-y-2">
            <h2 className="text-sm font-bold text-muted-foreground">
              الحضور في {formatArabicDate(date)}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {ATTENDANCE_TYPES.map((type) => {
                const record = view.attendance.find((a) => a.type === type) ?? null
                const removable =
                  record !== null &&
                  record.recordedBy != null &&
                  record.recordedBy === currentUserId
                const busy = busyType === type
                return (
                  <div
                    key={type}
                    data-testid={`attendance-card-${type}`}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5",
                      record && "ring-coptic-teal/30"
                    )}
                  >
                    <div>
                      <p className="text-sm font-medium">{ATTENDANCE_TYPE_LABELS[type]}</p>
                      {record ? (
                        <p className="flex items-center gap-1 text-[11px] text-coptic-teal">
                          <Check className="size-3" />
                          تم تسجيله — +{record.points} نقطة · {formatCairoTime(record.attendedAt)}
                        </p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">لم يُسجَّل بعد</p>
                      )}
                    </div>
                    {record ? (
                      removable ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void removeAttendance(record.id)}
                          disabled={busyRemoveId !== null}
                          className="h-9 gap-1 text-destructive"
                          aria-label={`حذف ${ATTENDANCE_TYPE_LABELS[type]}`}
                        >
                          {busyRemoveId === record.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                          إلغاء
                        </Button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          <Clock className="me-0.5 inline size-3" />
                          سُجل بواسطة آخر
                        </span>
                      )
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void recordAttendance(type)}
                        disabled={busy || loading}
                        className="h-9 gap-1"
                      >
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                        سجّل
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              يمكنك تسجيل حضور أي يوم حتى اليوم — تكرار نفس النوع في نفس اليوم لا يُسجَّل مرتين
            </p>
          </section>

          {/* Grades card */}
          <section aria-label="الدرجات" className="space-y-3">
            <h2 className="text-sm font-bold text-muted-foreground">الدرجات</h2>
            <p className="text-center text-xs text-muted-foreground">{view.state.period.label}</p>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-card p-4 text-center shadow-sm ring-1 ring-foreground/5">
                <p className="text-[11px] text-muted-foreground">حضور القداس (تلقائي)</p>
                <p className="mt-1 font-heading text-lg font-extrabold text-coptic-gold">
                  {view.state.attendance.church.count > 0 ? `+${view.state.attendance.church.points}` : "—"}
                </p>
              </div>
              <div className="rounded-2xl bg-card p-4 text-center shadow-sm ring-1 ring-foreground/5">
                <p className="text-[11px] text-muted-foreground">حضور الخدمة (تلقائي)</p>
                <p className="mt-1 font-heading text-lg font-extrabold text-coptic-gold">
                  {view.state.attendance.service.count > 0 ? `+${view.state.attendance.service.points}` : "—"}
                </p>
              </div>
            </div>

            <CommitmentPicker
              label="الالتزام"
              value={commitment}
              onChange={setCommitment}
            />
            <CheckRow
              label="لبس التونية"
              points={cfg("TUNIC")}
              checked={tunic}
              onCheckedChange={setTunic}
            />
            <CheckRow
              label="التناول"
              points={cfg("COMMUNION")}
              checked={communion}
              onCheckedChange={setCommunion}
            />
            <CommitmentPicker
              label="التزام الخدمة"
              value={serviceCommitment}
              onChange={setServiceCommitment}
            />
            <CheckRow label="إضافي" points={cfg("BONUS")} checked={bonus} onCheckedChange={setBonus} />

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-secondary/60 p-3 text-center">
                <p className="text-[11px] text-muted-foreground">إجمالي الأسبوع</p>
                <p className="font-heading text-lg font-extrabold">{previewTotal} نقطة</p>
              </div>
              <div className="rounded-2xl bg-secondary/60 p-3 text-center">
                <p className="text-[11px] text-muted-foreground">إجمالي الشهر</p>
                <p className="font-heading text-lg font-extrabold">{view.state.monthlyTotal} نقطة</p>
              </div>
            </div>

            <Button
              type="button"
              onClick={handleSaveGrades}
              disabled={saving || loading}
              className="w-full gap-2 sm:w-auto"
            >
              <Save className="size-4" />
              {saving ? "جاري الحفظ…" : "حفظ الدرجات"}
            </Button>
          </section>

          {/* History */}
          <section aria-label="السجل الحديث" className="space-y-2">
            <h2 className="text-sm font-bold text-muted-foreground">السجل الحديث</h2>
            {view.history.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border bg-card/60 px-4 py-6 text-center text-sm text-muted-foreground">
                لا توجد سجلات لهذا المخدوم بعد
              </p>
            ) : (
              <div className="space-y-2">
                {view.history.map((h) => (
                  <div
                    key={`${h.unit}-${h.id}`}
                    data-testid="child-history-item"
                    className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5"
                  >
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-xl",
                        h.unit === "attendance"
                          ? "bg-coptic-teal/10 text-coptic-teal"
                          : "bg-coptic-gold-soft text-coptic-gold"
                      )}
                    >
                      {h.unit === "attendance" ? (
                        <Church className="size-4" aria-hidden="true" />
                      ) : (
                        <Star className="size-4" aria-hidden="true" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {h.unit === "attendance"
                          ? ATTENDANCE_TYPE_LABELS[h.category as AttendanceType]
                          : (SCORING_CATEGORY_LABELS[h.category as keyof typeof SCORING_CATEGORY_LABELS] ??
                            h.category)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{formatArabicDate(h.date)}</p>
                    </div>
                    <span className="text-sm font-bold text-coptic-gold">+{h.points}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function CommitmentPicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-2 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
      <p className="text-sm font-medium">{label}</p>
      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-11" role="radiogroup" aria-label={label}>
        {COMMITMENT_OPTIONS.map((v) => {
          const active = v === value
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${label} ${v}`}
              onClick={() => onChange(v)}
              className={cn(
                "h-10 rounded-xl text-sm font-bold transition-colors",
                active
                  ? "bg-coptic-gold text-white shadow-sm"
                  : "bg-secondary/70 text-muted-foreground hover:bg-secondary"
              )}
            >
              {v}
            </button>
          )
        })}
      </div>
      <p aria-hidden className="text-center text-[11px] text-muted-foreground">
        {label}: <span className="font-bold">{value} / 10</span>
      </p>
    </div>
  )
}

function CheckRow({
  label,
  points,
  checked,
  onCheckedChange,
}: {
  label: string
  points: number
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[11px] text-muted-foreground">+{points} نقطة</p>
      </div>
      <Checkbox checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  )
}