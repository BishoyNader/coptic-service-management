"use client"

import { useState } from "react"
import Link from "next/link"
import { KeyRound, MailCheck, Smartphone } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function ForgotPasswordForm() {
  const [identifier, setIdentifier] = useState("")
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const value = identifier.trim()
    if (!value) {
      setError("اكتب رقم الموبايل أو الإيميل")
      return
    }

    setPending(true)
    const supabase = createClient()

    // Only email-based accounts can self-recover (no SMS provider is used).
    // The response is intentionally identical whether or not an account
    // exists — the form never reveals whether an identifier is registered.
    if (value.includes("@")) {
      const redirectTo = `${window.location.origin}/auth/callback`
      await supabase.auth.resetPasswordForEmail(value, { redirectTo })
    }

    setPending(false)
    setSent(true)
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-card p-6 text-center shadow-sm ring-1 ring-foreground/5">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-coptic-teal/10 text-coptic-teal">
            <MailCheck className="size-7" />
          </span>
          <p className="font-heading text-lg font-extrabold">تحقق من رسائلك</p>
          <p className="text-sm text-muted-foreground">
            لو الحساب ده عليه إيميل مسجّل، هيوصلك رابط إعادة تعيين كلمة المرور.
          </p>
          <p className="text-xs text-muted-foreground">
            الحسابات اللي بتدخل برقم الموبايل بس — تواصل مع مسؤول الخدمة العام لإعادة تعيين
            كلمة المرور.
          </p>
        </div>
        <Link href="/login" className="block">
          <Button type="button" variant="outline" className="h-12 w-full text-base">
            رجوع لتسجيل الدخول
          </Button>
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="fp-identifier">رقم الموبايل أو الإيميل</Label>
        <div className="relative">
          <Input
            id="fp-identifier"
            type="text"
            inputMode="tel"
            autoComplete="username"
            dir="ltr"
            placeholder="01xxxxxxxxx"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            className="h-11 pe-10 ps-10 text-center text-base"
          />
          <Smartphone className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <KeyRound className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}

      <Button type="submit" disabled={pending} className="h-12 w-full text-base">
        {pending ? "جاري الإرسال..." : "إرسال رابط إعادة التعيين"}
      </Button>

      <p className="pt-2 text-center text-sm text-muted-foreground">
        تذكّرت كلمة المرور؟{" "}
        <Link href="/login" className="font-semibold text-primary hover:underline">
          سجّل دخولك
        </Link>
      </p>
    </form>
  )
}