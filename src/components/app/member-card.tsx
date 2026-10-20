"use client"

import Link from "next/link"
import { ChevronLeft, Phone } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "cn"
import { VISIT_WINDOW_DAYS } from "@/services/visitation-service"
import type { MemberListStats } from "@/services/member-list-service"

export type MemberCardData = {
  id: string
  fullName: string
  phone: string
  avatarUrl: string | null
  /** Resolved class display name (never the raw FK). */
  className: string | null
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED"
}

type Props = {
  member: MemberCardData
  stats: MemberListStats | undefined
  href: string
}

/**
 * One served member in the members list.
 *
 * Deliberately compact: identity on the first line, a single meta line, then
 * a thin two-track status strip — attendance over the last four ministry
 * Fridays and الافتقاد freshness — so a whole page stays scannable.
 */
export function MemberCard({ member, stats, href }: Props) {
  const attendance = stats?.attendance ?? []
  const presentCount = stats?.presentCount ?? 0
  const weeksTracked = attendance.length
  const daysSinceVisit = stats?.daysSinceVisit ?? null
  const visitationOverdue = stats?.visitationOverdue ?? true

  const initials = member.fullName.trim().charAt(0) || "؟"

  return (
    <Link
      href={href}
      className="group flex items-stretch gap-3 rounded-2xl bg-card p-3 shadow-sm ring-1 ring-foreground/5 transition-colors hover:bg-secondary/40"
    >
      {/* Avatar with a live status ring */}
      <div className="relative shrink-0">
        <Avatar className="size-12 ring-2 ring-coptic-gold-soft">
          {member.avatarUrl ? (
            <AvatarImage src={member.avatarUrl} alt={member.fullName} />
          ) : null}
          <AvatarFallback className="bg-coptic-gold-soft font-heading text-lg font-bold text-coptic-gold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <span
          aria-hidden
          className={cn(
            "absolute -end-0.5 -bottom-0.5 size-3.5 rounded-full ring-2 ring-card",
            member.status === "ACTIVE" ? "bg-emerald-500" : "bg-muted-foreground/50",
          )}
        />
      </div>

      {/* Identity + meta */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{member.fullName}</p>
          {member.className ? (
            <span className="shrink-0 rounded-full bg-coptic-gold-soft px-2 py-0.5 text-[10px] font-medium text-coptic-gold">
              {member.className}
            </span>
          ) : (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              بدون صنف
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1" dir="ltr">
            <Phone className="size-3" />
            {member.phone}
          </span>
        </div>

        {/* Status strip: attendance dots + visitation freshness */}
        <div className="mt-0.5 flex items-center gap-3">
          {weeksTracked > 0 && (
            <div
              className="flex items-center gap-1"
              title={`الحضور: ${presentCount} من ${weeksTracked} أسابيع`}
            >
              <span className="text-[10px] text-muted-foreground">حضور</span>
              <div className="flex items-center gap-0.5" dir="ltr">
                {attendance.map((day) => (
                  <span
                    key={day.date}
                    title={day.date}
                    className={cn(
                      "size-2 rounded-full",
                      day.present ? "bg-coptic-teal" : "bg-muted-foreground/25",
                    )}
                  />
                ))}
              </div>
              <span
                className={cn(
                  "text-[10px] font-bold tabular-nums",
                  presentCount === weeksTracked
                    ? "text-coptic-teal"
                    : presentCount === 0
                      ? "text-destructive"
                      : "text-muted-foreground",
                )}
              >
                {presentCount}/{weeksTracked}
              </span>
            </div>
          )}

          <VisitPill daysSince={daysSinceVisit} overdue={visitationOverdue} />
        </div>
      </div>

      <ChevronLeft className="size-5 shrink-0 self-center text-muted-foreground transition-transform group-hover:-translate-x-0.5" />
    </Link>
  )
}

/** Freshness chip for الافتقاد: green when recent, red once past the window. */
function VisitPill({ daysSince, overdue }: { daysSince: number | null; overdue: boolean }) {
  const label =
    daysSince === null
      ? "لم يُفتقد"
      : daysSince === 0
        ? "افتُقد اليوم"
        : `افتُقد من ${daysSince} يوم`

  return (
    <span
      title={`الافتقاد خلال آخر ${VISIT_WINDOW_DAYS} يوم`}
      className={cn(
        "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        overdue
          ? "bg-destructive/10 text-destructive"
          : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", overdue ? "bg-destructive" : "bg-emerald-500")}
      />
      {label}
    </span>
  )
}
