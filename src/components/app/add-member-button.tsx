"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { AdminUserForm } from "@/components/app/admin-user-form"
import { ROLES } from "@/lib/roles"

export function AddMemberButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button className="gap-1.5" onClick={() => setOpen(true)}>
        <span className="text-lg leading-none">+</span>
        إضافة مخدوم
      </Button>
      <AdminUserForm open={open} onOpenChange={setOpen} initialRole={ROLES.SERVED_MEMBER} />
    </>
  )
}
