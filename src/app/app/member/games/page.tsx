import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { GamesHub } from "@/components/app/games/games-hub"

export const metadata: Metadata = { title: "الألعاب" }

export default async function MemberGamesPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVED_MEMBER) redirect("/")

  return <GamesHub me={{ id: profile.id, name: profile.full_name }} />
}
