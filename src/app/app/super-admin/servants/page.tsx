import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { HeartHandshake, Phone } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { LIST_PAGE_SIZE } from "@/lib/pagination"
import { EmptyState } from "@/components/coptic/empty-state"
import { AddUserButton } from "@/components/app/add-user-button"
import { PaginationControls } from "@/components/app/pagination-controls"

export const metadata: Metadata = { title: "الخدام" }

export default async function SuperAdminServantsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const sp = await searchParams
  const rawPage = Number.parseInt(sp.page ?? "", 10) || 1
  const page = Math.max(1, rawPage)
  const from = (page - 1) * LIST_PAGE_SIZE
  const to = from + LIST_PAGE_SIZE - 1

  const { data: servants, count } = await supabase
    .from("profiles")
    .select("id, full_name, phone, status, servants(service_name)", { count: "exact" })
    .eq("role", "SERVANT")
    .order("full_name", { ascending: true })
    .order("id")
    .range(from, to)

  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-extrabold">الخدام</h1>
          <p className="text-sm text-muted-foreground">{total} خادم</p>
        </div>
        <AddUserButton label="إضافة خادم" defaultRole="SERVANT" />
      </div>

      {!servants || servants.length === 0 ? (
        <EmptyState
          icon={<HeartHandshake className="size-7" />}
          title="لا يوجد خدام حتى الآن"
          description="الخدام بيتابعوا الخدمة من هنا"
          action={<AddUserButton label="إضافة خادم" defaultRole="SERVANT" />}
        />
      ) : (
        <>
          <div className="space-y-2">
            {servants.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5"
              >
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-coptic-teal font-heading font-bold text-primary-foreground">
                  {s.full_name.trim().charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.full_name}</p>
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground" dir="ltr">
                    <Phone className="size-3" />
                    {s.phone}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <PaginationControls
            pathname="/app/super-admin/servants"
            page={page}
            totalPages={totalPages}
            total={total}
          />
        </>
      )}
    </div>
  )
}