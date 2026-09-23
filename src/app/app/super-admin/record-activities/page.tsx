import type { Metadata } from "next"
import { redirect } from "next/navigation"
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
import { RecordActivitiesBoard } from "@/components/app/record-activities-board"

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

      <RecordActivitiesBoard
        classes={classes.map((c) => ({ id: c.id, name: c.name }))}
        initialClassId={first ? first.id : null}
        initialDesk={desk}
        today={cairoToday}
        fridays={fridays}
        members={members}
        rules={rules.map((r) => ({
          id: r.id,
          name: r.name,
          start_time: r.start_time,
          end_time: r.end_time,
          point_value: r.point_value,
          requires_min_days: r.requires_min_days,
        }))}
      />
    </div>
  )
}