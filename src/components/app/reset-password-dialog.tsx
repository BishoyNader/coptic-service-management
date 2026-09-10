"use client"

import { useState } from "react"
import { KeyRound, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { adminResetPasswordAction } from "@/app/actions/account"

type ResetPasswordDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  userId: string
  fullName: string
}

export function ResetPasswordDialog({
  open,
  onOpenChange,
  userId,
  fullName,
}: ResetPasswordDialogProps) {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [pending, setPending] = useState(false)

  const handleSubmit = async () => {
    if (password.length < 8) {
      toast.error("كلمة المرور 8 أحرف على الأقل")
      return
    }
    if (confirmPassword !== password) {
      toast.error("كلمة المرور غير متطابقة")
      return
    }

    setPending(true)
    const result = await adminResetPasswordAction(userId, password)
    setPending(false)

    if (result.ok) {
      toast.success(result.message)
      onOpenChange(false)
      setPassword("")
      setConfirmPassword("")
    } else {
      toast.error(result.message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>إعادة تعيين كلمة المرور</DialogTitle>
          <DialogDescription>
            هاتعطي {fullName} كلمة مرور مؤقتة جديدة؛ أقفل بها ثم غيّرها من حسابه.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rpw-password">كلمة المرور الجديدة</Label>
            <Input
              id="rpw-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 text-base"
              placeholder="8 أحرف على الأقل"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rpw-confirm">تأكيد كلمة المرور</Label>
            <Input
              id="rpw-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-11 text-base"
              placeholder="أعد كتابة كلمة المرور"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={handleSubmit} disabled={pending} className="gap-1.5">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            {pending ? "جاري الحفظ..." : "تحديث كلمة المرور"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}