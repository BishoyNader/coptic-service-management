import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Users, Pencil, Trash2, Phone } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { EmptyState } from "@/components/coptic/empty-state"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = { title: "المخدومين" }

export default async function SuperAdminMembersPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const { data: members, count } = await supabase
    .from("profiles")
    .select("id, full_name, phone, status, date_of_birth", { count: "exact" })
    .eq("role", "SERVED_MEMBER")
    .order("full_name", { ascending: true })
    .limit(200)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-extrabold">المخدومين</h1>
          <p className="text-sm text-muted-foreground">
            {count ?? 0} مخدوم
          </p>
        </div>
        <Button className="gap-1.5">
          <span className="text-lg leading-none">+</span>
          إضافة
        </Button>
      </div>

      {!members || members.length === 0 ? (
        <EmptyState
          icon={<Users className="size-7" />}
          title="لا يوجد مخدومين حتى الآن"
          description="أول مخدوم بيبدأ الرحلة هنا"
          action={<Button className="gap-1.5"><span className="text-lg leading-none">+</span> إضافة مخدوم</Button>}
        />
      ) : (
        <div className="space-y-2">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5"
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
              <button
                type="button"
                aria-label="تعديل"
                className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Pencil className="size-4" />
              </button>
              <button
                type="button"
                aria-label="حذف"
                className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}