import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { listScorableMembers } from "@/services/scoring-service"
import { ScoringEntry } from "@/components/app/scoring-entry"
import { EmptyState } from "@/components/coptic/empty-state"

export const metadata: Metadata = { title: "الدرجات" }

export default async function AdminScoresPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.ADMIN) redirect("/")

  const members = await listScorableMembers(supabase)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-xl font-extrabold">سجل درجات الأسبوع</h1>
        <p className="text-sm text-muted-foreground">
          اختار المخدوم، شاهد حضوره تلقائيًا، ثم سجّل الالتزام والتونية والتناول بسرعة
        </p>
      </div>

      {members.length === 0 ? (
        <EmptyState
          title="لا يوجد مخدومون نشطون"
          description="أضف مخدوما من صفحة المخدومين لبدء تسجيل الدرجات"
        />
      ) : (
        <ScoringEntry members={members} />
      )}
    </div>
  )
}