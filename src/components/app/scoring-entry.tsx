"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarPlus, Save, Star, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import {
  getScoreEntryViewAction,
  grantMonthlyActivityAction,
  saveWeeklyScoresAction,
} from "@/app/actions/scoring"
import type { ScorableMember, WeeklyEntryState } from "@/services/scoring-service"
import type { ScoringCategory } from "@/lib/constants"

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
}: {
  members: ScorableMember[]
}) {
  const router = useRouter()
  const [memberId, setMemberId] = useState("")
  const [weekDate, setWeekDate] = useState(cairoToday())
  const [state, setState] = useState<WeeklyEntryState | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [commitment, setCommitment] = useState(0)
  const [serviceCommitment, setServiceCommitment] = useState(0)
  const [tunic, setTunic] = useState(false)
  const [communion, setCommunion] = useState(false)
  const [bonus, setBonus] = useState(false)

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
            <option value="">اختار المخدوم…</option>
            {members.map((m) => (
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
          <input
            id="scoring-week"
            aria-label="أسبوع"
            type="date"
            value={weekDate}
            onChange={(e) => setWeekDate(e.target.value)}
            className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
          />
        </div>
      </div>

      {state ? (
        <div className="space-y-4">
          <p className="text-center text-xs text-muted-foreground">{state.period.label}</p>

          {/* Attendance — read-only, always from the attendance engine */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-card p-4 text-center shadow-sm ring-1 ring-foreground/5">
              <p className="text-[11px] text-muted-foreground">حضور القداس (تلقائي)</p>
              <p className="mt-1 font-heading text-lg font-extrabold text-coptic-gold">
                {state.attendance.church.count > 0 ? `+${state.attendance.church.points}` : "—"}
              </p>
            </div>
            <div className="rounded-2xl bg-card p-4 text-center shadow-sm ring-1 ring-foreground/5">
              <p className="text-[11px] text-muted-foreground">حضور الخدمة (تلقائي)</p>
              <p className="mt-1 font-heading text-lg font-extrabold text-coptic-gold">
                {state.attendance.service.count > 0 ? `+${state.attendance.service.points}` : "—"}
              </p>
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