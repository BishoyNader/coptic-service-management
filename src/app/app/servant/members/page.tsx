import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Users, Phone, ChevronLeft, Search } from "lucide-react"
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
import { exportMembersAction } from "@/app/actions/exports"
import { listActiveClasses } from "@/services/classes-service"
import { getServantClassId } from "@/services/member-scoring-service"

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

  const classes = await listActiveClasses(admin)

  // Scoped to the servant's class (served_members reads are admin-granted);
  // an unassigned servant keeps the legacy any-member scope.
  let query = admin
    .from("profiles")
    .select(
      myClassId
        ? "id, full_name, phone, status, served_members!inner(class_id, class)"
        : "id, full_name, phone, status, served_members(class)",
      { count: "exact" }
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

  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE))
  const activeSearchParams: Record<string, string> = {}
  if (q) activeSearchParams.q = q

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-extrabold">المخدومين</h1>
          <p className="text-sm text-muted-foreground">{total} مخدوم</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton action={exportMembersAction} label="تصدير CSV" />
          <ImportUsersButton role="SERVED_MEMBER" label="استيراد" />
          <AddMemberButton classes={classes} />
        </div>
      </div>

      <form method="get" className="relative">
        <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          name="q"
          defaultValue={q}
          aria-label="البحث بالاسم"
          placeholder="ابحث بالاسم..."
          className="h-11 w-full rounded-xl border border-input bg-transparent ps-10 pe-4 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
        />
        <input type="hidden" name="page" value="" />
      </form>

      {!members || members.length === 0 ? (
        <EmptyState
          icon={<Users className="size-7" />}
          title={q ? "لا توجد نتائج" : "لا يوجد مخدومين حتى الآن"}
          description={q ? "جرّب كلمة بحث مختلفة" : "لما تسجّل أو تضيف أول مخدوم، هيظهر هنا"}
          action={!q ? <AddMemberButton /> : undefined}
        />
      ) : (
        <>
          <div className="space-y-2">
            {members.map((m) => (
              <Link
                key={m.id}
                href={`/app/servant/members/${m.id}`}
                className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5 transition-colors hover:bg-secondary/50"
              >
                <div className="flex size-11 items-center justify-center rounded-full bg-coptic-gold-soft font-heading font-bold text-coptic-gold">
                  {m.full_name.trim().charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.full_name}</p>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1" dir="ltr">
                      <Phone className="size-3" />
                      {m.phone}
                    </span>
                    {(m.served_members as { class?: string } | null)?.class && (
                      <span className="rounded-full bg-coptic-gold-soft px-2 py-0.5 text-[10px] font-medium text-coptic-gold">
                        {(m.served_members as { class?: string } | null)?.class}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronLeft className="size-5 text-muted-foreground" />
              </Link>
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
