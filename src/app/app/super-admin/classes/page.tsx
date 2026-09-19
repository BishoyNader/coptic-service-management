import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { listClasses } from "@/services/classes-service"
import { ClassManagerSettings } from "@/components/app/class-manager-settings"

export const metadata: Metadata = { title: "الأصناف" }

export default async function SuperAdminClassesPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const admin = createAdminClient()
  const classes = await listClasses(admin)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-xl font-extrabold">الأصناف</h1>
        <p className="text-sm text-muted-foreground">
          إدارة أصناف المخدومين
        </p>
      </div>
      <ClassManagerSettings classes={classes} />
    </div>
  )
}
