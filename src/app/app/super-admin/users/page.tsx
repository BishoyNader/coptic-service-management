import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES, type AppRole } from "@/lib/roles"
import { UsersList } from "@/components/app/users-list"
import { AddUserButton } from "@/components/app/add-user-button"
import { AddPrivilegedUserButton } from "@/components/app/add-privileged-user-button"
import { adminUpdateStatusAction } from "@/app/actions/profile"
import { LIST_PAGE_SIZE } from "@/lib/pagination"
import { loadMoreUsersAction } from "@/app/actions/listing"

export const metadata: Metadata = { title: "المستخدمين" }

export default async function SuperAdminUsersPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const { data, count } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role, status", { count: "exact" })
    .order("full_name", { ascending: true })
    .order("id")
    .range(0, LIST_PAGE_SIZE - 1)

  const users = (data ?? []) as unknown as {
    id: string
    full_name: string
    phone: string
    role: AppRole
    status: "ACTIVE" | "INACTIVE" | "ARCHIVED"
  }[]

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-extrabold">المستخدمين</h1>
          <p className="text-sm text-muted-foreground">
            كل حسابات الخدمة — {count ?? users.length} مستخدم
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AddPrivilegedUserButton />
          <AddUserButton defaultRole="SERVED_MEMBER" />
        </div>
      </div>

      <UsersList
        users={users}
        homePrefix="/app/super-admin"
        onToggleStatus={adminUpdateStatusAction}
        loadMore={loadMoreUsersAction}
      />
    </div>
  )
}