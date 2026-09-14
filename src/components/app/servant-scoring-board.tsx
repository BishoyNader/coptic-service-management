"use client"

import { useCallback, useState } from "react"
import {
  Check,
  Church,
  ClipboardList,
  Clock,
  Gem,
  GraduationCap,
  HeartHandshake,
  Home,
  Loader2,
  Save,
  Scissors,
  Shirt,
  Star,
  Users,
  type LucideIcon,
} from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"
import { ATTENDANCE_TYPE_LABELS } from "@/lib/constants"
import { formatArabicDate } from "@/lib/dates"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/coptic/empty-state"
import {
  getScoringBoardAction,
  saveMemberActivityScoresAction,
} from "@/app/actions/scoring-board"
import {
  recordChildAttendanceAction,
  removeChildAttendanceAction,
} from "@/app/actions/children"
import type { ScoringBoardData, ScoringBoardMember } from "@/services/member-scoring-service"
import type { AttendanceType } from "@/lib/types"

const ICONS: Record<string, LucideIcon> = {
  Church,
  Shirt,
  Gem,
  Users,
  HeartHandshake,
  BookOpen: GraduationCap,
  GraduationCap,
  Home,
  Star,
  Scissors,
  ClipboardList,
}

type Board = ScoringBoardData

function cairoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000)
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d)
}

const ATTENDANCE_TYPES: AttendanceType[] = ["CHURCH", "SERVICE"]

/**
 * Servant unified scoring board — ONE tab/screen for every active served
 * member (no per-child navigation).
 *
 *  - "اليوم": record attendance (one tap) and grade each activity per member,
 *    then save. Editing only ever touches today.
 *  - "أيام سابقة": pick any past day and inspect the same board read-only,
 *    so past records are visible without cluttering the editing screen.
 *
 * Attendance writes reuse the children actions (same engine, audited); scores
 * go through the validated member-scoring service. The authoritative board is
 * always re-fetched from the server after a mutation.
 */
