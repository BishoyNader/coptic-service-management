"use client"

import { useState } from "react"
import { Lock, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { changeMyPasswordAction } from "@/app/actions/account"

export function PasswordChangeCard() {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [pending, setPending] = useState(false)

  const handleSubmit = async () => {
    if (!currentPassword) {
      toast.error("اكتب كلمة المرور الحالية")
      return
    }
    if (newPassword.length < 8) {
      toast.error("كلمة المرور الجديدة 8 أحرف على الأقل")
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error("كلمة المرور غير متطابقة")
      return
    }

    setPending(true)
    const result = await changeMyPasswordAction({
      currentPassword,
      newPassword,
      confirmPassword,
    })
    setPending(false)

    if (result.ok) {
      toast.success(result.message)
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
    } else if (result.field === "currentPassword") {
      toast.error(result.message)
    } else {
      toast.error(result.message)
    }
  }

  return (
    <section className="space-y-3 rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-coptic-teal/10 text-coptic-teal">
          <Lock className="size-4" />
        </span>
        <div>
          <p className="text-sm font-semibold">تغيير كلمة المرور</p>
          <p className="text-[11px] text-muted-foreground">اقفل حسابك بكلمة مرور جديدة</p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="pc-current">كلمة المرور الحالية</Label>
        <Input
          id="pc-current"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="h-10 text-sm"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-2">
          <Label htmlFor="pc-new">الجديدة</Label>
          <Input
            id="pc-new"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="h-10 text-sm"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pc-confirm">التأكيد</Label>
          <Input
            id="pc-confirm"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="h-10 text-sm"
          />
        </div>
      </div>

      <Button onClick={handleSubmit} disabled={pending} className="h-10 w-full gap-1.5">
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {pending ? "جاري الحفظ..." : "تغيير كلمة المرور"}
      </Button>
    </section>
  )
}