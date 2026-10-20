"use client"

import { useRouter } from "next/navigation"
import { cn } from "cn"

export type ClassFilterOption = { id: string; name: string; count?: number }

/**
 * Class filter for the members list.
 *
 * Rendered as real links (not a form control) so filtering works without JS
 * and each class is directly shareable/bookmarkable via `?class=<id>`.
 * "الكل" clears the filter.
 */
export function ClassFilter({
  pathname,
  classes,
  selectedClassId,
  totalCount,
  preserveParams = {},
}: {
  pathname: string
  classes: ClassFilterOption[]
  selectedClassId: string | null
  /** Count shown on the "الكل" chip. */
  totalCount?: number
  /** Extra query params (e.g. search) to keep while switching class. */
  preserveParams?: Record<string, string>
}) {
  const router = useRouter()

  const hrefFor = (classId: string | null) => {
    const params = new URLSearchParams()
    if (classId) params.set("class", classId)
    for (const [k, v] of Object.entries(preserveParams)) {
      if (v) params.set(k, v)
    }
    // Filters always reset pagination.
    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  if (classes.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <FilterChip
        active={!selectedClassId}
        label="الكل"
        count={totalCount}
        onClick={() => router.push(hrefFor(null))}
      />
      {classes.map((c) => (
        <FilterChip
          key={c.id}
          active={selectedClassId === c.id}
          label={c.name}
          count={c.count}
          onClick={() => router.push(hrefFor(c.id))}
        />
      ))}
    </div>
  )
}

function FilterChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-coptic-teal text-primary-foreground"
          : "bg-secondary/60 text-muted-foreground hover:bg-secondary",
      )}
    >
      {label}
      {typeof count === "number" && (
        <span
          className={cn(
            "rounded-full px-1.5 text-[10px] tabular-nums",
            active ? "bg-primary-foreground/20" : "bg-background/70",
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}
