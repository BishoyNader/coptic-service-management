"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { normalizePhone } from "@/lib/validation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AlertCircle } from "lucide-react"
import { toast } from "sonner"

type Mode = "member" | "servant"

type FieldErrors = {
  fullName?: string
  phone?: string
  password?: string
  confirmPassword?: string
  dateOfBirth?: string
  fatherPhone?: string
  motherPhone?: string
  address?: string
}

type ServerErrors = Record<string, string>

const newFieldErrors = (): FieldErrors => ({
  fullName: undefined,
  phone: undefined,
  password: undefined,
  confirmPassword: undefined,
  dateOfBirth: undefined,
  fatherPhone: undefined,
  motherPhone: undefined,
  address: undefined,
})

export function RegistrationForm({ mode }: { mode: Mode }) {
  const router = useRouter()
  const isMember = mode === "member"
  const [step, setStep] = useState(0)

  const [fullName, setFullName] = useState("")
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [dateOfBirth, setDateOfBirth] = useState("")
  const [fatherPhone, setFatherPhone] = useState("")
  const [motherPhone, setMotherPhone] = useState("")
  const [address, setAddress] = useState("")

  const [errors, setErrors] = useState<FieldErrors>(newFieldErrors())
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const validateStep1 = (): boolean => {
    const next = newFieldErrors()
    let ok = true

    if (fullName.trim().length < 2) {
      next.fullName = "اكتب الاسم بالكامل"
      ok = false
    }
    if (!/^\+?[0-9]{10,15}$/.test(phone.trim())) {
      next.phone = "اكتب رقم موبايل صحيح"
      ok = false
    }
    if (password.length < 8) {
      next.password = "كلمة المرور 8 أحرف على الأقل"
      ok = false
    }
    if (confirmPassword !== password) {
      next.confirmPassword = "كلمة المرور غير متطابقة"
      ok = false
    }

    setErrors(next)
    return ok
  }

  const validateStep2 = (): boolean => {
    const next = newFieldErrors()
    let ok = true

    if (dateOfBirth && isNaN(Date.parse(dateOfBirth))) {
      next.dateOfBirth = "التاريخ غير صحيح"
      ok = false
    }
    if (fatherPhone && !/^\+?[0-9]{10,15}$/.test(fatherPhone.trim())) {
      next.fatherPhone = "رقم غير صحيح"
      ok = false
    }
    if (motherPhone && !/^\+?[0-9]{10,15}$/.test(motherPhone.trim())) {
      next.motherPhone = "رقم غير صحيح"
      ok = false
    }

    setErrors(next)
    return ok
  }

  const nextStep = () => {
    if (!validateStep1()) return
    setGeneralError(null)
    setStep(1)
  }

  const submit = async () => {
    if (!validateStep1()) return
    if (isMember && !validateStep2()) return

    setPending(true)
    setGeneralError(null)

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: isMember ? "SERVED_MEMBER" : "SERVANT",
        fullName,
        phone,
        password,
        confirmPassword,
        dateOfBirth: dateOfBirth || undefined,
        fatherPhone: fatherPhone || undefined,
        motherPhone: motherPhone || undefined,
        address: address || undefined,
      }),
    })

    const body = (await res.json().catch(() => null)) as
      | (ServerErrors & { ok?: boolean; message?: string; field?: string })
      | null

    if (!res.ok || !body?.ok) {
      setPending(false)
      const field = body?.field as keyof FieldErrors | undefined
      if (field && field in errors) {
        setErrors((prev) => ({ ...prev, [field]: body?.message }))
      } else {
        setGeneralError(body?.message ?? "حدث خطأ، حاول مرة أخرى")
      }
      return
    }

    // Sign the user in so we can land directly in their new account.
    const supabase = createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({
      phone: normalizePhone(phone),
      password,
    })

    if (signInError) {
      // Account was created; the next login will complete the flow.
      toast.success("تم إنشاء حسابك بنجاح 🎉")
      router.replace("/login")
      return
    }

    toast.success("تم إنشاء حسابك بنجاح 🎉")
    router.replace(`${isMember ? "/app/member" : "/app/servant"}?welcome=1`)
    router.refresh()
  }

  return (
    <div className="space-y-5">
      {isMember && (
        <div className="flex items-center gap-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= step ? "bg-coptic-gold" : "bg-muted"
              }`}
            />
          ))}
        </div>
      )}

      {step === 0 && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">الاسم بالكامل</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="h-11 text-base"
              placeholder="مثال: بشوي نادر حلمي"
            />
            {errors.fullName ? (
              <p className="text-sm text-destructive">{errors.fullName}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">رقم الموبايل</Label>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="h-11 px-3 text-center text-base"
              placeholder="01xxxxxxxxx"
            />
            {errors.phone ? (
              <p className="text-sm text-destructive">{errors.phone}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">كلمة المرور</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 text-base"
              placeholder="8 أحرف على الأقل"
            />
            {errors.password ? (
              <p className="text-sm text-destructive">{errors.password}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">تأكيد كلمة المرور</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-11 text-base"
              placeholder="أعد كتابة كلمة المرور"
            />
            {errors.confirmPassword ? (
              <p className="text-sm text-destructive">{errors.confirmPassword}</p>
            ) : null}
          </div>
        </div>
      )}

      {step === 1 && isMember && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dateOfBirth">تاريخ الميلاد</Label>
            <Input
              id="dateOfBirth"
              type="date"
              max={new Date().toISOString().split("T")[0]}
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="h-11 text-base"
            />
            {errors.dateOfBirth ? (
              <p className="text-sm text-destructive">{errors.dateOfBirth}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="fatherPhone">رقم الأب (اختياري)</Label>
            <Input
              id="fatherPhone"
              type="tel"
              inputMode="tel"
              dir="ltr"
              value={fatherPhone}
              onChange={(e) => setFatherPhone(e.target.value)}
              className="h-11 px-3 text-center text-base"
              placeholder="01xxxxxxxxx"
            />
            {errors.fatherPhone ? (
              <p className="text-sm text-destructive">{errors.fatherPhone}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="motherPhone">رقم الأم (اختياري)</Label>
            <Input
              id="motherPhone"
              type="tel"
              inputMode="tel"
              dir="ltr"
              value={motherPhone}
              onChange={(e) => setMotherPhone(e.target.value)}
              className="h-11 px-3 text-center text-base"
              placeholder="01xxxxxxxxx"
            />
            {errors.motherPhone ? (
              <p className="text-sm text-destructive">{errors.motherPhone}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">العنوان (اختياري)</Label>
            <Input
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="h-11 text-base"
              placeholder="العنوان"
            />
          </div>
        </div>
      )}

      {!isMember && step === 0 && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dateOfBirth">تاريخ الميلاد</Label>
            <Input
              id="dateOfBirth"
              type="date"
              max={new Date().toISOString().split("T")[0]}
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="h-11 text-base"
            />
            {errors.dateOfBirth ? (
              <p className="text-sm text-destructive">{errors.dateOfBirth}</p>
            ) : null}
          </div>
        </div>
      )}

      {generalError ? (
        <p className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {generalError}
        </p>
      ) : null}

      <div className="flex gap-2">
        {isMember && step === 1 ? (
          <Button
            type="button"
            variant="ghost"
            className="h-12 w-1/4 text-base"
            onClick={() => {
              setStep(0)
              setGeneralError(null)
            }}
          >
            <ChevronRight className="size-4" />
            رجوع
          </Button>
        ) : null}

        {isMember && step === 0 ? (
          <Button type="button" className="h-12 flex-1 text-base" onClick={nextStep}>
            التالي
            <ChevronLeft className="size-4" />
          </Button>
        ) : (
          <Button
            type="button"
            disabled={pending}
            className="h-12 flex-1 text-base"
            onClick={submit}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {pending ? "جاري إنشاء الحساب..." : "إنشاء الحساب"}
          </Button>
        )}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        بإنشاء الحساب أنت موافق على استخدام بياناتك داخل إدارة الخدمة
      </p>
    </div>
  )
}