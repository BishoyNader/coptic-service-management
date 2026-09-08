"use client"

import {
  CalendarDays,
  Church,
  Croissant,
  Flame,
  HandHeart,
  Heart,
  Shirt,
  Star,
  type LucideIcon,
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/coptic/empty-state"
import type { ScoreBreakdown, ScoreBreakdownEntry } from "@/services/scoring-rules"
import { SCORE_CATEGORY_ICONS } from "@/services/scoring-rules"

const ICONS: Record<string, LucideIcon> = {
  church: Church,
  heart: Heart,
  shirt: Shirt,
  bread: Croissant,
  flame: Flame,
  hand: HandHeart,
  star: Star,
  calendar: CalendarDays,
}

export function MemberScoresView({
  week,
  month,
}: {
  week: ScoreBreakdown
  month: ScoreBreakdown
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="font-heading text-xl font-extrabold">درجاتي</h1>
        <p className="text-sm text-muted-foreground">تفاصيل نقاط الخدمة الأسبوعية والشهرية</p>
      </div>

      <Tabs defaultValue="week" className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="week" className="flex-1">
            هذا الأسبوع
          </TabsTrigger>
          <TabsTrigger value="month" className="flex-1">
            هذا الشهر
          </TabsTrigger>
        </TabsList>

        <TabsContent value="week" className="mt-4">
          <PeriodPanel breakdown={week} emptyText="لسه مفيش درجات للأسبوع ده" />
        </TabsContent>

        <TabsContent value="month" className="mt-4">
          <PeriodPanel breakdown={month} emptyText="لسه مفيش درجات للشهر ده" />
        </TabsContent>
      </Tabs>
    </div>
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