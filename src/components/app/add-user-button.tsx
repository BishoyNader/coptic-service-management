"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { AdminUserForm } from "@/components/app/admin-user-form"

export function AddUserButton({
  label = "إضافة",
  defaultRole,
  classes = [],
}: {
  label?: string
  defaultRole: "SERVED_MEMBER" | "SERVANT"
  classes?: { id: string; name: string }[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button className="gap-1.5" onClick={() => setOpen(true)}>
        <span className="text-lg leading-none">+</span>
        {label}
      </Button>
      <AdminUserForm
        open={open}
        onOpenChange={setOpen}
        initialRole={defaultRole}
        allowRoleSelection
        classes={classes}
      />
    </>
  )
}
