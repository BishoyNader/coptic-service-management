import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Bell, Plus } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { EmptyState } from "@/components/coptic/empty-state"

export const metadata: Metadata = { title: "الإشعارات" }

export default async function AdminNotificationsPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.ADMIN) redirect("/")

  const { data: sent } = await supabase
    .from("notifications")
    .select("id, title, body, created_at")
    .order("created_at", { ascending: false })
    .limit(50)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-extrabold">الإشعارات</h1>
        <button
          type="button"
          className="flex items-center gap-1 rounded-xl bg-coptic-teal px-3 py-2 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="size-4" />
          إشعار جديد
        </button>
      </div>

      {!sent || sent.length === 0 ? (
        <EmptyState
          icon={<Bell className="size-7" />}
          title="لا توجد إشعارات"
          description="الإشعارات اللي بتبعتها للمخدومين هتظهر هنا"
        />
      ) : (
        <div className="space-y-2">
          {sent.map((n) => (
            <div key={n.id} className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
              <p className="font-semibold">{n.title}</p>
              {n.body ? <p className="mt-1 text-sm text-muted-foreground">{n.body}</p> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}