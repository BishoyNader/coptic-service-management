import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Users } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { LIST_PAGE_SIZE } from "@/lib/pagination"
import { EmptyState } from "@/components/coptic/empty-state"
import { AddUserButton } from "@/components/app/add-user-button"
import { PaginationControls } from "@/components/app/pagination-controls"
import { ExportButton } from "@/components/app/export-button"
import { ImportUsersButton } from "@/components/app/import-users-button"
import { MemberCard } from "@/components/app/member-card"
import { ClassFilter } from "@/components/app/class-filter"
import { MemberSearch } from "@/components/app/member-search"
import { exportMembersAction } from "@/app/actions/exports"
import { listActiveClasses } from "@/services/classes-service"
import { countActiveMembersByClass, getMemberListStats } from "@/services/member-list-service"
import { getActiveStudyYear } from "@/services/study-year-service"

export const metadata: Metadata = { title: "المخدومين" }

export default async function SuperAdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; class?: string }>
}) {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const admin = createAdminClient()

  const sp = await searchParams
  const rawPage = Number.parseInt(sp.page ?? "", 10) || 1
  const page = Math.max(1, rawPage)
  const from = (page - 1) * LIST_PAGE_SIZE
  const to = from + LIST_PAGE_SIZE - 1
  const q = (sp.q ?? "").trim()

  const [classes, classCounts, studyYear] = await Promise.all([
    listActiveClasses(admin),
    countActiveMembersByClass(admin),
    getActiveStudyYear(admin),
  ])

  // A stale/unknown `?class=` id (e.g. a deleted class bookmark) falls back to
  // "all" instead of showing a confusing empty list.
  const selectedClassId =
    sp.class && classes.some((c) => c.id === sp.class) ? sp.class : null

  // The class filter is applied through the FK, so it works whether the member
  // was assigned by the import sheet, the add form, or a later edit.
  let query = supabase
    .from("profiles")
    .select(
      selectedClassId
        ? "id, full_name, phone, status, avatar_url, served_members!inner(class_id, class)"
        : "id, full_name, phone, status, avatar_url, served_members(class_id, class)",
      { count: "exact" },
    )
    .eq("role", "SERVED_MEMBER")
    .order("full_name", { ascending: true })
    .order("id")

  if (selectedClassId) {
    query = query.eq("served_members.class_id", selectedClassId)
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
  if (selectedClassId) activeSearchParams.class = selectedClassId

  // The sheet/API writes the class FK; the legacy free-text column is only a
  // fallback, so resolve display names from the FK where possible.
  const classNameById = new Map(classes.map((c) => [c.id, c.name]))
  const classLabelOf = (detail: { class?: string; class_id?: string } | null) => {
    if (!detail) return null
    return classNameById.get(detail.class_id ?? "") ?? detail.class ?? null
  }

  const isFiltering = Boolean(q || selectedClassId)
  const selectedClassName = selectedClassId ? classNameById.get(selectedClassId) : null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-extrabold">المخدومين</h1>
          <p className="text-sm text-muted-foreground">
            {total} مخدوم
            {selectedClassName ? ` في ${selectedClassName}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton action={exportMembersAction} label="تصدير CSV" />
          <ImportUsersButton role="SERVED_MEMBER" label="استيراد" classes={classes} />
          <AddUserButton label="إضافة مخدوم" defaultRole="SERVED_MEMBER" classes={classes} />
        </div>
      </div>

      <ClassFilter
        pathname="/app/super-admin/members"
        classes={classes.map((c) => ({ id: c.id, name: c.name, count: classCounts.byClass.get(c.id) ?? 0 }))}
        selectedClassId={selectedClassId}
        totalCount={classCounts.total}
        preserveParams={q ? { q } : {}}
      />

      <MemberSearch
        pathname="/app/super-admin/members"
        defaultValue={q}
        placeholder="ابحث بالاسم..."
        preserveParams={selectedClassId ? { class: selectedClassId } : {}}
      />

      {memberRows.length === 0 ? (
        <EmptyState
          icon={<Users className="size-7" />}
          title={isFiltering ? "لا توجد نتائج" : "لا يوجد مخدومين حتى الآن"}
          description={
            isFiltering
              ? "جرّب تغيير الصنف أو كلمة البحث"
              : "أول مخدوم بيبدأ الرحلة هنا"
          }
          action={
            !isFiltering ? (
              <AddUserButton label="إضافة مخدوم" defaultRole="SERVED_MEMBER" />
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="space-y-2">
            {memberRows.map((m) => (
              <MemberCard
                key={m.id}
                href={`/app/super-admin/user/${m.id}`}
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
            pathname="/app/super-admin/members"
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
