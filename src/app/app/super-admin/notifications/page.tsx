import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { audienceRolesFor } from "@/services/notification-service"
import { ROLES } from "@/lib/roles"
import { NotificationComposer } from "@/components/app/notification-composer"
import { NotificationSentList } from "@/components/app/notification-sent-list"

export const metadata: Metadata = { title: "الإشعارات" }

export default async function SuperAdminNotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<Record<string, string | string[]>>
  searchParams: Promise<{ page?: string }>
}) {
  void params
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const { page: pageParam } = await searchParams
  const page = Math.max(1, Number(pageParam ?? "1") || 1)

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-xl font-extrabold">الإشعارات</h1>

      <NotificationComposer allowedAudiences={audienceRolesFor(profile.role)} />

      <section className="space-y-2">
        <p className="font-heading text-sm font-bold text-muted-foreground">الإشعارات المرسلة</p>
        <NotificationSentList
          supabase={supabase}
          page={page}
          hrefBase="/app/super-admin/notifications"
          emptyTitle="لا توجد إشعارات مرسلة"
          emptyDescription="الإشعارات المرسلة لكل الخدمة هتظهر هنا"
        />
      </section>
    </div>
  )
}