import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { getMemberScoreView } from "@/services/scoring-service"
import { getMemberActivityView } from "@/services/member-scoring-service"
import { cairoDateString } from "@/lib/cairo"
import { getServerNow } from "@/services/attendance-service"
import { getMemberFridayView } from "@/services/friday-service"
import { MemberScoresView } from "@/components/app/member-scores"

export const metadata: Metadata = { title: "الدرجات" }

export default async function MemberScoresPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVED_MEMBER) redirect("/")

  // The weekly/monthly engine reads through the RLS-bound client: members only
  // ever see their own score records (policy: own row + SERVED_MEMBER role).
  // The activity view (today + all-time per activity + percentage) and the
  // Friday results (per-Friday percentages, history, ministry-year totals) both
  // read only the caller's own rows through the admin client under the page's
  // role gate, keyed strictly to this profile.
  const now = getServerNow()
  const today = cairoDateString(now)
  const [scoreView, activity, friday] = await Promise.all([
    getMemberScoreView(supabase, profile.id, now),
    getMemberActivityView(createAdminClient(), profile.id, today),
    getMemberFridayView(createAdminClient(), profile.id, today),
  ])
  return (
    <MemberScoresView
      week={scoreView.week}
      month={scoreView.month}
      activity={activity}
      friday={friday}
    />
  )
}