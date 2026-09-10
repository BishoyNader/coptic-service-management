"use client"

import { useState } from "react"
import { KeyRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ResetPasswordDialog } from "@/components/app/reset-password-dialog"

export function ResetPasswordButton({
  userId,
  fullName,
}: {
  userId: string
  fullName: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="outline"
        className="h-9 gap-1.5 px-3 text-sm"
        onClick={() => setOpen(true)}
      >
        <KeyRound className="size-4" />
        إعادة تعيين كلمة المرور
      </Button>
      <ResetPasswordDialog
        open={open}
        onOpenChange={setOpen}
        userId={userId}
        fullName={fullName}
      />
    </>
  )
}