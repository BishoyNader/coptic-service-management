import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Settings } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { EmptyState } from "@/components/coptic/empty-state"

export const metadata: Metadata = { title: "الإعدادات" }

export default async function SuperAdminSettingsPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const { data: rules } = await supabase
    .from("scoring_rules")
    .select("id, name, point_value, is_active")
    .order("sort_order", { ascending: true })

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-xl font-extrabold">الإعدادات</h1>

      <section className="space-y-2">
        <p className="font-heading text-sm font-bold text-muted-foreground">
          قواعد الدرجات
        </p>
        {!rules || rules.length === 0 ? (
          <EmptyState
            icon={<Settings className="size-7" />}
            title="لا توجد قواعد"
            description="قواعد النقاط والتوقيتات هتتحكم هنا"
          />
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5"
              >
                <p className="font-medium">{rule.name}</p>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-coptic-gold">+{rule.point_value}</span>
                  <span
                    className={`size-2 rounded-full ${
                      rule.is_active ? "bg-coptic-teal" : "bg-muted"
                    }`}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}