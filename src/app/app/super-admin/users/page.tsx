import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Shield } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES, ROLE_LABELS, type AppRole } from "@/lib/roles"
import { EmptyState } from "@/components/coptic/empty-state"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = { title: "المستخدمين" }

export default async function SuperAdminUsersPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const { data: admins } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role")
    .in("role", ["ADMIN", "SUPER_ADMIN"])
    .order("full_name", { ascending: true })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-extrabold">المسؤولين</h1>
        <Button className="gap-1.5">
          <span className="text-lg leading-none">+</span>
          إضافة مسؤول
        </Button>
      </div>

      {!admins || admins.length === 0 ? (
        <EmptyState
          icon={<Shield className="size-7" />}
          title="لا يوجد مسؤولين"
          description="المسؤولين بيتحكموا في البيانات والإعدادات"
          action={<Button className="gap-1.5"><span className="text-lg leading-none">+</span> إضافة مسؤول</Button>}
        />
      ) : (
        <div className="space-y-2">
          {admins.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5"
            >
              <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-coptic-navy font-heading font-bold text-primary-foreground">
                {a.full_name.trim().charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{a.full_name}</p>
                <p className="text-[11px] text-muted-foreground">{a.phone}</p>
              </div>
              <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-bold text-foreground">
                {ROLE_LABELS[a.role as AppRole]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}