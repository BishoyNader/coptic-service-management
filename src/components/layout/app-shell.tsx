"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import { Bell, LogOut, type LucideIcon } from "lucide-react"
import { cn } from "cn"
import { CopticBadge } from "@/components/coptic/brand"
import { createClient } from "@/lib/supabase/client"
import type { NavItem } from "@/lib/constants"
import { MOBILE_TAB_LIMIT } from "@/lib/constants"
import { NAV_ICONS } from "./nav-icons"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"

function Icon({ name, className }: { name: string; className?: string }) {
  const Cmp = NAV_ICONS[name] ?? (Bell as LucideIcon)
  return <Cmp className={className} />
}

type AppShellProps = {
  roleLabel: string
  name: string
  nav: NavItem[]
  children: React.ReactNode
}

export function AppShell({ roleLabel, name, nav, children }: AppShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const isActive = (href: string) => pathname === href

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace("/login")
    router.refresh()
  }

  const openItem = nav.find((n) => isActive(n.href))
  const title = openItem?.label ?? "الرئيسية"

  const extraItems = nav.slice(MOBILE_TAB_LIMIT)
  const tabItems = extraItems.length > 0 ? nav.slice(0, MOBILE_TAB_LIMIT - 1) : nav

  return (
    <div className="min-h-dvh bg-background">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 start-0 z-40 hidden w-64 flex-col border-e border-border bg-card/70 backdrop-blur md:flex">
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-5">
          <CopticBadge className="size-9" />
          <div className="leading-tight">
            <p className="font-heading font-bold">خدمتي</p>
            <p className="text-[11px] text-muted-foreground">{roleLabel}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors",
                isActive(item.href)
                  ? "bg-coptic-teal text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <Icon name={item.icon} className="size-4.5" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <div className="mb-2 flex items-center gap-3 px-2">
            <div className="flex size-9 items-center justify-center rounded-full bg-coptic-gold-soft font-bold text-coptic-gold">
              {name.trim().charAt(0) || "؟"}
            </div>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold">{name}</p>
              <p className="text-[11px] text-muted-foreground">{roleLabel}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="size-4.5" />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-card/80 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-2">
          <CopticBadge className="size-8" />
          <p className="font-heading text-sm font-bold">{title}</p>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="فتح القائمة"
          className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-secondary"
        >
          <Icon name="menu" className="size-5" />
        </button>
      </header>

      {/* Mobile menu sheet */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent
          side="bottom"
          className="gap-1 overflow-y-auto px-3 pb-8"
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-base">
              <CopticBadge className="size-7" />
              {name}
            </SheetTitle>
          </SheetHeader>
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileMenuOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium transition-colors",
                isActive(item.href)
                  ? "bg-coptic-teal text-primary-foreground"
                  : "text-foreground hover:bg-secondary"
              )}
            >
              <Icon name={item.icon} className="size-4.5" />
              {item.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-3 rounded-xl bg-destructive/10 px-3.5 py-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20"
          >
            <LogOut className="size-4.5" />
            تسجيل الخروج
          </button>
        </SheetContent>
      </Sheet>

      {/* Mobile content */}
      <div className="pb-24 md:ms-64 md:pb-0">
        <main className="mx-auto max-w-3xl px-4 py-5 md:px-8 md:py-8">
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-safe backdrop-blur md:hidden">
        <nav className="mx-auto flex max-w-md items-stretch justify-around px-2 pt-1.5">
          {tabItems.map((item) => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl py-2 text-[11px] font-medium transition-colors",
                  active ? "text-coptic-teal" : "text-muted-foreground"
                )}
              >
                <Icon name={item.icon} className="size-5" />
                {item.label}
              </Link>
            )
          })}
          {extraItems.length > 0 ? (
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl py-2 text-[11px] font-medium text-muted-foreground"
            >
              <Icon name="menu" className="size-5" />
              المزيد
            </button>
          ) : null}
        </nav>
      </div>
    </div>
  )
}