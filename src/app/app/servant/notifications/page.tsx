import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { getUserNotifications } from "@/services/notification-service"
import { ROLES } from "@/lib/roles"
import { NotificationList } from "@/components/app/notification-list"

export const metadata: Metadata = { title: "الإشعارات" }

export default async function ServantNotificationsPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVANT) redirect("/")

  const items = await getUserNotifications(supabase)
  const unread = items.filter((i) => !i.readAt).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-extrabold">الإشعارات</h1>
        {unread > 0 ? (
          <span className="rounded-full bg-coptic-terra px-2.5 py-1 text-xs font-bold text-white">
            {unread} جديد
          </span>
        ) : null}
      </div>

      <NotificationList
        items={items}
        emptyTitle="مفيش إشعارات جديدة"
        emptyDescription="هتظهر هنا أي إشعارات توصلك من الخدمة."
      />
    </div>
  )
}