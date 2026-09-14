import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { cairoDateString } from "@/lib/cairo"
import { getScoringBoardData } from "@/services/member-scoring-service"
import { ServantScoringBoard } from "@/components/app/servant-scoring-board"

export const metadata: Metadata = { title: "التقييم" }

export default async function ServantScoringPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVANT) redirect("/")

  const cairoToday = cairoDateString(new Date())
  const board = await getScoringBoardData(createAdminClient(), cairoToday)

  return (
    <div className="space-y-4">
      <ServantScoringBoard
        currentUserId={profile.id}
        cairoToday={cairoToday}
        initialBoard={board}
      />
    </div>
  )
}