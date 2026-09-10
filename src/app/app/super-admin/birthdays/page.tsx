import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { getUpcomingBirthdays } from "@/services/birthday-service"
import { BirthdayBoard } from "@/components/app/birthday-board"

export const metadata: Metadata = { title: "أعياد الميلاد" }

export default async function SuperAdminBirthdaysPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const rows = await getUpcomingBirthdays(supabase)

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-xl font-extrabold">أعياد الميلاد القادمة</h1>
      <BirthdayBoard rows={rows} showAutomationButton />
    </div>
  )
}