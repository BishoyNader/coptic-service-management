import Link from "next/link"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type { SupabaseServerClient } from "@/lib/supabase/server"
import { NOTIFICATION_AUDIENCE_LABELS } from "@/lib/constants"
import { formatArabicDateTime } from "@/lib/dates"
import { EmptyState } from "@/components/coptic/empty-state"
import { Bell } from "lucide-react"

const PAGE_SIZE = 20

function audienceLabel(raw: unknown): string {
  if (!Array.isArray(raw)) return ""
  const labels = raw
    .map((a) => NOTIFICATION_AUDIENCE_LABELS[a as keyof typeof NOTIFICATION_AUDIENCE_LABELS])
    .filter(Boolean)
  return labels.join(" و")
}

export async function NotificationSentList({
  supabase,
  page,
  hrefBase,
  emptyTitle,
  emptyDescription,
}: {
  supabase: SupabaseServerClient
  page: number
  hrefBase: string
  emptyTitle: string
  emptyDescription: string
}) {
  const from = (page - 1) * PAGE_SIZE
  const { data: rows, count } = await supabase
    .from("notifications")
    .select("id, title, body, audience, sender_id, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1)

  const sent = (rows ?? []) as Array<{
    id: string
    title: string
    body: string | null
    audience: unknown
    created_at: string
  }>

  const counts: Record<string, number> = {}
  const ids = sent.map((n) => n.id)
  if (ids.length > 0) {
    const { data: recipients } = await supabase
      .from("notification_recipients")
      .select("notification_id")
      .in("notification_id", ids)
    for (const r of recipients ?? []) {
      counts[r.notification_id] = (counts[r.notification_id] ?? 0) + 1
    }
  }

  const total = count ?? sent.length
  const hasNext = page * PAGE_SIZE < total

  if (sent.length === 0) {
    return (
      <EmptyState
        icon={<Bell className="size-7" />}
        title={emptyTitle}
        description={emptyDescription}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="hidden gap-3 md:grid md:grid-cols-12">
        {sent.map((n) => (
          <div
            key={n.id}
            className="grid-cols-[3fr_4fr_2fr_1fr_1.5fr] gap-4 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5 md:col-span-12 md:grid md:items-center"
          >
            <p className="font-semibold md:col-span-3">{n.title}</p>
            <p className="text-sm text-muted-foreground md:col-span-4 md:truncate">
              {n.body ?? ""}
            </p>
            <p className="text-sm text-muted-foreground md:col-span-2">
              {audienceLabel(n.audience)}
            </p>
            <p className="text-sm font-bold text-coptic-teal md:col-span-1">
              {counts[n.id] ?? 0}
            </p>
            <p className="text-[11px] text-muted-foreground md:col-span-2">
              {formatArabicDateTime(n.created_at)}
            </p>
          </div>
        ))}
      </div>

      <div className="space-y-2 md:hidden">
        {sent.map((n) => (
          <div key={n.id} className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">{n.title}</p>
              <span className="rounded-full bg-coptic-teal/10 px-2 py-0.5 text-[10px] font-bold text-coptic-teal">
                {counts[n.id] ?? 0} مستلم
              </span>
            </div>
            {n.body ? (
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{n.body}</p>
            ) : null}
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{audienceLabel(n.audience)}</span>
              <span>{formatArabicDateTime(n.created_at)}</span>
            </div>
          </div>
        ))}
      </div>

      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-between pt-2">
          {page > 1 ? (
            <Link
              href={`${hrefBase}?page=${page - 1}`}
              className="flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary"
            >
              <ChevronRight className="size-4" />
              السابق
            </Link>
          ) : (
            <span className="px-3 py-2 text-sm text-muted-foreground opacity-40">السابق</span>
          )}
          <span className="text-sm text-muted-foreground">صفحة {page}</span>
          {hasNext ? (
            <Link
              href={`${hrefBase}?page=${page + 1}`}
              className="flex items-center gap-1 rounded-xl border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary"
            >
              التالي
              <ChevronLeft className="size-4" />
            </Link>
          ) : (
            <span className="px-3 py-2 text-sm text-muted-foreground opacity-40">التالي</span>
          )}
        </div>
      ) : null}
    </div>
  )
}