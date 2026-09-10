import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { ReportsView } from "@/components/app/reports-view"

export const metadata: Metadata = { title: "التقارير" }

export default async function AdminReportsPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.ADMIN) redirect("/")

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-xl font-extrabold">التقارير</h1>
        <p className="text-sm text-muted-foreground">
          تقارير الحضور والدرجات وأنشطة الخدام
        </p>
      </div>
      <ReportsView />
    </div>
  )
}
