import type { SupabaseServerClient } from "@/lib/supabase/server"
import { formatArabicDateTime } from "@/lib/dates"
import { EmptyState } from "@/components/coptic/empty-state"
import { Bell } from "lucide-react"

const STATUS_LABELS: Record<string, string> = {
  QUEUED: "قيد الانتظار",
  SENT: "تم الإرسال",
  DELIVERED: "تم التوصيل",
  FAILED: "فشل الإرسال",
  PROVIDER_NOT_CONFIGURED: "الخدمة غير مُعدة",
}

const CHANNEL_LABELS: Record<string, string> = {
  IN_APP: "داخل التطبيق",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
}

const STATUS_STYLES: Record<string, string> = {
  QUEUED: "bg-muted text-muted-foreground",
  SENT: "bg-blue-100 text-blue-700",
  DELIVERED: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-700",
  PROVIDER_NOT_CONFIGURED: "bg-yellow-100 text-yellow-700",
}

const PAGE_SIZE = 20

export async function DeliveryLogList({
  supabase,
  page,
}: {
  supabase: SupabaseServerClient
  page: number
}) {
  const from = (page - 1) * PAGE_SIZE
  const { data: rows, count } = await supabase
    .from("notification_deliveries")
    .select(
      "id, channel, status, provider, provider_message_id, error_code, error_message, attempted_at, delivered_at, notification:notifications(title), recipient_profile_id",
      { count: "exact" }
    )
    .order("attempted_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1)

  const deliveries = (rows ?? []) as unknown as Array<{
    id: string
    channel: string
    status: string
    provider: string | null
    provider_message_id: string | null
    error_code: string | null
    error_message: string | null
    attempted_at: string
    delivered_at: string | null
    notification: { title: string } | null
    recipient_profile_id: string
  }>

  // Fetch recipient names
  const recipientIds = [...new Set(deliveries.map((d) => d.recipient_profile_id))]
  const recipientMap: Record<string, string> = {}
  if (recipientIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", recipientIds)
    for (const p of profiles ?? []) {
      recipientMap[p.id as string] = p.full_name as string
    }
  }

  const total = count ?? deliveries.length
  const hasNext = page * PAGE_SIZE < total

  if (deliveries.length === 0) {
    return (
      <EmptyState
        icon={<Bell className="size-7" />}
        title="لا توجد سجلات توصيل"
        description="سجل توصيل الإشعارات سيظهر هنا"
      />
    )
  }

  return (
    <div className="space-y-2">
      <div className="space-y-2">
        {deliveries.map((d) => (
          <div
            key={d.id}
            className="rounded-2xl bg-card p-3 shadow-sm ring-1 ring-foreground/5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">
                  {d.notification?.title ?? "إشعار"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  إلى: {recipientMap[d.recipient_profile_id] ?? "مستخدم"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">
                  {CHANNEL_LABELS[d.channel] ?? d.channel}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[d.status] ?? ""}`}
                >
                  {STATUS_LABELS[d.status] ?? d.status}
                </span>
              </div>
            </div>
            {d.error_message && (
              <p className="mt-1 text-[10px] text-red-500 truncate">
                {d.error_message}
              </p>
            )}
            {d.provider_message_id && (
              <p className="mt-0.5 text-[10px] text-muted-foreground font-mono">
                ID: {d.provider_message_id.slice(0, 20)}…
              </p>
            )}
            <p className="mt-1 text-[10px] text-muted-foreground">
              {formatArabicDateTime(d.attempted_at)}
            </p>
          </div>
        ))}
      </div>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-4 pt-2 text-sm">
          {page > 1 ? (
            <a
              href={`?page=${page - 1}`}
              className="rounded-xl border border-border px-3 py-2 font-medium transition-colors hover:bg-secondary"
            >
              السابق
            </a>
          ) : (
            <span className="px-3 py-2 text-muted-foreground opacity-40">السابق</span>
          )}
          <span className="text-muted-foreground">صفحة {page}</span>
          {hasNext ? (
            <a
              href={`?page=${page + 1}`}
              className="rounded-xl border border-border px-3 py-2 font-medium transition-colors hover:bg-secondary"
            >
              التالي
            </a>
          ) : (
            <span className="px-3 py-2 text-muted-foreground opacity-40">التالي</span>
          )}
        </div>
      )}
    </div>
  )
}
