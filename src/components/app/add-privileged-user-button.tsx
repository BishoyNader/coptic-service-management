"use client"

import { useState } from "react"
import { Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PrivilegedUserForm } from "@/components/app/privileged-user-form"

export function AddPrivilegedUserButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <Shield className="size-4" />
        إضافة مسؤول
      </Button>
      <PrivilegedUserForm open={open} onOpenChange={setOpen} />
    </>
  )
}