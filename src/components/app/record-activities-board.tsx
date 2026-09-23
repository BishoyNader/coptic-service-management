"use client"

import { useState } from "react"
import { Star } from "lucide-react"
import { SuperAdminClassDesk } from "@/components/app/super-admin-class-desk"
import { ScoringEntry } from "@/components/app/scoring-entry"
import { EmptyState } from "@/components/coptic/empty-state"
import type { ClassDeskData } from "@/services/class-desk-service"
import type { ScorableMember } from "@/services/scoring-service"

type ClassOption = { id: string; name: string }

type RuleView = {
  id: string
  name: string
  start_time: string | null
  end_time: string | null
  point_value: number
  requires_min_days: number | null
}

/**
 * The super-admin "نشاط الخدام" board. Keeps the actively-selected class in
 * one place so both the servant desk (servants of the class) and the served
 * members' weekly scores section are scoped to the same class.
 */
export function RecordActivitiesBoard({
  classes,
  initialClassId,
  initialDesk,
  today,
  fridays,
  members,
  rules,
}: {
  classes: ClassOption[]
  initialClassId: string | null
  initialDesk: ClassDeskData | null
  today: string
  /** Selectable past ministry Fridays (newest-first). */
  fridays: string[]
  /** All active served members (unfiltered — scoped by the selected class). */
  members: ScorableMember[]
  rules: RuleView[]
}) {
  const [classId, setClassId] = useState<string | null>(initialClassId)
  const scopedMembers = classId
    ? members.filter((m) => m.class_id === classId)
    : members

  return (
    <div className="space-y-6">
      <SuperAdminClassDesk
        classes={classes}
        initialClassId={initialClassId}
        initialDesk={initialDesk}
        today={today}
        fridays={fridays}
        onClassChange={setClassId}
      />

      {/* Served-member weekly scores — scoped to the class selected above. */}
      <section aria-label="درجات المخدومين" className="space-y-4">
        <div className="space-y-1">
          <h2 className="font-heading text-xl font-extrabold">درجات المخدومين</h2>
          <p className="text-sm text-muted-foreground">
            تسجيل وتصحيح درجات المخدومين — كل تعديل مسجّل في سجل العمليات
          </p>
        </div>

        {members.length === 0 ? (
          <EmptyState
            title="لا يوجد مخدومون نشطون"
            description="أضف مخدوماً لبدء تسجيل الدرجات"
          />
        ) : classId && scopedMembers.length === 0 ? (
          <EmptyState
            title="لا يوجد مخدومون في هذا الصف"
            description="أضف مخدوماً لهذا الصف ليظهر هنا لتسجيل الدرجات"
          />
        ) : (
          <ScoringEntry
            key={classId ?? "all"}
            members={scopedMembers}
            fridays={fridays}
            classId={classId}
          />
        )}

        <details className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
          <summary className="cursor-pointer list-none font-heading font-bold">
            القواعد النشطة
          </summary>
          <div className="mt-3 space-y-2">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between rounded-xl bg-secondary/50 px-3 py-2"
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{rule.name}</p>
                  <p className="text-[11px] text-muted-foreground" dir="ltr">
                    {rule.start_time ?? ""}–{rule.end_time ?? "∞"}
                    {rule.requires_min_days ? ` · كل ${rule.requires_min_days} يوم` : ""}
                  </p>
                </div>
                <span className="flex items-center gap-1 rounded-full bg-coptic-gold-soft px-2.5 py-1 text-xs font-bold text-coptic-gold">
                  <Star className="size-3" />
                  {rule.point_value}
                </span>
              </div>
            ))}
          </div>
        </details>
      </section>
    </div>
  )
}