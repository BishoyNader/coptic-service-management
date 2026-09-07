import { cn } from "cn"

type CopticCrossProps = {
  className?: string
  strokeWidth?: number
}

/**
 * A subtle, modern rendition of the Coptic cross.
 * Inspired by the classic Coptic cross with flared arms and a
 * square center carving typical of church iconography.
 */
export function CopticCross({
  className,
  strokeWidth = 1.6,
}: CopticCrossProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <path d="M12 2.5v19M2.5 12h19" />
      <path d="M12 7.5l2.6-3 2.2.6-2.1 3.1M12 7.5L9.4 4.5l-2.2.6 2.1 3.1M12 16.5l2.6 3 2.2-.6-2.1-3.1M12 16.5l-2.6 3-2.2-.6 2.1-3.1" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * Small equilateral cross inside a circle — used as the app badge.
 */
export function CopticBadge({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <circle cx="12" cy="12" r="11" className="fill-coptic-gold-soft" />
      <g className="stroke-coptic-teal" strokeWidth="1.8" strokeLinecap="round">
        <path d="M12 3.5v17M3.5 12h17M12 6.5l1.9-2.2M12 6.5L10.1 4.3M12 17.5l1.9 2.2M12 17.5l-1.9 2.2" />
      </g>
      <rect
        x="8.8"
        y="8.8"
        width="6.4"
        height="6.4"
        rx="1.2"
        className="stroke-coptic-teal"
        strokeWidth="1.6"
      />
      <circle cx="12" cy="12" r="1.3" className="fill-coptic-teal" />
    </svg>
  )
}

export function BrandMark({
  className,
  titleClassName,
}: {
  className?: string
  titleClassName?: string
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <CopticBadge className="size-9" />
      <div className="leading-tight">
        <p
          className={cn(
            "font-heading text-lg font-bold text-foreground",
            titleClassName
          )}
        >
          كنيسة الخدمة
        </p>
        <p className="text-[11px] font-medium text-muted-foreground">
          كنيسة القديسين للخدمات
        </p>
      </div>
    </div>
  )
}

/**
 * Ornamental Egyptian-Nile divider inspired by flowing river waves.
 */
export function NileDivider({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 12"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn("h-3 w-full text-coptic-gold/40", className)}
    >
      <path
        d="M0 6c10-5 20 5 30 0s20-5 30 0 20 5 30 0 20-5 30 0v6H0z"
        fill="currentColor"
        opacity="0.5"
      />
      <path
        d="M0 8c10-4 20 4 30 0s20-4 30 0 20 4 30 0 20-4 30 0v4H0z"
        fill="currentColor"
        opacity="0.7"
      />
    </svg>
  )
}