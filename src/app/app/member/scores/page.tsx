import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Sparkles, CalendarDays } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { SCORING_CATEGORY_LABELS, type ScoringCategory } from "@/lib/constants"
import { startOfWeek, startOfMonth, toDateString } from "@/lib/dates"
import { StatCard } from "@/components/app/stat-cards"
import { EmptyState } from "@/components/coptic/empty-state"

export const metadata: Metadata = { title: "الدرجات" }

export default async function MemberScoresPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVED_MEMBER) redirect("/")

  const now = new Date()
  const weekStart = toDateString(startOfWeek(now))
  const monthStart = toDateString(startOfMonth(now))
  const today = toDateString(now)

  const { data: records } = await supabase
    .from("score_records")
    .select("category, points, session_date, note, created_at")
    .eq("profile_id", profile.id)
    .lte("session_date", today)
    .order("session_date", { ascending: false })
    .limit(100)

  const list = records ?? []

  const week = list
    .filter((r) => r.session_date >= weekStart)
    .reduce((s, r) => s + Number(r.points), 0)
  const month = list
    .filter((r) => r.session_date >= monthStart)
    .reduce((s, r) => s + Number(r.points), 0)

  const weekBreakdown = aggregateByCategory(list.filter((r) => r.session_date >= weekStart))
  const monthBreakdown = aggregateByCategory(list.filter((r) => r.session_date >= monthStart))

  return (
    <div className="space-y-5">
      <h1 className="font-heading text-xl font-extrabold">نقط الخدمة</h1>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="درجات الأسبوع" value={week} icon={Sparkles} iconClass="bg-coptic-gold-soft text-coptic-gold" />
        <StatCard label="درجات الشهر" value={month} icon={CalendarDays} iconClass="bg-coptic-teal/10 text-coptic-teal" />
      </div>

      {list.length === 0 ? (
        <EmptyState
          title="لا توجد درجات"
          description="درجاتك هتظهر هنا بعد أول تسجيل حضور"
        />
      ) : (
        <>
          <BreakdownCard title="تفاصيل الأسبوع" total={week} rows={weekBreakdown} />
          <BreakdownCard title="تفاصيل الشهر" total={month} rows={monthBreakdown} />
        </>
      )}
    </div>
  )
}

function aggregateByCategory(
  rows: { category: ScoringCategory; points: number }[]
): { category: ScoringCategory; label: string; points: number; count: number }[] {
  const map = new Map<ScoringCategory, { points: number; count: number }>()
  for (const r of rows) {
    const cur = map.get(r.category) ?? { points: 0, count: 0 }
    cur.points += Number(r.points)
    cur.count += 1
    map.set(r.category, cur)
  }
  return Array.from(map.entries())
    .map(([category, v]) => ({
      category,
      label: SCORING_CATEGORY_LABELS[category] ?? category,
      ...v,
    }))
    .sort((a, b) => b.points - a.points)
}

function BreakdownCard({
  title,
  total,
  rows,
}: {
  title: string
  total: number
  rows: { label: string; points: number; count: number }[]
}) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
      <div className="flex items-center justify-between">
        <p className="font-heading font-bold">{title}</p>
        <p className="font-heading text-lg font-extrabold text-coptic-teal">{total} نقطة</p>
      </div>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد تفاصيل بعد</p>
        ) : (
          rows.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <CalendarDays className="size-4 text-muted-foreground" />
                <p className="text-sm font-medium">{row.label}</p>
                {row.count > 1 ? (
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                    {row.count}×
                  </span>
                ) : null}
              </div>
              <p className="font-heading text-sm font-extrabold text-coptic-teal">
                +{row.points}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}