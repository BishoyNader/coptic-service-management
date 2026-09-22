"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"
import { adminSetServantClassAction } from "@/app/actions/class-desk"

/**
 * Super Admin only: assign (or clear) the class of an existing servant from
 * the servants list.
 *
 * The select is a draft — changing the option never writes anything. The
 * "حفظ" button appears only when the selection differs from the persisted
 * class and confirms the save; the page is refreshed so every list (servants,
 * class desk, ...) reflects the new assignment without a manual reload.
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
  const router = useRouter()
  const [draft, setDraft] = useState<string | null>(currentClassId)
  const [busy, setBusy] = useState(false)

  const dirty = draft !== currentClassId

  const save = async () => {
    if (!dirty || busy) return
    setBusy(true)
    const res = await adminSetServantClassAction(servantId, draft)
    setBusy(false)
    if (res.ok) {
      toast.success(res.message)
      router.refresh()
    } else {
      toast.error(res.message)
      setDraft(currentClassId)
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <select
        aria-label="صف الخادم"
        value={draft ?? ""}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value || null)}
        className="rounded-lg border border-input bg-card px-2 py-1.5 text-xs"
      >
        <option value="">بدون صف</option>
        {classes.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        disabled={!dirty || busy}
        onClick={() => void save()}
        aria-label={draft ? "حفظ الصف" : "حفظ بدون صف"}
        className={cn(
          "flex size-7 items-center justify-center rounded-lg text-xs font-bold transition-colors",
          dirty
            ? "bg-coptic-teal text-primary-foreground hover:opacity-90"
            : "cursor-default bg-muted text-muted-foreground"
        )}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Check className="size-3.5" />
        )}
      </button>
    </div>
  )
}