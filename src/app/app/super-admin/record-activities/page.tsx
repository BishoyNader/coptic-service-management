import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Star } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { cairoDateString } from "@/lib/cairo"
import { getServerNow } from "@/services/attendance-service"
import { listActiveClasses } from "@/services/classes-service"
import { getClassDeskData } from "@/services/class-desk-service"
import { getPastMinistryFridays } from "@/services/study-year-service"
import { getActiveScoringRules, listScorableMembers } from "@/services/scoring-service"
import { SuperAdminClassDesk } from "@/components/app/super-admin-class-desk"
import { ScoringEntry } from "@/components/app/scoring-entry"
import { EmptyState } from "@/components/coptic/empty-state"

export const metadata: Metadata = { title: "نشاط الخدام" }

const SELF_HISTORY_DAYS = 14

export default async function SuperAdminRecordActivitiesPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const admin = createAdminClient()
  const todayInstant = getServerNow()
  const cairoToday = cairoDateString(todayInstant)
  const historySince = cairoDateString(
    new Date(todayInstant.getTime() - SELF_HISTORY_DAYS * 86_400_000)
  )
  const fridays = await getPastMinistryFridays(admin, cairoToday)

  const classes = await listActiveClasses(admin)
  const first = classes[0] ?? null

  const desk = first
    ? await getClassDeskData(admin, first.id, cairoToday, historySince)
    : null

  const [members, rules] = await Promise.all([
    listScorableMembers(supabase),
    getActiveScoringRules(supabase),
  ])

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-heading text-xl font-extrabold">نشاط الخدام</h1>
        <p className="text-sm text-muted-foreground">
          سجّل حضور وأنشطة الخدام ودرجات المخدومين — صف واحد في الشاشة
        </p>
      </div>

      <SuperAdminClassDesk
        classes={classes.map((c) => ({ id: c.id, name: c.name }))}
        initialClassId={first ? first.id : null}
        initialDesk={desk}
        today={cairoToday}
        fridays={fridays}
      />

      {/* Served-member weekly scores — the former "الدرجات" tab, moved here. */}
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
        ) : (
          <ScoringEntry members={members} />
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