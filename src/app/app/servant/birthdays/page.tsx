import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { getUpcomingBirthdays } from "@/services/birthday-service"
import { ServantBirthdayBoard } from "@/components/app/servant-birthday-board"

export const metadata: Metadata = { title: "أعياد الميلاد القادمة" }

export default async function ServantBirthdaysPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVANT) redirect("/")

  const [servants, members] = await Promise.all([
    getUpcomingBirthdays(supabase, [ROLES.SERVANT]),
    getUpcomingBirthdays(supabase, [ROLES.SERVED_MEMBER]),
  ])

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-xl font-extrabold">أعياد الميلاد القادمة</h1>
      <ServantBirthdayBoard servants={servants} members={members} />
    </div>
  )
}