import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Star } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { startOfWeek, toDateString } from "@/lib/dates"
import { EmptyState } from "@/components/coptic/empty-state"

export const metadata: Metadata = { title: "الدرجات" }

export default async function AdminScoresPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.ADMIN) redirect("/")

  const weekStart = toDateString(startOfWeek())
  const today = toDateString(new Date())

  const { data: rows } = await supabase
    .from("score_records")
    .select("profile_id, points, category")
    .gte("session_date", weekStart)
    .lte("session_date", today)

  const byMember = new Map<string, number>()
  for (const r of rows ?? []) {
    byMember.set(r.profile_id, (byMember.get(r.profile_id) ?? 0) + Number(r.points))
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", Array.from(byMember.keys()))

  const totals = (profiles ?? [])
    .map((p) => ({ name: p.full_name, points: byMember.get(p.id) ?? 0 }))
    .sort((a, b) => b.points - a.points)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-xl font-extrabold">درجات الأسبوع</h1>
        <p className="text-sm text-muted-foreground">إجمالي نقاط مخدومين الأسبوع ده</p>
      </div>

      {totals.length === 0 ? (
        <EmptyState
          icon={<Star className="size-7" />}
          title="لا توجد درجات"
          description="درجات الأسبوع هتظهر هنا بعد أول حضور"
        />
      ) : (
        <div className="space-y-2">
          {totals.map((t) => (
            <div
              key={t.name}
              className="flex items-center justify-between rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5"
            >
              <p className="font-medium">{t.name}</p>
              <span className="rounded-full bg-coptic-gold-soft px-2.5 py-1 text-xs font-bold text-coptic-gold">
                {t.points} نقطة
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}