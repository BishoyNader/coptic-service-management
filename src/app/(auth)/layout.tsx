import type { ReactNode } from "react"
import { CopticBadge } from "@/components/coptic/brand"

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 coptic-lattice" />
      <div className="pointer-events-none absolute -top-32 -left-32 size-96 rounded-full bg-coptic-gold-soft opacity-70 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 -bottom-40 size-96 rounded-full bg-coptic-teal/10 blur-3xl" />

      <header className="relative z-10 flex items-center gap-2.5 px-5 pt-6">
        <CopticBadge className="size-10" />
        <div className="leading-tight">
          <p className="font-heading text-lg font-bold">خدمتي</p>
          <p className="text-[11px] text-muted-foreground">
            كنيسة القديسين للخدمات
          </p>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-10 pt-6">
        {children}
      </main>
    </div>
  )
}