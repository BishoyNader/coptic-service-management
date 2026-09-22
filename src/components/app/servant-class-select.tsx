"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { adminSetServantClassAction } from "@/app/actions/class-desk"

/**
 * Super Admin only: assign (or clear) the class of an existing servant from
 * the servants list. All magic commented out — the write goes through the
 * super-admin-gated server action.
 */
export function ServantClassSelect({
  servantId,
  classes,
  currentClassId,
}: {
  servantId: string
  classes: { id: string; name: string }[]
  currentClassId: string | null
}) {
  const [busy, setBusy] = useState(false)

  const handleChange = async (value: string) => {
    const next = value || null
    if (next === currentClassId) return
    setBusy(true)
    const res = await adminSetServantClassAction(servantId, next)
    setBusy(false)
    if (res.ok) toast.success(res.message)
    else toast.error(res.message)
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {busy ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : null}
      <select
        aria-label="صف الخادم"
        value={currentClassId ?? ""}
        disabled={busy}
        onChange={(e) => void handleChange(e.target.value)}
        className="rounded-lg border border-input bg-card px-2 py-1.5 text-xs"
      >
        <option value="">بدون صف</option>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  )
}