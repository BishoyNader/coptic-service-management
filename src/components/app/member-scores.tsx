"use client"

import {
  CalendarDays,
  Church,
  Croissant,
  Flame,
  GraduationCap,
  HandHeart,
  Heart,
  HeartHandshake,
  Home,
  Scissors,
  Shirt,
  Star,
  type LucideIcon,
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/coptic/empty-state"
import { formatArabicDate } from "@/lib/dates"
import type { ScoreBreakdown, ScoreBreakdownEntry } from "@/services/scoring-rules"
import type { MemberActivityView, MemberActivityDayEntry } from "@/services/member-scoring-service"
import { MemberFridayResults } from "./member-friday-results"
import type { FridayMemberView } from "@/services/friday-service"

const ICONS: Record<string, LucideIcon> = {
  church: Church,
  Church,
  heart: Heart,
  shirt: Shirt,
  Shirt,
  bread: Croissant,
  flame: Flame,
  hand: HandHeart,
  star: Star,
  Star,
  calendar: CalendarDays,
  BookOpen: GraduationCap,
  GraduationCap,
  HeartHandshake,
  Home,
  Scissors,
}

export function MemberScoresView({
  week,
  month,
  activity,
  friday,
}: {
  week: ScoreBreakdown
  month: ScoreBreakdown
  activity: MemberActivityView | null
  friday: FridayMemberView
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="font-heading text-xl font-extrabold">درجاتي</h1>
        <p className="text-sm text-muted-foreground">درجة اليوم وكل الأنشطة والأسابيع</p>
      </div>

      <Tabs defaultValue={activity && activity.entries.length > 0 ? "activity" : "week"} className="w-full">
        <TabsList className="w-full">
          {activity && activity.entries.length > 0 ? (
            <TabsTrigger value="activity" className="flex-1">
              نشاط اليوم
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="week" className="flex-1">
            هذا الأسبوع
          </TabsTrigger>
          <TabsTrigger value="friday" className="flex-1">
            درجات الجمعة
          </TabsTrigger>
          <TabsTrigger value="month" className="flex-1">
            هذا الشهر
          </TabsTrigger>
        </TabsList>

        {activity && activity.entries.length > 0 ? (
          <TabsContent value="activity" className="mt-4">
            <ActivityPanel view={activity} />
          </TabsContent>
        ) : null}

        <TabsContent value="week" className="mt-4">
          <PeriodPanel breakdown={week} emptyText="لسه مفيش درجات للأسبوع ده" />
        </TabsContent>

        <TabsContent value="friday" className="mt-4">
          <MemberFridayResults initial={friday} initialDate={friday.selected.date} />
        </TabsContent>

        <TabsContent value="month" className="mt-4">
          <PeriodPanel breakdown={month} emptyText="لسه مفيش درجات للشهر ده" />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** Today + all-time activity grading, with a live percentage per activity. */
function ActivityPanel({ view }: { view: MemberActivityView }) {
  return (
    <div className="space-y-3">
      <p className="text-center text-xs text-muted-foreground">
        {formatArabicDate(view.date)} — درجة اليوم ونسبتها
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-card p-4 text-center shadow-sm ring-1 ring-foreground/5">
          <p className="text-[11px] text-muted-foreground">درجة اليوم</p>
          <p className="mt-1 font-heading text-xl font-extrabold text-coptic-teal">
            {view.today_points} <span className="text-sm text-muted-foreground">/ {view.today_max}</span>
          </p>
          <PercentBadge percent={view.today_percent} />
        </div>
        <div className="rounded-2xl bg-card p-4 text-center shadow-sm ring-1 ring-foreground/5">
          <p className="text-[11px] text-muted-foreground">الإجمالي الكلي</p>
          <p className="mt-1 font-heading text-xl font-extrabold text-coptic-gold">
            {view.grand_total} <span className="text-sm text-muted-foreground">نقطة</span>
          </p>
          <PercentBadge percent={view.total_percent} />
        </div>
      </div>

      <div className="space-y-2">
        {view.entries.map((entry) => (
          <ActivityRow key={entry.activity_id} entry={entry} />
        ))}
      </div>
    </div>
  )
}

function ActivityRow({ entry }: { entry: MemberActivityDayEntry }) {
  const Icon = entry.icon ? ICONS[entry.icon] : Star
  const todayPct = entry.max_score > 0 ? Math.round((entry.points_today / entry.max_score) * 100) : 0
  return (
    <div className="rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{entry.name}</p>
        <TodayChip points={entry.points_today} max={entry.max_score} pct={todayPct} />
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>الكلي: <b className="text-coptic-teal">{entry.points_total} نقطة</b></span>
        <span>· {entry.days_active} يوم تقييم</span>
        <span className="ms-auto">المدى {entry.min_score}–{entry.max_score}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-coptic-teal"
          style={{ width: `${todayPct}%` }}
        />
      </div>
    </div>
  )
}

function TodayChip({ points, max, pct }: { points: number; max: number; pct: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-coptic-teal/10 px-2.5 py-1 text-[11px] font-bold text-coptic-teal">
      {points} / {max}
      <span className="text-coptic-gold">· {pct}%</span>
    </span>
  )
}

function PercentBadge({ percent }: { percent: number }) {
  const tone =
    percent >= 80
      ? "bg-coptic-teal/15 text-coptic-teal"
      : percent >= 50
        ? "bg-coptic-gold-soft/40 text-coptic-gold"
        : "bg-destructive/10 text-destructive"
  return (
    <span
      className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${tone}`}
    >
      {percent}%
    </span>
  )
}

function PeriodPanel({
  breakdown,
  emptyText,
}: {
  breakdown: ScoreBreakdown
  emptyText: string
}) {
  if (!breakdown.hasAny) {
    return (
      <EmptyState
        title={emptyText}
        description="لم يتم تسجيل التقييم بعد"
      />
    )
  }

  const attendanceShown = breakdown.entries.find((e) => e.category === "CHURCH_ATTENDANCE")
  const serviceShown = breakdown.entries.find((e) => e.category === "SERVICE_ATTENDANCE")

  return (
    <div className="space-y-3">
      <p className="text-center text-xs text-muted-foreground">{breakdown.period.label}</p>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-card p-4 text-center shadow-sm ring-1 ring-foreground/5">
          <p className="text-[11px] text-muted-foreground">حضور القداس</p>
          <p className="mt-1 font-heading text-lg font-extrabold text-coptic-gold">
            {attendanceShown ? `+${attendanceShown.points}` : "—"}
          </p>
        </div>
        <div className="rounded-2xl bg-card p-4 text-center shadow-sm ring-1 ring-foreground/5">
          <p className="text-[11px] text-muted-foreground">حضور الخدمة</p>
          <p className="mt-1 font-heading text-lg font-extrabold text-coptic-gold">
            {serviceShown ? `+${serviceShown.points}` : "—"}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {breakdown.entries.map((entry) => (
          <BreakdownRow key={entry.category} entry={entry} />
        ))}
      </div>

      <div className="flex items-center justify-between rounded-2xl bg-coptic-teal p-4 text-primary-foreground shadow-sm">
        <p className="font-heading font-bold">الإجمالي</p>
        <p className="font-heading text-xl font-extrabold">{breakdown.total} نقطة</p>
      </div>
    </div>
  )
}

function BreakdownRow({ entry }: { entry: ScoreBreakdownEntry }) {
  const Icon = ICONS[entry.icon] ?? Star
  const highlight = entry.category === "BONUS"
  return (
    <div className="flex items-center justify-between rounded-xl bg-card px-3 py-2.5 shadow-sm ring-1 ring-foreground/5">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex size-8 items-center justify-center rounded-xl ${
            highlight
              ? "bg-coptic-gold-soft text-coptic-gold"
              : "bg-secondary text-muted-foreground"
          }`}
        >
          <Icon className="size-4" />
        </span>
        <p className="text-sm font-medium">{entry.label}</p>
        {entry.count > 1 ? (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
            {entry.count}×
          </span>
        ) : null}
      </div>
      <p className="font-heading text-sm font-extrabold text-coptic-teal">+{entry.points}</p>
    </div>
  )
}