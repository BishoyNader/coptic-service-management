"use client"

import { useCallback, useMemo, useState } from "react"
import { CalendarCheck, Check, ChevronDown, Loader2, Save, Users } from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"
import { formatArabicDate } from "@/lib/dates"
import { getClassDeskAction, saveClassDeskAction } from "@/app/actions/class-desk"
import { ServantActivityPanel } from "@/components/app/servant-activity-panel"
import {
  ServantScoringBoard,
  type BoardDraftState,
} from "@/components/app/servant-scoring-board"
import type {
  ClassDeskData,
  DeskServant,
  DeskSaveInput,
} from "@/services/class-desk-service"
import type { ServantDayData } from "@/services/servant-day-service"

type ClassOption = { id: string; name: string }
type ActivityDraftMap = Record<string, Record<string, Record<string, boolean>>>

/**
 * Super Admin class desk — one screen for one class, draft-then-save:
 *
 *  - Class dropdown selects the class being worked on.
 *  - "خدام الصف": every active servant of the class with their today's
 *    attendance toggle and an expandable activities panel. Everything is a
 *    local draft — nothing is written on tap.
 *  - "مخدومين الصف": the shared class-scoped scoring board in draft mode
 *    (attendance + scores are collected locally too).
 *  - A single "حفظ" button persists all draft changes in one batch and
 *    re-fetches the desk, so the page updates automatically.
 *
 * All writes go through the super-admin-gated `saveClassDeskAction`.
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

  const [servantAttendance, setServantAttendance] = useState<Record<string, boolean>>({})
  const [activityDrafts, setActivityDrafts] = useState<ActivityDraftMap>({})
  const [boardDrafts, setBoardDrafts] = useState<BoardDraftState | null>(null)
  const [saving, setSaving] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const resetDrafts = useCallback(() => {
    setServantAttendance({})
    setActivityDrafts({})
    setBoardDrafts(null)
  }, [])

  const reload = useCallback(
    async (id: string) => {
      setLoading(true)
      const res = await getClassDeskAction(id)
      setLoading(false)
      if (res.ok) {
        setDesk(res.data)
        setClassId(res.data.classId)
      } else {
        toast.error(res.message)
      }
    },
    []
  )

  const handleClassChange = (value: string) => {
    if (!value || value === classId) return
    resetDrafts()
    setRefreshKey((k) => k + 1)
    void reload(value)
  }

  /** Server-truth presence for a servant (today). */
  const serverPresent = useCallback(
    (servant: DeskServant) => servant.day.todayAttendance.length > 0,
    []
  )

  /** Effective presence = draft if present, else server truth. */
  const effectivePresent = (servant: DeskServant): boolean => {
    const draft = servantAttendance[servant.profileId]
    if (draft !== undefined) return draft
    return serverPresent(servant)
  }

  /** History with activity drafts merged → passed to each servant's panel. */
  const effectiveHistory = (servant: DeskServant): ServantDayData["history"] => {
    const base = servant.day.history
    const drafts = activityDrafts[servant.profileId]
    if (!drafts) return base

    const overridden = new Set<string>()
    const out: ServantDayData["history"] = []
    for (const h of base) {
      const key = `${h.activityId}|${h.recordedOn}`
      const val = drafts[h.recordedOn]?.[h.activityId]
      if (val === undefined) out.push(h)
      else if (val === true) out.push(h)
      overridden.add(key)
    }
    for (const [date, acts] of Object.entries(drafts)) {
      for (const [activityId, val] of Object.entries(acts)) {
        if (val === true && !overridden.has(`${activityId}|${date}`)) {
          out.push({ activityId, recordedOn: date })
        }
      }
    }
    return out
  }

  const toggleServantAttendance = (servant: DeskServant) => {
    const current = effectivePresent(servant)
    const next = !current
    if (next === serverPresent(servant)) {
      setServantAttendance((prev) => {
        const nextMap = { ...prev }
        delete nextMap[servant.profileId]
        return nextMap
      })
    } else {
      setServantAttendance((prev) => ({ ...prev, [servant.profileId]: next }))
    }
  }

  const handleActivityToggle = (
    servant: DeskServant,
    activityId: string,
    recorded: boolean,
    date: string
  ) => {
    const serverRecorded = servant.day.history.some(
      (h) => h.activityId === activityId && h.recordedOn === date
    )
    const nextVal = !recorded
    if (nextVal === serverRecorded) {
      setActivityDrafts((prev) => {
        const nextMap = { ...prev }
        if (!nextMap[servant.profileId]?.[date]) return prev
        const rows = { ...nextMap[servant.profileId][date] }
        delete rows[activityId]
        if (Object.keys(rows).length === 0) {
          const dates = { ...nextMap[servant.profileId] }
          delete dates[date]
          if (Object.keys(dates).length === 0) delete nextMap[servant.profileId]
          else nextMap[servant.profileId] = dates
        } else {
          nextMap[servant.profileId] = {
            ...nextMap[servant.profileId],
            [date]: rows,
          }
        }
        return nextMap
      })
      return
    }
    setActivityDrafts((prev) => ({
      ...prev,
      [servant.profileId]: {
        ...(prev[servant.profileId] ?? {}),
        [date]: { ...(prev[servant.profileId]?.[date] ?? {}), [activityId]: nextVal },
      },
    }))
  }

  const boardDirty =
    (boardDrafts?.attendance.length ?? 0) > 0 || (boardDrafts?.scores.length ?? 0) > 0
  const attendanceDirty = Object.keys(servantAttendance).length > 0
  const activityDirty = Object.keys(activityDrafts).length > 0
  const hasChanges = attendanceDirty || activityDirty || boardDirty

  const handleSave = async () => {
    if (!classId || saving) return
    if (!hasChanges) return

    const servantActivities: DeskSaveInput["servantActivities"] = []
    for (const [servantId, dates] of Object.entries(activityDrafts)) {
      for (const [date, acts] of Object.entries(dates)) {
        for (const [activityId, recorded] of Object.entries(acts)) {
          if (typeof recorded !== "boolean") continue
          servantActivities.push({ servantId, date, activityId, recorded })
        }
      }
    }

    const payload: DeskSaveInput = {
      classId,
      date: today,
      servantAttendance: Object.entries(servantAttendance).map(([profileId, present]) => ({
        profileId,
        present,
      })),
      servantActivities,
      memberAttendance: boardDrafts?.attendance ?? [],
      memberScores: boardDrafts?.scores ?? [],
    }

    setSaving(true)
    const res = await saveClassDeskAction(payload)
    setSaving(false)

    if (res.ok) {
      toast.success(res.message)
      resetDrafts()
      setRefreshKey((k) => k + 1)
      void reload(classId)
    } else {
      toast.error(res.message)
    }
  }

  const totalChanges = useMemo(
    () =>
      Object.keys(servantAttendance).length +
      Object.values(activityDrafts).reduce(
        (s, dates) =>
          s +
          Object.values(dates).reduce(
            (s2, acts) => s2 + Object.values(acts).filter(Boolean).length,
            0
          ),
        0
      ) +
      (boardDrafts?.attendance.length ?? 0) +
      (boardDrafts?.scores.length ?? 0),
    [servantAttendance, activityDrafts, boardDrafts]
  )

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
                    present={effectivePresent(servant)}
                    history={effectiveHistory(servant)}
                    onToggleAttendance={() => toggleServantAttendance(servant)}
                    onActivityToggle={(activityId, recorded, date) =>
                      handleActivityToggle(servant, activityId, recorded, date)
                    }
                  />
                ))}
              </div>
            )}
          </section>

          {/* Served members of the class — shared class-scoped board (draft mode) */}
          <section aria-label="مخدومين الصف" className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-heading font-bold">مخدومين الصف</h2>
              <span className="rounded-full bg-coptic-gold-soft px-3 py-1 text-xs font-bold text-coptic-gold">
                {desk.board.members.length} مخدوم
              </span>
            </div>

            <ServantScoringBoard
              key={`${desk.classId}-${refreshKey}`}
              currentUserId={currentUserId}
              cairoToday={today}
              initialBoard={desk.board}
              classId={desk.classId}
              embedded
              allowRemoveAny
              draftMode
              onDraftsChange={setBoardDrafts}
            />
          </section>

          {/* Sticky save bar */}
          <div className="sticky bottom-3 z-10">
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-background/90 p-3 shadow-lg ring-1 ring-foreground/10 backdrop-blur">
              <p className="text-xs text-muted-foreground">
                {hasChanges ? (
                  <>
                    <span className="font-bold text-coptic-teal">{totalChanges}</span> تعديل غير محفوظ
                  </>
                ) : (
                  "لا توجد تعديلات"
                )}
              </p>
              <button
                type="button"
                data-testid="class-desk-save"
                disabled={!hasChanges || saving || loading}
                onClick={() => void handleSave()}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-colors sm:flex-none sm:min-w-44",
                  hasChanges
                    ? "bg-coptic-teal text-primary-foreground hover:opacity-90"
                    : "cursor-default bg-muted text-muted-foreground"
                )}
              >
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    جاري الحفظ…
                  </>
                ) : (
                  <>
                    <Save className="size-4" />
                    حفظ التعديلات
                  </>
                )}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

function ServantDeskCard({
  servant,
  today,
  minDate,
  present,
  history,
  onToggleAttendance,
  onActivityToggle,
}: {
  servant: DeskServant
  today: string
  minDate: string
  present: boolean
  history: ServantDayData["history"]
  onToggleAttendance: () => void
  onActivityToggle: (activityId: string, recorded: boolean, date: string) => void
}) {
  return (
    <div
      data-testid={`servant-desk-card-${servant.profileId}`}
      className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5"
    >
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

        <button
          type="button"
          data-testid={`servant-desk-attendance-${servant.profileId}`}
          onClick={onToggleAttendance}
          aria-pressed={present}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-colors",
            present
              ? "bg-coptic-teal/10 text-coptic-teal ring-1 ring-coptic-teal/30 hover:bg-coptic-teal/20"
              : "bg-coptic-teal text-primary-foreground hover:opacity-90"
          )}
        >
          <Check className="size-3.5" />
          {present ? "حاضر — اضغط للإلغاء" : "سجّل حضور"}
        </button>
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
            history={history}
            cairoToday={today}
            minDate={minDate}
            servantId={servant.profileId}
            draftMode
            onDraftToggle={onActivityToggle}
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