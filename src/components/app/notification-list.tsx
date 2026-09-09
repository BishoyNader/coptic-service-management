"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import { markNotificationReadAction } from "@/app/actions/notifications"
import type { UserNotification } from "@/services/notification-service"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/coptic/empty-state"

function formatDate(value: string): string {
  return new Date(value).toLocaleString("ar-EG")
}

export function NotificationList({
  items,
  emptyTitle,
  emptyDescription,
}: {
  items: UserNotification[]
  emptyTitle: string
  emptyDescription: string
}) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Bell className="size-7" />}
        title={emptyTitle}
        description={emptyDescription}
      />
    )
  }

  const markRead = async (recipientId: string) => {
    setBusyId(recipientId)
    const res = await markNotificationReadAction(recipientId)
    setBusyId(null)
    if (!res.ok) {
      toast.error(res.message)
      return
    }
    window.dispatchEvent(new Event("notifications-updated"))
    router.refresh()
  }

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const unread = !item.readAt
        return (
          <article
            key={item.recipientId}
            className={cn(
              "rounded-2xl p-4 shadow-sm ring-1",
              unread
                ? "bg-coptic-gold-soft ring-coptic-gold/20"
                : "bg-card/60 ring-foreground/5"
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-[11px] font-bold",
                    unread ? "text-coptic-terra" : "text-muted-foreground"
                  )}
                >
                  {unread ? "● إشعار جديد" : "إشعار قديم"}
                </p>
                <h2 className="mt-0.5 font-heading font-extrabold leading-snug">
                  {item.title}
                </h2>
                {item.body ? (
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                ) : null}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {formatDate(item.createdAt)}
                </p>
              </div>

              {unread ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busyId === item.recipientId}
                  onClick={() => void markRead(item.recipientId)}
                >
                  {busyId === item.recipientId ? "…" : "تحديد كمقروء"}
                </Button>
              ) : (
                <CheckCircle2 className="mt-1 shrink-0 text-coptic-teal" />
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}