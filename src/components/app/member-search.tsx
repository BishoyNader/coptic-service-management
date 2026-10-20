"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Search } from "lucide-react"

/**
 * Name search for list pages.
 *
 * A plain GET form would drop any other active filter, so this navigates with
 * the preserved params merged in. Submitting always resets pagination.
 */
export function MemberSearch({
  pathname,
  defaultValue = "",
  placeholder = "ابحث...",
  preserveParams = {},
  ariaLabel = "البحث",
}: {
  pathname: string
  defaultValue?: string
  placeholder?: string
  /** Extra query params (e.g. the active class filter) to keep. */
  preserveParams?: Record<string, string>
  ariaLabel?: string
}) {
  const router = useRouter()
  const [value, setValue] = useState(defaultValue)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const params = new URLSearchParams()
    const term = value.trim()
    if (term) params.set("q", term)
    for (const [k, v] of Object.entries(preserveParams)) {
      if (v) params.set(k, v)
    }
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <form onSubmit={submit} className="relative">
      <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={ariaLabel}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-input bg-transparent ps-10 pe-4 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
      />
    </form>
  )
}
