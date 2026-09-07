import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Star } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { EmptyState } from "@/components/coptic/empty-state"

export const metadata: Metadata = { title: "الدرجات" }

export default async function SuperAdminScoresPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const { data: rules } = await supabase
    .from("scoring_rules")
    .select("*")
    .order("sort_order", { ascending: true })

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-xl font-extrabold">قواعد الدرجات</h1>

      {!rules || rules.length === 0 ? (
        <EmptyState
          icon={<Star className="size-7" />}
          title="لا توجد قواعد"
          description="أضف قواعد الدرجات من الإعدادات"
        />
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5"
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">{rule.name}</p>
                <span className="rounded-full bg-coptic-gold-soft px-2.5 py-1 text-xs font-bold text-coptic-gold">
                  +{rule.point_value}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground" dir="ltr">
                {rule.start_time}–{rule.end_time ?? "∞"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}