export function ServantScoringBoard({
  currentUserId,
  cairoToday,
  initialBoard,
}: {
  currentUserId: string
  cairoToday: string
  initialBoard: Board
}) {
  const [tab, setTab] = useState<"today" | "history">("today")

  const [todayBoard, setTodayBoard] = useState<Board>(initialBoard)
  const [historyBoard, setHistoryBoard] = useState<Board | null>(null)
  const [historyDate, setHistoryDate] = useState(cairoDaysAgo(1))
  const [historyLoading, setHistoryLoading] = useState(false)

  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({})
  const [busyAttendance, setBusyAttendance] = useState<{ memberId: string; type: AttendanceType } | null>(null)
  const [busyRemoveId, setBusyRemoveId] = useState<string | null>(null)
  const [savingMember, setSavingMember] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)

  const board = tab === "today" ? todayBoard : (historyBoard ?? todayBoard)

  const reloadToday = useCallback(async () => {
    setReloading(true)
    const res = await getScoringBoardAction(cairoToday)
    setReloading(false)
    if (res.ok) setTodayBoard(res.board)
  }, [cairoToday])

  const loadHistory = useCallback(async (when: string) => {
    setHistoryLoading(true)
    const res = await getScoringBoardAction(when)
    setHistoryLoading(false)
    if (res.ok) {
      setHistoryBoard(res.board)
    } else {
      setHistoryBoard(null)
      toast.error(res.message)
    }
  }, [])

  const handleTabChange = (v: string) => {
    setTab(v as "today" | "history")
    if (v === "history") {
      void loadHistory(historyDate)
    }
  }

  const handleHistoryDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value || cairoDaysAgo(1)
    setHistoryDate(next)
    if (tab === "history") {
      void loadHistory(next)
    }
  }

  const scoreFor = (member: ScoringBoardMember, activityId: string): number =>
    member.scores.find((s) => s.activity_id === activityId)?.points ?? 0

  const draftValue = (memberId: string, activityId: string, existing: number): string =>
    drafts[memberId]?.[activityId] ?? (existing === 0 ? "0" : String(existing))

  const setDraft = (memberId: string, activityId: string, value: string) => {
    setDrafts((d) => ({
      ...d,
      [memberId]: { ...(d[memberId] ?? {}), [activityId]: value },
    }))
  }

  const toggleAttendance = async (member: ScoringBoardMember, type: AttendanceType) => {
    if (tab !== "today") return
    const record = member.attendance.find((a) => a.type === type)
    if (record) {
      if (record.recordedBy !== null && record.recordedBy !== currentUserId) {
        toast.info("سُجل بواسطة خادم آخر")
        return
      }
      setBusyRemoveId(record.id)
      const res = await removeChildAttendanceAction(record.id)
      setBusyRemoveId(null)
      if (res.ok) toast.success(res.message)
      else toast.error(res.message)
    } else {
      setBusyAttendance({ memberId: member.id, type })
      const res = await recordChildAttendanceAction(member.id, type, cairoToday)
      setBusyAttendance(null)
      if (res.ok) toast.success(res.message)
      else if (res.duplicate) toast.info(res.message)
      else toast.error(res.message)
    }
    await reloadToday()
  }

  const saveMember = async (member: ScoringBoardMember) => {
    setSavingMember(member.id)
    const scores = (board?.activities ?? []).map((a) => {
      const raw = draftValue(member.id, a.id, scoreFor(member, a.id))
      const n = Number(raw)
      return { activityId: a.id, points: Number.isFinite(n) ? Math.round(n * 100) / 100 : 0 }
    })
    const res = await saveMemberActivityScoresAction({
      memberId: member.id,
      date: cairoToday,
      scores,
    })
    setSavingMember(null)
    if (res.ok) toast.success(res.message)
    else toast.error(res.message)
    await reloadToday()
  }

  if (!todayBoard) {
    return null
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-extrabold">التقييم</h1>
        <p className="text-sm text-muted-foreground">
          سجّل حضور ودرجات كل المخدومين من شاشة واحدة
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={handleTabChange}
        className="w-full"
      >
        <TabsList className="w-full">
          <TabsTrigger value="today" data-testid="board-tab-today" className="flex-1">
            اليوم
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="board-tab-history" className="flex-1">
            أيام سابقة
          </TabsTrigger>
        </TabsList>

        <TabsContent value="today" className="mt-4">
          <p className="mb-3 text-center text-xs text-muted-foreground">
            {formatArabicDate(cairoToday)} — التعديل متاح لليوم فقط
          </p>
          <MemberList
            board={board}
            editable
            currentUserId={currentUserId}
            draftValue={draftValue}
            setDraft={setDraft}
            scoreFor={scoreFor}
            busyAttendance={busyAttendance}
            busyRemoveId={busyRemoveId}
            savingMember={savingMember}
            reloading={reloading}
            onToggleAttendance={toggleAttendance}
            onSaveMember={saveMember}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <div className="mx-auto max-w-sm space-y-2">
            <input
              aria-label="تاريخ العرض"
              data-testid="board-history-date"
              type="date"
              value={historyDate}
              min="2020-01-01"
              max={cairoDaysAgo(0)}
              onChange={handleHistoryDateChange}
              className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
            />
            <p className="text-center text-[11px] text-muted-foreground">
              عيّن يوم — سجل اليوم قديم ولا يمكن التعديل من هنا
            </p>
          </div>

          {historyLoading ? (
            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              جاري تحميل السجل…
            </div>
          ) : historyBoard ? (
            <div className="mt-4">
              <p className="mb-3 text-center text-xs text-muted-foreground">
                {formatArabicDate(historyBoard.date)}
              </p>
              <MemberList
                board={historyBoard}
                editable={false}
                currentUserId={currentUserId}
                draftValue={draftValue}
                setDraft={setDraft}
                scoreFor={scoreFor}
                busyAttendance={busyAttendance}
                busyRemoveId={busyRemoveId}
                savingMember={savingMember}
                reloading={false}
                onToggleAttendance={toggleAttendance}
                onSaveMember={saveMember}
              />
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function MemberList({
  board,
  editable,
  currentUserId,
  draftValue,
  setDraft,
  scoreFor,
  busyAttendance,
  busyRemoveId,
  savingMember,
  reloading,
  onToggleAttendance,
  onSaveMember,
}: {
  board: Board
  editable: boolean
  currentUserId: string
  draftValue: (memberId: string, activityId: string, existing: number) => string
  setDraft: (memberId: string, activityId: string, value: string) => void
  scoreFor: (member: ScoringBoardMember, activityId: string) => number
  busyAttendance: { memberId: string; type: AttendanceType } | null
  busyRemoveId: string | null
  savingMember: string | null
  reloading: boolean
  onToggleAttendance: (member: ScoringBoardMember, type: AttendanceType) => void
  onSaveMember: (member: ScoringBoardMember) => void
}) {
  if (board.members.length === 0) {
    return (
      <EmptyState
        icon={<Users className="size-7" />}
        title="لا يوجد مخدومين"
        description="مفيش مخدومين نشطين حاليًا للتقييم"
      />
    )
  }

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "flex items-center justify-center gap-2 rounded-2xl bg-secondary/50 px-4 py-2 text-sm font-medium text-muted-foreground",
          reloading && "opacity-60"
        )}
      >
        {reloading ? <Loader2 className="size-3.5 animate-spin" /> : null}
        {board.members.length} مخدوم
      </div>

      {board.members.map((member) => (
        <MemberCard
          key={member.id}
          member={member}
          activities={board.activities}
          editable={editable}
          currentUserId={currentUserId}
          draftValue={draftValue}
          setDraft={setDraft}
          scoreFor={scoreFor}
          busyAttendance={busyAttendance}
          busyRemoveId={busyRemoveId}
          savingMember={savingMember}
          onToggleAttendance={onToggleAttendance}
          onSaveMember={onSaveMember}
        />
      ))}
    </div>
  )
}

