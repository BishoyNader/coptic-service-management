import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { audienceRolesFor } from "@/services/notification-service"
import { ROLES } from "@/lib/roles"
import { NotificationComposer } from "@/components/app/notification-composer"
import { NotificationSentList } from "@/components/app/notification-sent-list"
import { DeliveryLogList } from "@/components/app/delivery-log-list"

export const metadata: Metadata = { title: "الإشعارات" }

export default async function SuperAdminNotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<Record<string, string | string[]>>
  searchParams: Promise<{ page?: string; tab?: string }>
}) {
  void params
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const { page: pageParam, tab } = await searchParams
  const page = Math.max(1, Number(pageParam ?? "1") || 1)
  const activeTab = tab === "delivery-log" ? "delivery-log" : "sent"

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-xl font-extrabold">الإشعارات</h1>

      <NotificationComposer allowedAudiences={audienceRolesFor(profile.role)} />

      <section className="space-y-2">
        <div className="flex gap-2 border-b border-border pb-2">
          <a
            href="/app/super-admin/notifications?tab=sent"
            className={`rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === "sent"
                ? "bg-coptic-teal/10 text-coptic-teal"
                : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            الإشعارات المرسلة
          </a>
          <a
            href="/app/super-admin/notifications?tab=delivery-log"
            className={`rounded-xl px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === "delivery-log"
                ? "bg-coptic-teal/10 text-coptic-teal"
                : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            سجل التوصيل
          </a>
        </div>

        {activeTab === "delivery-log" ? (
          <DeliveryLogList supabase={supabase} page={page} />
        ) : (
          <NotificationSentList
            supabase={supabase}
            page={page}
            hrefBase="/app/super-admin/notifications?tab=sent"
            emptyTitle="لا توجد إشعارات مرسلة"
            emptyDescription="الإشعارات المرسلة لكل الخدمة هتظهر هنا"
          />
        )}
      </section>
    </div>
  )
}
