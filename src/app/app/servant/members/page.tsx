import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Users } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { LIST_PAGE_SIZE } from "@/lib/pagination"
import { EmptyState } from "@/components/coptic/empty-state"
import { AddMemberButton } from "@/components/app/add-member-button"
import { PaginationControls } from "@/components/app/pagination-controls"
import { ExportButton } from "@/components/app/export-button"
import { ImportUsersButton } from "@/components/app/import-users-button"
import { MemberCard } from "@/components/app/member-card"
import { MemberSearch } from "@/components/app/member-search"
import { exportMembersAction } from "@/app/actions/exports"
import { listActiveClasses } from "@/services/classes-service"
import { getServantClassId } from "@/services/member-scoring-service"
import { getMemberListStats } from "@/services/member-list-service"
import { getActiveStudyYear } from "@/services/study-year-service"

export const metadata: Metadata = { title: "المخدومين" }

export default async function ServantMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>
}) {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVANT) redirect("/")

  const admin = createAdminClient()
  const myClassId = await getServantClassId(admin, profile.id)

  const sp = await searchParams
  const rawPage = Number.parseInt(sp.page ?? "", 10) || 1
  const page = Math.max(1, rawPage)
  const from = (page - 1) * LIST_PAGE_SIZE
  const to = from + LIST_PAGE_SIZE - 1
  const q = (sp.q ?? "").trim()

  const [classes, studyYear] = await Promise.all([
    listActiveClasses(admin),
    getActiveStudyYear(admin),
  ])

  // Scoped to the servant's class (served_members reads are admin-granted);
  // an unassigned servant keeps the legacy any-member scope. No class filter
  // is offered here — the servant's class already *is* the filter.
  let query = admin
    .from("profiles")
    .select(
      myClassId
        ? "id, full_name, phone, status, avatar_url, served_members!inner(class_id, class)"
        : "id, full_name, phone, status, avatar_url, served_members(class_id, class)",
      { count: "exact" },
    )
    .eq("role", "SERVED_MEMBER")
    .order("full_name", { ascending: true })
    .order("id")

  if (myClassId) {
    query = query.eq("served_members.class_id", myClassId)
  }

  if (q) {
    query = query.ilike("full_name", `%${q}%`)
  }

  const { data: members, count } = await query.range(from, to)

  const memberRows = members ?? []
  const statsByMember = await getMemberListStats(
    admin,
    memberRows.map((m) => m.id),
    studyYear?.schedule ?? [],
  )

  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE))
  const activeSearchParams: Record<string, string> = {}
  if (q) activeSearchParams.q = q

  // The sheet/API writes the class FK; the legacy free-text column is only a
  // fallback, so resolve display names from the FK where possible.
  const classNameById = new Map(classes.map((c) => [c.id, c.name]))
  const classLabelOf = (detail: { class?: string; class_id?: string } | null) => {
    if (!detail) return null
    return classNameById.get(detail.class_id ?? "") ?? detail.class ?? null
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-extrabold">المخدومين</h1>
          <p className="text-sm text-muted-foreground">{total} مخدوم</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton action={exportMembersAction} label="تصدير CSV" />
          <ImportUsersButton role="SERVED_MEMBER" label="استيراد" classes={classes} />
          <AddMemberButton classes={classes} />
        </div>
      </div>

      <MemberSearch
        pathname="/app/servant/members"
        defaultValue={q}
        placeholder="ابحث بالاسم..."
      />

      {memberRows.length === 0 ? (
        <EmptyState
          icon={<Users className="size-7" />}
          title={q ? "لا توجد نتائج" : "لا يوجد مخدومين حتى الآن"}
          description={q ? "جرّب كلمة بحث مختلفة" : "لما تسجّل أو تضيف أول مخدوم، هيظهر هنا"}
          action={!q ? <AddMemberButton /> : undefined}
        />
      ) : (
        <>
          <div className="space-y-2">
            {memberRows.map((m) => (
              <MemberCard
                key={m.id}
                href={`/app/servant/members/${m.id}`}
                member={{
                  id: m.id,
                  fullName: m.full_name,
                  phone: m.phone,
                  avatarUrl: m.avatar_url,
                  className: classLabelOf(
                    m.served_members as { class?: string; class_id?: string } | null,
                  ),
                  status: m.status as "ACTIVE" | "INACTIVE" | "ARCHIVED",
                }}
                stats={statsByMember.get(m.id)}
              />
            ))}
          </div>

          <PaginationControls
            pathname="/app/servant/members"
            page={page}
            totalPages={totalPages}
            total={total}
            searchParams={activeSearchParams}
          />
        </>
      )}
    </div>
  )
}
