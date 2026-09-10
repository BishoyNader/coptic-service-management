"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Lock, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { resetPasswordAction } from "@/app/actions/account"

export function ResetPasswordForm() {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError("كلمة المرور 8 أحرف على الأقل")
      return
    }
    if (password !== confirmPassword) {
      setError("كلمة المرور غير متطابقة")
      return
    }

    setPending(true)
    const result = await resetPasswordAction(password, confirmPassword)
    setPending(false)

    if (result.ok) {
      toast.success(result.message)
      router.replace("/login")
      router.refresh()
    } else if (result.field === "general") {
      setError(result.message)
    } else {
      setError(result.message)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="rp-password">كلمة المرور الجديدة</Label>
        <div className="relative">
          <Input
            id="rp-password"
            type="password"
            autoComplete="new-password"
            placeholder="8 أحرف على الأقل"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 pe-10 ps-10 text-center text-base"
          />
          <Lock className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="rp-confirmPassword">تأكيد كلمة المرور</Label>
        <Input
          id="rp-confirmPassword"
          type="password"
          autoComplete="new-password"
          placeholder="أعد كتابة كلمة المرور"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="h-11 text-base"
        />
      </div>

      {error ? (
        <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}

      <Button type="submit" disabled={pending} className="h-12 w-full text-base">
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {pending ? "جاري الحفظ..." : "تحديث كلمة المرور"}
      </Button>
    </form>
  )
}