"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "cn"
import { fridayIndexIn, nextFridayIn, previousFridayIn } from "@/lib/friday"
import { formatArabicDate } from "@/lib/dates"

type FridayPickerProps = {
  schedule: string[]
  selected: string
  /** Controlled mode: called with the new Friday date. */
  onChange?: (friday: string) => void
  /** URL mode: search param key to update (default: "friday"). Used when no onChange. */
  searchParamKey?: string
  label?: string
  disabled?: boolean
  compact?: boolean
}

/**
 * Reusable Friday date picker — select dropdown + prev/next chevrons.
 *
 * Two modes:
 *  - Controlled: pass `onChange` — called with the new date string.
 *  - URL mode: no `onChange` — navigates via `?friday=YYYY-MM-DD` search param.
 */
export function FridayPicker({
  schedule,
  selected,
  onChange,
  searchParamKey = "friday",
  label = "اختار جمعة",
  disabled = false,
  compact = false,
}: FridayPickerProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const navigate = useCallback(
    (date: string) => {
      if (onChange) {
        onChange(date)
      } else {
        const params = new URLSearchParams(searchParams.toString())
        params.set(searchParamKey, date)
        router.push(`?${params.toString()}`)
      }
    },
    [onChange, router, searchParams, searchParamKey]
  )

  if (schedule.length === 0) return null

  const fridayNo = fridayIndexIn(schedule, selected) + 1
  const atFirst = selected === schedule[0]
  const atLast = !nextFridayIn(schedule, selected)

  return (
    <div className="flex items-center gap-1.5">
      <Calendar className="size-4 shrink-0 text-muted-foreground" />
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          const prev = previousFridayIn(schedule, selected)
          if (prev) navigate(prev)
        }}
        disabled={atFirst || disabled}
        aria-label="الجمعة السابقة"
      >
        <ChevronRight className="size-4" />
      </Button>
      <select
        aria-label={label}
        value={selected}
        onChange={(e) => navigate(e.target.value)}
        disabled={disabled}
        className={cn(
          "rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-xs font-medium outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40",
          compact ? "max-w-[180px]" : ""
        )}
      >
        {schedule.map((f, i) => (
          <option key={f} value={f}>
            جمعة {i + 1} — {formatArabicDate(f)}
          </option>
        ))}
      </select>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          const next = nextFridayIn(schedule, selected)
          if (next) navigate(next)
        }}
        disabled={atLast || disabled}
        aria-label="الجمعة التالية"
      >
        <ChevronLeft className="size-4" />
      </Button>
      <span className="text-[10px] text-muted-foreground">
        {fridayNo}/{schedule.length}
      </span>
    </div>
  )
}