function MemberCard({
  member,
  activities,
  editable,
  currentUserId,
  draftValue,
  setDraft,
  scoreFor,
  busyAttendance,
  busyRemoveId,
  savingMember,
  onToggleAttendance,
  onSaveMember,
}: {
  member: ScoringBoardMember
  activities: Board["activities"]
  editable: boolean
  currentUserId: string
  draftValue: (memberId: string, activityId: string, existing: number) => string
  setDraft: (memberId: string, activityId: string, value: string) => void
  scoreFor: (member: ScoringBoardMember, activityId: string) => number
  busyAttendance: { memberId: string; type: AttendanceType } | null
  busyRemoveId: string | null
  savingMember: string | null
  onToggleAttendance: (member: ScoringBoardMember, type: AttendanceType) => void
  onSaveMember: (member: ScoringBoardMember) => void
}) {
  const attendancePoints = member.attendance.reduce((s, a) => s + a.points, 0)
  const activityTotal = activities.reduce(
    (s, a) => s + Number(draftValue(member.id, a.id, scoreFor(member, a.id)) || 0),
    0
  )
  const memberTotal = attendancePoints + activityTotal
  const busy = busyAttendance?.memberId === member.id && busyAttendance !== null
  const saving = savingMember === member.id

  return (
    <div
      data-testid={`board-member-${member.id}`}
      className="space-y-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5"
    >
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-coptic-gold-soft font-heading font-bold text-coptic-gold">
          {member.full_name.trim().charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{member.full_name}</p>
          <p className="text-[11px] text-muted-foreground">
            إجمالي اليوم: <span className="font-bold text-coptic-teal">{memberTotal} نقطة</span>
          </p>
        </div>
      </div>

      {/* Attendance */}
      <div className="grid grid-cols-2 gap-2">
        {ATTENDANCE_TYPES.map((type) => {
          const record = member.attendance.find((a) => a.type === type) ?? null
          const removable = record !== null && record.recordedBy === currentUserId
          const chipBusy = busy && busyAttendance!.type === type
          const removeBusy = busyRemoveId === record?.id
          return (
            <button
              key={type}
              type="button"
              disabled={!editable || chipBusy || removeBusy}
              onClick={() => onToggleAttendance(member, type)}
              aria-label={`${ATTENDANCE_TYPE_LABELS[type]} — ${member.full_name} — ${record ? "سُجل" : "لم يُسجَّل"}`}
              data-testid={`attendance-chip-${type}-${member.id}`}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-xl border px-3 py-2 text-center text-xs font-medium transition-colors",
                record
                  ? "border-coptic-teal/30 bg-coptic-teal/10 text-coptic-teal"
                  : "border-border bg-muted/40 text-muted-foreground",
                !editable && "cursor-default",
                removeBusy && "opacity-60"
              )}
            >
              {chipBusy || removeBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : record ? (
                <Check className="size-4" />
              ) : (
                <Clock className="size-4" />
              )}
              <span>{ATTENDANCE_TYPE_LABELS[type]}</span>
              <span className={cn("text-[10px]", record ? "font-bold" : "")}>
                {record
                  ? editable && removable
                    ? `+${record.points} — اضغط للإلغاء`
                    : `+${record.points}`
                  : editable
                    ? "اضغط للتسجيل"
                    : "غائب"}
              </span>
            </button>
          )
        })}
      </div>

      {/* Activity scores */}
      {activities.length > 0 ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {activities.map((a) => {
              const existing = scoreFor(member, a.id)
              const Icon = a.icon ? ICONS[a.icon] : ClipboardList
              return (
                <label
                  key={a.id}
                  className="flex items-center gap-2 rounded-xl bg-secondary/40 px-2.5 py-2"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground">
                    <Icon className="size-3.5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium">{a.name}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {Number(a.min_score)}–{Number(a.max_score)}
                    </span>
                  </span>
                  {editable ? (
                    <input
                      type="number"
                      inputMode="decimal"
                      min={Number(a.min_score)}
                      max={Number(a.max_score)}
                      step="0.5"
                      value={draftValue(member.id, a.id, existing)}
                      onChange={(e) => setDraft(member.id, a.id, e.target.value)}
                      aria-label={`درجة ${a.name} — ${member.full_name}`}
                      data-testid={`activity-input-${a.id}-${member.id}`}
                      className="h-8 w-14 rounded-lg border border-input bg-transparent px-1.5 text-center text-sm font-bold outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
                    />
                  ) : (
                    <span
                      className={cn(
                        "h-8 w-14 rounded-lg bg-background px-1.5 py-1.5 text-center text-sm font-bold",
                        existing > 0 ? "text-coptic-teal" : "text-muted-foreground"
                      )}
                    >
                      {existing > 0 ? existing : "—"}
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      ) : (
        !editable && (
          <p className="text-center text-[11px] text-muted-foreground">
            لا توجد أنشطة للتقييم
          </p>
        )
      )}

      {editable ? (
        <Button
          type="button"
          size="sm"
          onClick={() => onSaveMember(member)}
          disabled={saving}
          className="w-full gap-1.5"
          data-testid={`save-scores-${member.id}`}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {saving ? "جاري الحفظ…" : "حفظ درجات اليوم"}
        </Button>
      ) : null}
    </div>
  )
}