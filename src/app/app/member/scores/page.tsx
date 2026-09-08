import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { getMemberScoreView } from "@/services/scoring-service"
import { MemberScoresView } from "@/components/app/member-scores"

export const metadata: Metadata = { title: "الدرجات" }

export default async function MemberScoresPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVED_MEMBER) redirect("/")

  // The engine reads through the RLS-bound client: members only ever see
  // their own score records (policy: own row + SERVED_MEMBER role).
  const view = await getMemberScoreView(supabase, profile.id)
  return <MemberScoresView week={view.week} month={view.month} />
}