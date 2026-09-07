import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Bell } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { EmptyState } from "@/components/coptic/empty-state"

export const metadata: Metadata = { title: "الإشعارات" }

type RecipientRow = {
  id: string
  read_at: string | null
  created_at: string
  notification: {
    title: string
    body: string | null
    created_at: string
  } | null
}

export default async function ServantNotificationsPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVANT) redirect("/")

  const { data } = await supabase
    .from("notification_recipients")
    .select("id, read_at, created_at, notification:notifications(title, body, created_at)")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(50)

  const recipients = (data ?? []) as unknown as RecipientRow[]

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-xl font-extrabold">الإشعارات</h1>

      {recipients.length === 0 ? (
        <EmptyState
          icon={<Bell className="size-7" />}
          title="لا توجد إشعارات"
          description="إشعارات الخدمة هتوصلك هنا"
        />
      ) : (
        <div className="space-y-2">
          {recipients.map((r) => (
            <div key={r.id} className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
              <p className="font-semibold">{r.notification?.title}</p>
              {r.notification?.body ? (
                <p className="mt-1 text-sm text-muted-foreground">{r.notification.body}</p>
              ) : null}
              <p className="mt-2 text-[11px] text-muted-foreground">
                {new Date(r.notification?.created_at ?? r.created_at).toLocaleString("ar-EG")}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}