import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { BarChart3 } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { EmptyState } from "@/components/coptic/empty-state"

export const metadata: Metadata = { title: "التقارير" }

export default async function SuperAdminReportsPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-xl font-extrabold">التقارير</h1>
      <EmptyState
        icon={<BarChart3 className="size-7" />}
        title="لا توجد تقارير بعد"
        description="تقارير الحضور والدرجات والنشاط هتتولّد هنا"
      />
    </div>
  )
}