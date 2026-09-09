"use client"

import { useEffect, useState, useCallback } from "react"
import { usePathname } from "next/navigation"
import { cn } from "cn"
import { getUnreadCountAction } from "@/app/actions/notifications"

/**
 * Small unread-count badge rendered on the notifications nav entry.
 * Refreshes on mount, on navigation and whenever pages dispatch the
 * "notifications-updated" window event (send / mark-as-read).
 */
export function NotificationBadge({ className }: { className?: string }) {
  const pathname = usePathname()
  const [count, setCount] = useState(0)

  const refresh = useCallback(async () => {
    const res = await getUnreadCountAction()
    setCount(res.count)
  }, [])

  useEffect(() => {
    const run = async () => {
      await refresh()
    }
    void run()
  }, [refresh, pathname])

  useEffect(() => {
    const handler = () => void refresh()
    window.addEventListener("notifications-updated", handler)
    return () => window.removeEventListener("notifications-updated", handler)
  }, [refresh])

  if (count === 0) return null

  return (
    <span
      aria-label="إشعارات غير مقروءة"
      className={cn(
        "flex h-5 min-w-5 items-center justify-center rounded-full bg-coptic-terra px-1 text-[10px] font-bold leading-none text-white",
        className
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  )
}