import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { getServantClassId, listActiveMembers } from "@/services/member-scoring-service"
import { ScoringEntry } from "@/components/app/scoring-entry"
import { EmptyState } from "@/components/coptic/empty-state"

export const metadata: Metadata = { title: "الدرجات" }

export default async function ServantScoresPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVANT) redirect("/")

  const admin = createAdminClient()
  const myClassId = await getServantClassId(admin, profile.id)

  let members: { id: string; full_name: string }[] = []
  let className: string | null = null
  if (myClassId) {
    const [{ data: cls }, classMembers] = await Promise.all([
      admin.from("classes").select("name").eq("id", myClassId).maybeSingle(),
      listActiveMembers(admin, myClassId),
    ])
    className = (cls?.name as string | null | undefined) ?? null
    members = classMembers
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-xl font-extrabold">سجل درجات الأسبوع</h1>
        <p className="text-sm text-muted-foreground">
          اختار المخدوم، شاهد حضوره تلقائيًا، ثم سجّل الالتزام والتونية والتناول بسرعة
        </p>
        {className && (
          <span className="mt-2 inline-block rounded-full bg-coptic-teal/10 px-3 py-1 text-xs font-bold text-coptic-teal">
            صفّك: {className}
          </span>
        )}
      </div>

      {members.length === 0 ? (
        <EmptyState
          title={myClassId ? "لا يوجد مخدومون في صفّك" : "لم يُحدَّد صفّك بعد"}
          description={
            myClassId
              ? "أضف مخدومين لصفّك ليظهروا هنا لتسجيل الدرجات"
              : "اطلب من مسؤول الخدمة تحديد صفّك لتظهر لك مخدومين صفّك"
          }
        />
      ) : (
        <ScoringEntry members={members} />
      )}
    </div>
  )
}