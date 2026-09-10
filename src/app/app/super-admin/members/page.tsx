import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Users, Phone, ChevronLeft, Search } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { LIST_PAGE_SIZE } from "@/lib/pagination"
import { EmptyState } from "@/components/coptic/empty-state"
import { AddUserButton } from "@/components/app/add-user-button"
import { PaginationControls } from "@/components/app/pagination-controls"
import { ExportButton } from "@/components/app/export-button"
import { exportMembersAction } from "@/app/actions/exports"

export const metadata: Metadata = { title: "المخدومين" }

export default async function SuperAdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>
}) {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const sp = await searchParams
  const rawPage = Number.parseInt(sp.page ?? "", 10) || 1
  const page = Math.max(1, rawPage)
  const from = (page - 1) * LIST_PAGE_SIZE
  const to = from + LIST_PAGE_SIZE - 1
  const q = (sp.q ?? "").trim()

  let query = supabase
    .from("profiles")
    .select("id, full_name, phone, status, date_of_birth", { count: "exact" })
    .eq("role", "SERVED_MEMBER")
    .order("full_name", { ascending: true })
    .order("id")

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
          <AddUserButton label="إضافة مخدوم" defaultRole="SERVED_MEMBER" />
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
          description={q ? "جرّب كلمة بحث مختلفة" : "أول مخدوم بيبدأ الرحلة هنا"}
          action={!q ? <AddUserButton label="إضافة مخدوم" defaultRole="SERVED_MEMBER" /> : undefined}
        />
      ) : (
        <>
          <div className="space-y-2">
            {members.map((m) => (
              <Link
                key={m.id}
                href={`/app/super-admin/user/${m.id}`}
                className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5 transition-colors hover:bg-secondary/50"
              >
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-coptic-gold-soft font-heading font-bold text-coptic-gold">
                  {m.full_name.trim().charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{m.full_name}</p>
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground" dir="ltr">
                    <Phone className="size-3" />
                    {m.phone}
                  </p>
                </div>
                <ChevronLeft className="size-5 shrink-0 text-muted-foreground" />
              </Link>
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