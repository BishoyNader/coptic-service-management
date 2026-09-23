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
import { SuperAdminClassDesk } from "@/components/app/super-admin-class-desk"

export const metadata: Metadata = { title: "دكة الصف" }

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

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-heading text-xl font-extrabold">دكة الصف</h1>
        <p className="text-sm text-muted-foreground">
          سجّل حضور وأنشطة الخدام ودرجات المخدومين — صف واحد في الشاشة
        </p>
      </div>

      <SuperAdminClassDesk
        classes={classes.map((c) => ({ id: c.id, name: c.name }))}
        initialClassId={first ? first.id : null}
        initialDesk={desk}
        currentUserId={profile.id}
        today={cairoToday}
        fridays={fridays}
      />
    </div>
  )
}