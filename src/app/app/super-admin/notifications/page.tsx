import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Bell, Send } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { EmptyState } from "@/components/coptic/empty-state"

export const metadata: Metadata = { title: "الإشعارات" }

export default async function SuperAdminNotificationsPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const { data: sent } = await supabase
    .from("notifications")
    .select("id, title, body, sender_id, created_at")
    .order("created_at", { ascending: false })
    .limit(50)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-extrabold">الإشعارات</h1>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-xl bg-coptic-teal px-3 py-2 text-sm font-semibold text-primary-foreground"
        >
          <Send className="size-4" />
          إرسال إشعار
        </button>
      </div>

      {!sent || sent.length === 0 ? (
        <EmptyState
          icon={<Bell className="size-7" />}
          title="لا توجد إشعارات"
          description="الإشعارات المرسلة لكل الخدمة هتظهر هنا"
        />
      ) : (
        <div className="space-y-2">
          {sent.map((n) => (
            <div key={n.id} className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{n.title}</p>
                {n.sender_id === profile.id ? (
                  <span className="rounded-full bg-coptic-gold-soft px-2 py-0.5 text-[10px] font-bold text-coptic-gold">
                    أرسلته
                  </span>
                ) : null}
              </div>
              {n.body ? <p className="mt-1 text-sm text-muted-foreground">{n.body}</p> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}