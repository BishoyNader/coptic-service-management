"use client"

import { useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

type ExportButtonProps = {
  /** Server action that returns { ok, csv, filename } or { ok: false, message }. */
  action: () => Promise<{ ok: boolean; csv?: string; filename?: string; message?: string }>
  /** Button label text. */
  label: string
  /** Extra className. */
  className?: string
  /** Disabled state. */
  disabled?: boolean
}

/**
 * Triggers a server-side CSV export and downloads the result as a file.
 * Prevents duplicate requests while an export is in flight.
 */
export function ExportButton({
  action,
  label,
  className,
  disabled,
}: ExportButtonProps) {
  const [busy, setBusy] = useState(false)

  const handleClick = async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await action()
      if (!result.ok || !result.csv) {
        toast.error(result.message || "حدث خطأ أثناء التصدير")
        return
      }

      const blob = new Blob(["\uFEFF" + result.csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = result.filename || "export.csv"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error("حدث خطأ أثناء التصدير")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void handleClick()}
      disabled={busy || disabled}
      className={className}
    >
      {busy ? (
        <Loader2 className="ms-1.5 size-3.5 animate-spin" />
      ) : (
        <Download className="ms-1.5 size-3.5" />
      )}
      {busy ? "جاري التصدير..." : label}
    </Button>
  )
}
