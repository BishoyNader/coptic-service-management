"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarPlus, Save, Star, Loader2, Plus, Check } from "lucide-react"
import { toast } from "sonner"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { fridayArabicLabel, lastFridayOnOrBefore } from "@/lib/friday"
import {
  getScoreEntryViewAction,
  grantMonthlyActivityAction,
  saveWeeklyScoresAction,
} from "@/app/actions/scoring"
import { recordChildAttendanceAction } from "@/app/actions/children"
import type { ScorableMember, WeeklyEntryState } from "@/services/scoring-service"
import type { ScoringCategory } from "@/lib/constants"
import type { AttendanceType } from "@/lib/types"

function cairoToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

const COMMITMENT_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

export function ScoringEntry({
  members,
  fridays,
  classId,
}: {
  members: ScorableMember[]
  /** When provided, the week picker is restricted to these ministry Fridays only. */
  fridays?: string[]
  /** When provided, only members assigned to this class are selectable. */
  classId?: string | null
}) {
  const router = useRouter()
  const [memberId, setMemberId] = useState("")
  const [weekDate, setWeekDate] = useState(() =>
    fridays && fridays.length > 0 ? fridays[0] : lastFridayOnOrBefore(cairoToday())
  )
  const [state, setState] = useState<WeeklyEntryState | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingAttendance, setSavingAttendance] = useState(false)
  const [attendanceDialogOpen, setAttendanceDialogOpen] = useState(false)
  const [attendanceDraft, setAttendanceDraft] = useState<{
    CHURCH: boolean
    SERVICE: boolean
  }>({ CHURCH: false, SERVICE: false })

  const [commitment, setCommitment] = useState(0)
  const [serviceCommitment, setServiceCommitment] = useState(0)
  const [tunic, setTunic] = useState(false)
  const [communion, setCommunion] = useState(false)
  const [bonus, setBonus] = useState(false)

  const visibleMembers = classId ? members.filter((m) => m.class_id === classId) : members

  const load = useCallback(
    async (profileId: string, date: string) => {
      await Promise.resolve()
      const resetForm = (entry: WeeklyEntryState | null) => {
        setCommitment(Number(entry?.existing.WEEKLY_COMMITMENT ?? 0))
        setServiceCommitment(Number(entry?.existing.SERVICE_COMMITMENT ?? 0))
        setTunic((entry?.existing.TUNIC ?? 0) > 0)
        setCommunion((entry?.existing.COMMUNION ?? 0) > 0)
        setBonus((entry?.existing.BONUS ?? 0) > 0)
      }
      if (!profileId) {
        setState(null)
        resetForm(null)
        return
      }
      setLoading(true)
      const res = await getScoreEntryViewAction(profileId, date)
      setLoading(false)
      if (!res.ok) {
        setState(null)
        resetForm(null)
        toast.error(res.message)
        return
      }
      setState(res.state)
      resetForm(res.state)
    },
    []
  )

  useEffect(() => {
    const run = async () => {
      await load(memberId, weekDate)
    }
    void run()
  }, [memberId, weekDate, load])

  const configured = state?.configured ?? {}
  const cfg = (cat: ScoringCategory) => Number(configured[cat] ?? 0)

  const attendancePoints =
    (state?.attendance.church.points ?? 0) + (state?.attendance.service.points ?? 0)
  const previewTotal =
    attendancePoints +
    commitment +
    (tunic ? cfg("TUNIC") : 0) +
    (communion ? cfg("COMMUNION") : 0) +
    serviceCommitment +
    (bonus ? cfg("BONUS") : 0)

  const handleSave = async () => {
    if (!memberId || !state) return
    setSaving(true)
    const res = await saveWeeklyScoresAction({
      profileId: memberId,
      weekDate,
      commitment,
      tunic,
      communion,
      serviceCommitment,
      bonus,
    })
    setSaving(false)
    if (res.ok) {
      toast.success("تم حفظ درجات الأسبوع")
      await load(memberId, weekDate)
      router.refresh()
    } else {
      toast.error(res.message ?? "تعذر الحفظ")
    }
  }

  const handleGrantActivity = async () => {
    if (!memberId) return
    setSaving(true)
    const res = await grantMonthlyActivityAction({ profileId: memberId, activityDate: weekDate })
    setSaving(false)
    if (res.ok) {
      toast.success("تم تسجيل النشاط الشهري")
      await load(memberId, weekDate)
    } else {
      toast.error(res.message ?? "تعذر تسجيل النشاط")
    }
  }

  const openAttendanceDialog = (type: "CHURCH" | "SERVICE") => {
    setAttendanceDraft({
      CHURCH: type === "CHURCH" || (state?.dayAttendance.church.present ?? false),
      SERVICE: type === "SERVICE" || (state?.dayAttendance.service.present ?? false),
    })
    setAttendanceDialogOpen(true)
  }

  /** How many points a manual attendance entry earns (the configured rule value). */
  const defaultAttendancePoints = (type: AttendanceType): number => {
    const category: ScoringCategory =
      type === "CHURCH" ? "CHURCH_ATTENDANCE" : "SERVICE_ATTENDANCE"
    const configured = Number(cfg(category)) || 0
    return Math.min(Math.max(0, Math.round(configured)), 10)
  }

  /**
   * Writes attendance for every service the admin marked as attended. Already-
   * recorded services are skipped so confirmation never re-records a duplicate.
   */
  const handleSaveAttendance = async () => {
    if (!memberId || !weekDate) return
    const targets: AttendanceType[] = []
    if (attendanceDraft.CHURCH && !state?.dayAttendance.church.present) targets.push("CHURCH")
    if (attendanceDraft.SERVICE && !state?.dayAttendance.service.present) targets.push("SERVICE")
    if (targets.length === 0) {
      setAttendanceDialogOpen(false)
      return
    }
    setSavingAttendance(true)
    const results = await Promise.all(
      targets.map((type) =>
        recordChildAttendanceAction(memberId, type, weekDate, defaultAttendancePoints(type))
      )
    )
    setSavingAttendance(false)
    setAttendanceDialogOpen(false)
    await load(memberId, weekDate)
    const failures = results.filter((r) => !r.ok && !r.duplicate)
    if (results.some((r) => r.ok || r.duplicate)) {
      toast.success(failures.length > 0 ? "تم تسجيل الحضور جزئياً" : "تم تسجيل الحضور")
      router.refresh()
    }
    if (failures.length > 0) toast.error(failures[0].message)
  }

  return (
    <div className="space-y-4">
      {/* Selectors */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="scoring-member" className="text-sm font-medium">
            المخدوم
          </label>
          <select
            id="scoring-member"
            aria-label="اختار المخدوم"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <option value="">
              {visibleMembers.length > 0 ? "اختار المخدوم…" : "لا يوجد مخدومون في هذا الصف"}
            </option>
            {visibleMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="scoring-week" className="text-sm font-medium">
            أسبوع&nbsp;/&nbsp;تاريخ
          </label>
          {fridays ? (
            fridays.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                لا توجد أيام جمعة سابقة متاحة للتسجيل
              </p>
            ) : (
              <select
                id="scoring-week"
                aria-label="أسبوع"
                value={weekDate}
                onChange={(e) => setWeekDate(e.target.value || cairoToday())}
                className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                {fridays.map((f) => (
                  <option key={f} value={f}>
                    {fridayArabicLabel(f)}
                  </option>
                ))}
              </select>
            )
          ) : (
            <input
              id="scoring-week"
              aria-label="أسبوع"
              type="date"
              value={weekDate}
              onChange={(e) => setWeekDate(lastFridayOnOrBefore(e.target.value || cairoToday()))}
              className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
            />
          )}
          <p className="text-[11px] text-muted-foreground">
            {fridays
              ? "يُسجَّل يوم الجمعة فقط — من أيام الجمعة المحدّدة"
              : "يُسجَّل يوم الجمعة فقط — أي تاريخ يُحوَّل إلى أقرب جمعة"}
          </p>
        </div>
      </div>

      {state ? (
        <div className="space-y-4">
          <p className="text-center text-xs text-muted-foreground">{state.period.label}</p>

          {/* Attendance — entered automatically on check-in; add manually when missing */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-card p-4 text-center shadow-sm ring-1 ring-foreground/5">
              <p className="text-[11px] text-muted-foreground">حضور القداس (تلقائي)</p>
              {state.dayAttendance.church.present ? (
                <p className="mt-1 font-heading text-lg font-extrabold text-coptic-gold">
                  +{state.dayAttendance.church.points}
                </p>
              ) : (
                <div className="mt-1 space-y-1.5">
                  <p className="font-heading text-lg font-extrabold text-muted-foreground">—</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-xs"
                    aria-label="تسجيل حضور القداس يدوياً"
                    onClick={() => openAttendanceDialog("CHURCH")}
                    disabled={savingAttendance}
                  >
                    <Plus className="size-3" />
                    إدخال الحضور
                  </Button>
                </div>
              )}
            </div>
            <div className="rounded-2xl bg-card p-4 text-center shadow-sm ring-1 ring-foreground/5">
              <p className="text-[11px] text-muted-foreground">حضور الخدمة (تلقائي)</p>
              {state.dayAttendance.service.present ? (
                <p className="mt-1 font-heading text-lg font-extrabold text-coptic-gold">
                  +{state.dayAttendance.service.points}
                </p>
              ) : (
                <div className="mt-1 space-y-1.5">
                  <p className="font-heading text-lg font-extrabold text-muted-foreground">—</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-xs"
                    aria-label="تسجيل حضور الخدمة يدوياً"
                    onClick={() => openAttendanceDialog("SERVICE")}
                    disabled={savingAttendance}
                  >
                    <Plus className="size-3" />
                    إدخال الحضور
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Manual categories */}
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
          <CheckRow
            label="Bonus ⭐"
            points={cfg("BONUS")}
            checked={bonus}
            onCheckedChange={setBonus}
          />

          {/* Monthly activity */}
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-xl bg-coptic-gold-soft text-coptic-gold">
                <CalendarPlus className="size-4" />
              </span>
              <div>
                <p className="text-sm font-medium">النشاط الشهري</p>
                <p className="text-[11px] text-muted-foreground">
                  {state.latestMonthlyActivity
                    ? `آخر نشاط: ${state.latestMonthlyActivity}`
                    : "لم يتم تسجيل نشاط شهري بعد"}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleGrantActivity}
              disabled={saving}
            >
              تسجيل نشاط شهري (+{cfg("MONTHLY_ACTIVITY")})
            </Button>
          </div>

          {/* Totals */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-secondary/60 p-3 text-center">
              <p className="text-[11px] text-muted-foreground">إجمالي الأسبوع الحالي</p>
              <p className="font-heading text-lg font-extrabold">
                {previewTotal} نقطة
              </p>
            </div>
            <div className="rounded-2xl bg-secondary/60 p-3 text-center">
              <p className="text-[11px] text-muted-foreground">إجمالي الشهر (من السجلات)</p>
              <p className="font-heading text-lg font-extrabold">{state.monthlyTotal} نقطة</p>
            </div>
          </div>

          {/* Sticky save on mobile */}
          <div className="sticky bottom-3 z-10">
            <div className="rounded-2xl bg-background/90 p-3 shadow-lg ring-1 ring-foreground/10 backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <p className="font-heading font-bold">
                  الإجمالي&nbsp;
                  <span className="text-coptic-teal">{previewTotal}</span>
                </p>
                <Button onClick={handleSave} disabled={saving || loading} className="flex-1 gap-2 sm:flex-none">
                  <Save className="size-4" />
                  <span>{saving ? "جاري الحفظ…" : "حفظ الدرجات"}</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          جاري تحميل الدرجات…
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card/60 px-4 py-8 text-center text-sm text-muted-foreground">
          {memberId ? (
            <span className="inline-flex items-center gap-2">
              <Star className="size-4" />
              اختار مخدوماً لعرض كارت الدرجات الأسبوعي
            </span>
          ) : (
            "اختار مخدوماً من الأعلى للبدء في تسجيل الدرجات"
          )}
        </div>
      )}

      {/* Attendance options — the admin marks which services the member attended */}
      <Dialog
        open={attendanceDialogOpen}
        onOpenChange={(open) => {
          if (!open && !savingAttendance) setAttendanceDialogOpen(false)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تسجيل الحضور</DialogTitle>
            <DialogDescription>
              حدد حضور القداس والخدمة ليوم {fridayArabicLabel(weekDate)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <AttendanceOptionRow
              label="حضور القداس"
              points={cfg("CHURCH_ATTENDANCE")}
              alreadyRecorded={state?.dayAttendance.church.present ?? false}
              value={attendanceDraft.CHURCH}
              onChange={(v) => setAttendanceDraft((d) => ({ ...d, CHURCH: v }))}
              disabled={savingAttendance}
            />
            <AttendanceOptionRow
              label="حضور الخدمة"
              points={cfg("SERVICE_ATTENDANCE")}
              alreadyRecorded={state?.dayAttendance.service.present ?? false}
              value={attendanceDraft.SERVICE}
              onChange={(v) => setAttendanceDraft((d) => ({ ...d, SERVICE: v }))}
              disabled={savingAttendance}
            />
            <p className="text-center text-[11px] text-muted-foreground">
              القداس: +{cfg("CHURCH_ATTENDANCE")} نقطة · الخدمة: +{cfg("SERVICE_ATTENDANCE")} نقطة
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => void handleSaveAttendance()}
              disabled={savingAttendance}
              className="gap-2"
            >
              {savingAttendance ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {savingAttendance ? "جاري التسجيل…" : "تسجيل الحضور"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function AttendanceOptionRow({
  label,
  points,
  alreadyRecorded,
  value,
  onChange,
  disabled,
}: {
  label: string
  points: number
  alreadyRecorded: boolean
  value: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-2 rounded-2xl bg-card p-3 shadow-sm ring-1 ring-foreground/5">
      <p className="text-sm font-medium">{label}</p>
      {alreadyRecorded ? (
        <p className="flex items-center gap-1.5 rounded-xl bg-coptic-teal/10 px-3 py-2.5 text-xs font-bold text-coptic-teal ring-1 ring-coptic-teal/30">
          <Check className="size-3.5" />
          تم التسجيل (+{points} نقطة)
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary/60 p-1" role="radiogroup">
          <button
            type="button"
            role="radio"
            aria-checked={value}
            aria-label={`${label} حاضر`}
            onClick={() => onChange(true)}
            disabled={disabled}
            className={`rounded-lg py-2.5 text-sm font-medium transition-colors disabled:opacity-60 ${
              value
                ? "bg-coptic-teal text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            حاضر
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!value}
            aria-label={`${label} غائب`}
            onClick={() => onChange(false)}
            disabled={disabled}
            className={`rounded-lg py-2.5 text-sm font-medium transition-colors disabled:opacity-60 ${
              !value
                ? "bg-destructive/10 text-destructive shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            غائب
          </button>
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
              className={`h-10 rounded-xl text-sm font-bold transition-colors ${
                active
                  ? "bg-coptic-gold text-white shadow-sm"
                  : "bg-secondary/70 text-muted-foreground hover:bg-secondary"
              }`}
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