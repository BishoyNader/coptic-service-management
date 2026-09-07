import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Cake } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { daysUntilBirthday, formatArabicDate } from "@/lib/dates"
import { EmptyState } from "@/components/coptic/empty-state"

export const metadata: Metadata = { title: "أعياد الميلاد" }

export default async function AdminBirthdaysPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.ADMIN) redirect("/")

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, date_of_birth")
    .eq("role", "SERVED_MEMBER")
    .not("date_of_birth", "is", null)
    .limit(500)

  const rows = (profiles ?? [])
    .filter((p) => p.date_of_birth)
    .map((p) => ({
      id: p.id,
      name: p.full_name,
      date: p.date_of_birth!,
      days: daysUntilBirthday(p.date_of_birth!),
    }))
    .filter((r) => r.days >= 0 && r.days <= 30)
    .sort((a, b) => a.days - b.days)
    .slice(0, 15)

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-xl font-extrabold">أعياد الميلاد القادمة</h1>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Cake className="size-7" />}
          title="لا توجد أعياد قريبة"
          description="أعياد الميلاد اللي في خلال 30 يوم هتظهر هنا"
        />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5"
            >
              <div className="flex size-11 items-center justify-center rounded-full bg-coptic-gold-soft">
                <Cake className="size-5 text-coptic-gold" />
              </div>
              <div className="flex-1">
                <p className="font-medium">🎂 {r.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {formatArabicDate(r.date)} — بعد {r.days} يوم
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}