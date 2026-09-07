import type { ReactNode } from "react"

export function CoverPhoto({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode
  title: string
  subtitle: string
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-coptic-teal text-primary-foreground">
      <div className="pointer-events-none absolute inset-0 coptic-lattice-gold opacity-60" />
      <div className="relative flex items-center gap-4 px-5 py-6">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur">
          {icon}
        </div>
        <div>
          <h1 className="font-heading text-2xl font-extrabold">{title}</h1>
          <p className="mt-0.5 text-sm text-primary-foreground/85">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}