"use client"

import { useCallback, useState } from "react"
import { CalendarCheck, Check, ChevronDown, Loader2, Users } from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"
import { formatArabicDate } from "@/lib/dates"
import { getClassDeskAction, removeDeskAttendanceAction } from "@/app/actions/class-desk"
import { markServantAttendanceOnBehalfAction } from "@/app/actions/attendance"
import { ServantActivityPanel } from "@/components/app/servant-activity-panel"
import { ServantScoringBoard } from "@/components/app/servant-scoring-board"
import type { ClassDeskData, DeskServant } from "@/services/class-desk-service"

type ClassOption = { id: string; name: string }

/**
 * Super Admin class desk — one screen for one class:
 *
 *  - Class dropdown selects the class being worked on.
 *  - "خدام الصف": every active servant of the class with their today's
 *    attendance (record / remove on behalf) and an expandable activities
 *    panel (record SERVANT activities on behalf).
 *  - "مخدومين الصف": the shared scoring board scoped to the class — check
 *    what wasn't recorded yet and add attendance/scores manually.
 *
 * All writes go through super-admin-gated server actions; the desk re-fetches
 * the class payload from the server after every mutation.
 */
export function SuperAdminClassDesk({
  classes,
  initialClassId,
  initialDesk,
  currentUserId,
  today,
  minDate,
}: {
  classes: ClassOption[]
  initialClassId: string | null
  initialDesk: ClassDeskData | null
  currentUserId: string
  today: string
  minDate: string
}) {
  const [classId, setClassId] = useState<string | null>(initialClassId)
  const [desk, setDesk] = useState<ClassDeskData | null>(initialDesk)
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async (id: string) => {
    setLoading(true)
    const res = await getClassDeskAction(id)
    setLoading(false)
    if (res.ok) {
      setDesk(res.data)
      setClassId(res.data.classId)
    } else {
      toast.error(res.message)
    }
  }, [])

  const handleClassChange = (value: string) => {
    if (!value) return
    void reload(value)
  }

  const handleAttendance = async (servant: DeskServant) => {
    setLoading(true)
    const res = await markServantAttendanceOnBehalfAction(servant.profileId)
    setLoading(false)
    if (res.status === "success") {
      toast.success(`تم تسجيل حضور ${servant.fullName}`)
    } else if (res.status === "duplicate") {
      toast.info("تم تسجيل الحضور بالفعل")
    } else {
      toast.error(res.message)
    }
    if (classId) void reload(classId)
  }

  const handleRemoveAttendance = async (recordId: string, name: string) => {
    setLoading(true)
    const res = await removeDeskAttendanceAction(recordId)
    setLoading(false)
    if (res.ok) toast.success(`تم حذف حضور ${name}`)
    else toast.error(res.message)
    if (classId) void reload(classId)
  }

  if (classes.length === 0) {
    return (
      <EmptyHint>
        <Users className="size-6" />
        <p>مفيش أصناف لحد دلوقتي — أضف الأصناف الأول من صفحة الأصناف</p>
      </EmptyHint>
    )
  }

  if (classId === null) {
    return (
      <EmptyHint>
        <Users className="size-6" />
        <p>اختار صف للبدء في تسجيل النشاط والحضور</p>
      </EmptyHint>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="class-desk-select">الصف</Label>
        <select
          id="class-desk-select"
          data-testid="class-desk-select"
          value={classId}
          onChange={(e) => handleClassChange(e.target.value)}
          disabled={loading}
          className="flex h-11 w-full rounded-xl border border-input bg-card px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
        >
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {loading && !desk ? (
        <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          جاري تحميل الصف…
        </div>
      ) : desk ? (
        <>
          {/* Servants of the class */}
          <section aria-label="خدام الصف" className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-heading font-bold">خدام الصف</h2>
              <span className="rounded-full bg-coptic-teal/10 px-3 py-1 text-xs font-bold text-coptic-teal">
                {desk.servants.length} خادم
              </span>
            </div>

            {desk.servants.length === 0 ? (
              <EmptyHint>
                <Users className="size-5" />
                <p>لا يوجد خدام في هذا الصف — عيّن صف لكل خادم من صفحة الخدام</p>
              </EmptyHint>
            ) : (
              <div className="space-y-3">
                {desk.servants.map((servant) => (
                  <ServantDeskCard
                    key={servant.profileId}
                    servant={servant}
                    today={today}
                    minDate={minDate}
                    busy={loading}
                    onRecordAttendance={() => void handleAttendance(servant)}
                    onRemoveAttendance={(recordId) =>
                      void handleRemoveAttendance(recordId, servant.fullName)
                    }
                    onActivitiesChanged={() => {
                      if (classId) void reload(classId)
                    }}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Served members of the class — shared class-scoped board */}
          <section aria-label="مخدومين الصف" className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-heading font-bold">مخدومين الصف</h2>
              <span className="rounded-full bg-coptic-gold-soft px-3 py-1 text-xs font-bold text-coptic-gold">
                {desk.board.members.length} مخدوم
              </span>
            </div>

            <ServantScoringBoard
              currentUserId={currentUserId}
              cairoToday={today}
              initialBoard={desk.board}
              classId={desk.classId}
              embedded
              allowRemoveAny
            />
          </section>
        </>
      ) : null}
    </div>
  )
}

function ServantDeskCard({
  servant,
  today,
  minDate,
  busy,
  onRecordAttendance,
  onRemoveAttendance,
  onActivitiesChanged,
}: {
  servant: DeskServant
  today: string
  minDate: string
  busy: boolean
  onRecordAttendance: () => void
  onRemoveAttendance: (recordId: string) => void
  onActivitiesChanged: () => void
}) {
  const todayAttendance = servant.day.todayAttendance
  const present = todayAttendance.length > 0
  const latest = todayAttendance[0] ?? null

  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
      <div className="flex items-center gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-coptic-teal font-heading font-bold text-primary-foreground">
          {servant.fullName.trim().charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{servant.fullName}</p>
          <p className="text-[11px] text-muted-foreground">
            حضور اليوم — {formatArabicDate(today)}
          </p>
        </div>

        {present && latest ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onRemoveAttendance(latest.id)}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-coptic-teal/10 px-3 py-1.5 text-xs font-bold text-coptic-teal transition-colors hover:bg-coptic-teal/20"
          >
            <Check className="size-3.5" />
            حاضر — اضغط لإلغاء
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onRecordAttendance}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-coptic-teal px-3 py-1.5 text-xs font-bold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <CalendarCheck className="size-3.5" />
            سجّل حضور
          </button>
        )}
      </div>

      <details
        className="group mt-3 rounded-xl bg-secondary/40"
        data-testid={`servant-desk-panel-${servant.profileId}`}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium text-muted-foreground">
          <span className="flex items-center gap-2">
            <CalendarCheck className="size-4" />
            الأنشطة
          </span>
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-3 pb-3">
          <ServantActivityPanel
            activities={servant.day.activities}
            history={servant.day.history}
            cairoToday={today}
            minDate={minDate}
            servantId={servant.profileId}
            onChanged={onActivitiesChanged}
          />
        </div>
      </details>
    </div>
  )
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium text-muted-foreground">
      {children}
    </label>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-10 text-center text-sm text-muted-foreground"
      )}
    >
      {children}
    </div>
  )
}