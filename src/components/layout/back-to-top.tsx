"use client"

import { useEffect, useState } from "react"
import { ArrowUp } from "lucide-react"
import { cn } from "cn"

/**
 * Floating "scroll to top" button that fades in after scrolling down.
 * Inspired by the smooth scroll UX of the samaanshaaban.vercel.app portfolio.
 */
export function BackToTop({ className }: { className?: string }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  if (!visible) return null

  return (
    <button
      type="button"
      aria-label="الأعلى"
      title="الأعلى"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={cn(
        "fixed bottom-6 end-6 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg opacity-0 transition-all duration-300",
        visible && "opacity-100",
        className
      )}
    >
      <ArrowUp className="size-5" />
    </button>
  )
}