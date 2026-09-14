import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { listActivitiesForSettings } from "@/services/activities-admin-service"
import { ActivitiesSettings } from "@/components/app/activities-settings"

export const metadata: Metadata = { title: "الأنشطة" }

export default async function SuperAdminActivitiesPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const activities = await listActivitiesForSettings(createAdminClient())

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-xl font-extrabold">الأنشطة</h1>
        <p className="text-sm text-muted-foreground">
          أضف وعدّل الأنشطة وحدد درجاتها للخدام والمخدومين — مسؤول عام فقط
        </p>
      </div>

      <ActivitiesSettings activities={activities} />
    </div>
  )
}