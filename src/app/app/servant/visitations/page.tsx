import { redirect } from "next/navigation"
import { Footprints } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { getServerNow } from "@/services/attendance-service"
import { cairoDateString } from "@/lib/cairo"
import { getVisitationBoard } from "@/services/visitation-service"
import { VisitationBoard } from "@/components/app/visitation-board"

export default async function ServantVisitationsPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVANT) redirect("/")

  const admin = createAdminClient()
  const today = cairoDateString(getServerNow())

  // A servant may visit any served member, so the board covers every class —
  // not just their own.
  const groups = await getVisitationBoard(admin, { includeUnclassified: true })

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-coptic-teal/10 text-coptic-teal">
          <Footprints className="size-6" />
        </span>
        <div className="space-y-0.5">
          <h1 className="font-heading text-xl font-extrabold">الافتقاد</h1>
          <p className="text-sm text-muted-foreground">
            تابع افتقاد المخدومين — اضغط على اسم المخدوم لتسجيل افتقاده
          </p>
        </div>
      </div>

      <VisitationBoard
        initialGroups={groups}
        today={today}
        actorName={profile.full_name}
      />
    </div>
  )
}