import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { audienceRolesFor, getUserNotifications } from "@/services/notification-service"
import { ROLES } from "@/lib/roles"
import { NotificationComposer } from "@/components/app/notification-composer"
import { NotificationSentList } from "@/components/app/notification-sent-list"
import { NotificationList } from "@/components/app/notification-list"

export const metadata: Metadata = { title: "الإشعارات" }

export default async function ServantNotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<Record<string, string | string[]>>
  searchParams: Promise<{ page?: string }>
}) {
  void params
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVANT) redirect("/")

  const { page: pageParam } = await searchParams
  const page = Math.max(1, Number(pageParam ?? "1") || 1)

  const items = await getUserNotifications(supabase)
  const unread = items.filter((i) => !i.readAt).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-xl font-extrabold">الإشعارات</h1>
        <p className="text-sm text-muted-foreground">إرسال واستقبال الإشعارات</p>
      </div>

      <NotificationComposer allowedAudiences={audienceRolesFor(profile.role)} />

      <section className="space-y-2">
        <p className="font-heading text-sm font-bold text-muted-foreground">الإشعارات المرسلة</p>
        <NotificationSentList
          supabase={supabase}
          page={page}
          hrefBase="/app/servant/notifications"
          emptyTitle="لا توجد إشعارات مرسلة"
          emptyDescription="الإشعارات اللي بتبعتها للمخدومين هتظهر هنا"
        />
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="font-heading text-sm font-bold text-muted-foreground">إشعاراتي</p>
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
      </section>
    </div>
  )
}
