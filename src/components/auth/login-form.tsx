"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Smartphone, Mail } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { normalizePhone } from "@/lib/validation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertCircle } from "lucide-react"
import { toast } from "sonner"

export function LoginForm() {
  const router = useRouter()
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const value = identifier.trim()
    if (!value) {
      setError("اكتب رقم الموبايل أو الإيميل")
      return
    }
    if (!password) {
      setError("اكتب كلمة المرور")
      return
    }

    setPending(true)
    const supabase = createClient()
    const isEmail = value.includes("@")

    const { error: signInError } = isEmail
      ? await supabase.auth.signInWithPassword({ email: value, password })
      : await supabase.auth.signInWithPassword({ phone: normalizePhone(value), password })

    setPending(false)

    if (signInError) {
      setError("رقم الموبايل أو كلمة المرور غير صحيحة")
      return
    }

    toast.success("تم تسجيل الدخول بنجاح")
    router.replace("/")
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="identifier">رقم الموبايل أو الإيميل</Label>
        <div className="relative">
          <Input
            id="identifier"
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
          <Mail className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">كلمة المرور</Label>
          <Link
            href="/forgot-password"
            className="text-xs font-semibold text-primary hover:underline"
          >
            نسيت كلمة المرور؟
          </Link>
        </div>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-11 text-base"
        />
      </div>

      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="h-12 w-full text-base">
        {pending ? "جاري الدخول..." : "تسجيل الدخول"}
      </Button>

      <p className="pt-2 text-center text-sm text-muted-foreground">
        لسه مأأخذتش حساب؟{" "}
        <Link href="/register" className="font-semibold text-primary hover:underline">
          سجّل دلوقتي
        </Link>
      </p>
    </form>
  )
}