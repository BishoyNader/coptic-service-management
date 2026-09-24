"use client"

import { useState } from "react"
import { Check, Footprints, Loader2, Plus } from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { EmptyState } from "@/components/coptic/empty-state"
import { markMemberVisitedAction } from "@/app/actions/visitations"
import { formatArabicDate } from "@/lib/dates"
import { VISIT_WINDOW_DAYS } from "@/services/visitation-service"
import type { VisitationGroup, VisitationMember } from "@/services/visitation-service"

type VisitationBoardProps = {
  initialGroups: VisitationGroup[]
  /** Cairo date string used as "today" for the colouring logic. */
  today: string
  /** full name of the signed-in staff member shown as recorder in toasts. */
  actorName: string
}

/**
 * الافتقاد board: class dropdowns of active served members whose row marks
 * the member as visited (green → red as visits age past 30 days).
 */
export function VisitationBoard({ initialGroups, today, actorName }: VisitationBoardProps) {
  const [groups, setGroups] = useState(initialGroups)
  const [recordingId, setRecordingId] = useState<string | null>(null)

  const members = groups.flatMap((g) => g.members)
  const total = members.length
  const visited = members.filter((m) => m.daysSince !== null).length
  const overdue = members.filter(
    (m) => m.daysSince === null || m.daysSince >= VISIT_WINDOW_DAYS
  ).length

  async function handleMark(member: VisitationMember) {
    if (recordingId) return
    setRecordingId(member.memberId)
    const res = await markMemberVisitedAction(member.memberId)
    setRecordingId(null)

    if (res.ok) {
      toast.success(`تم تسجيل افتقاد ${member.fullName} ✓`)
      patchMember(member.memberId, {
        lastVisitDate: res.visitDate ?? today,
        visitedBy: actorName,
        daysSince: 0,
      })
    } else if (res.duplicate) {
      toast.info(res.message)
    } else {
      toast.error(res.message)
    }
  }

  function patchMember(memberId: string, patch: Partial<VisitationMember>) {
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        members: g.members.map((m) => (m.memberId === memberId ? { ...m, ...patch } : m)),
      }))
    )
  }

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<Footprints className="size-7" />}
        title="لا يوجد مخدومون في هذا النطاق"
        description="الافتقاد بيظهر هنا لما يكون فيه مخدومين نشطين في صفّك"
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="إجمالي المخدومين" value={total} />
        <StatTile label="تم افتقادهم" value={visited} tone="good" />
        <StatTile label="محتاجين افتقاد" value={overdue} tone="bad" />
      </div>

      <Accordion multiple defaultValue={groups.map((g) => g.key)}>
        {groups.map((group) => {
          const groupOverdue = group.members.filter(
            (m) => m.daysSince === null || m.daysSince >= VISIT_WINDOW_DAYS
          ).length
          return (
            <AccordionItem key={group.key} value={group.key} className="rounded-2xl border-none bg-card px-1 shadow-md ring-1 ring-foreground/5">
              <AccordionTrigger className="px-2 hover:no-underline">
                <div className="flex w-full items-center gap-2 py-1 text-right">
                  <span className="truncate font-heading text-base font-bold">
                    {group.className}
                  </span>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                    {group.members.length}
                  </span>
                  {groupOverdue > 0 && (
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={{ color: visitColor(null), backgroundColor: visitSoftColor(visitColor(null)) }}
                    >
                      {groupOverdue} محتاج
                    </span>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-1 pt-1">
                  {group.members.map((member) => (
                    <MemberRow
                      key={member.memberId}
                      member={member}
                      busy={recordingId === member.memberId}
                      onClick={() => handleMark(member)}
                    />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>
    </div>
  )
}

function MemberRow({
  member,
  busy,
  onClick,
}: {
  member: VisitationMember
  busy: boolean
  onClick: () => void
}) {
  const color = visitColor(member.daysSince)
  const never = member.daysSince === null

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={`سجّل افتقاد ${member.fullName}`}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-right transition-colors",
        "hover:bg-muted/60 active:bg-muted disabled:pointer-events-none disabled:opacity-70"
      )}
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
        style={{ backgroundColor: color, boxShadow: `0 0 0 3px ${visitSoftColor(color)}` }}
      >
        {member.fullName.trim().charAt(0) || "؟"}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">
          {member.fullName}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {never
            ? "لم يُفتقَد بعد — اضغط للتسجيل"
            : `${formatArabicDate(member.lastVisitDate!)} • ${member.visitedBy ?? "خادم"}`}
        </span>
      </span>

      <span
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold"
        style={{ color, backgroundColor: visitSoftColor(color) }}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : member.daysSince === 0 ? (
          <Check className="size-3.5" />
        ) : (
          <Plus className="size-3.5" />
        )}
        {busy ? "تسجيل…" : never ? "لم يُفتقَد" : tagLabel(member.daysSince!)}
      </span>
    </button>
  )
}

function tagLabel(daysSince: number): string {
  if (daysSince === 0) return "تم اليوم"
  if (daysSince === 1) return "منذ يوم"
  return `منذ ${daysSince} يوم`
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: "good" | "bad"
}) {
  return (
    <div className="rounded-2xl border border-border bg-card px-3 py-3 text-center shadow-sm">
      <p
        className="font-heading text-2xl font-extrabold"
        style={{
          color:
            tone === "good"
              ? visitColor(0)
              : tone === "bad"
                ? visitColor(null)
                : undefined,
        }}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

/**
 * Freshness colour: green right after a visit fading to red after
 * VISIT_WINDOW_DAYS. Never visited → red.
 */
function visitColor(daysSince: number | null): string {
  if (daysSince === null) return "hsl(0 72% 42%)"
  const t = Math.min(Math.max(daysSince, 0) / VISIT_WINDOW_DAYS, 1)
  const hue = Math.round(130 * (1 - t))
  const lightness = 46 - Math.round(8 * t)
  return `hsl(${hue} 62% ${lightness}%)`
}

/** Tinted translucent background matching a visited-freshness colour. */
function visitSoftColor(hsl: string): string {
  return hsl.replace("hsl(", "hsla(").replace(")", " / 0.14)")
}