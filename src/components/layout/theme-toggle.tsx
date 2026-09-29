"use client"

import { Sun, Moon, Monitor } from "lucide-react"
import { useTheme } from "next-themes"
import { cn } from "cn"

const ORDER: ("light" | "dark" | "system")[] = ["light", "dark", "system"]

/**
 * Round-robin theme toggle: light → dark → system → light …
 * Shows a different icon for each mode and announces the next mode
 * in the aria-label, mirroring the samaanshaaban.vercel.app portfolio.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme, resolvedTheme } = useTheme()

  const isDark = resolvedTheme === "dark"
  const label =
    theme === "system"
      ? "تفعيل الوضع الليلي"
      : isDark
        ? "التبديل للوضع النهاري"
        : "التبديل للوضع الليلي"

  const cycle = () => {
    const current = theme as "light" | "dark" | "system"
    const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]
    setTheme(next)
  }

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-full border border-border text-foreground transition-all duration-200 hover:border-coptic-teal hover:bg-coptic-teal/10 hover:text-coptic-teal",
        className
      )}
    >
      {theme === "system" ? (
        <Monitor className="size-5" />
      ) : isDark ? (
        <Sun className="size-5" />
      ) : (
        <Moon className="size-5" />
      )}
    </button>
  )
}
