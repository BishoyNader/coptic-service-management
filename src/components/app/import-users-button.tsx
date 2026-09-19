"use client"

import { useState } from "react"
import { FileSpreadsheet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ImportSheetDialog } from "@/components/app/import-sheet-dialog"
import type { AppRole } from "@/lib/roles"

export function ImportUsersButton({
  role,
  label,
}: {
  role: AppRole
  label?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <FileSpreadsheet className="size-3.5" />
        {label ?? `استيراد`}
      </Button>
      <ImportSheetDialog open={open} onOpenChange={setOpen} role={role} />
    </>
  )
}
