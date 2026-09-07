import { cn } from "cn"
import { CopticCross } from "./brand"

type EmptyStateProps = {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

/**
 * Friendly empty state used across the app instead of placeholder data.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card/60 px-6 py-10 text-center",
        className
      )}
    >
      <div className="flex size-14 items-center justify-center rounded-full bg-coptic-gold-soft text-coptic-gold">
        {icon ?? <CopticCross className="size-7" />}
      </div>
      <div className="space-y-1">
        <p className="font-heading font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-xs text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  )
}