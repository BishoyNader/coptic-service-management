"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { adminCreateUserAction } from "@/app/actions/profile"
import { ROLE_LABELS, ROLES, type AppRole } from "@/lib/roles"

type MemberRole = Extract<AppRole, "SERVED_MEMBER" | "SERVANT">

type FieldErrors = {
  fullName?: string
  phone?: string
  password?: string
  confirmPassword?: string
  dateOfBirth?: string
  fatherPhone?: string
  motherPhone?: string
}

type Success = {
  fullName: string
  code: string
  qrToken: string
  phone: string
}

type AdminUserFormProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialRole: MemberRole
  /** When true the caller lets the admin pick the role (Super Admin). */
  allowRoleSelection?: boolean
}

const newFieldErrors = (): FieldErrors => ({})

export function AdminUserForm({
  open,
  onOpenChange,
  initialRole,
  allowRoleSelection = false,
}: AdminUserFormProps) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [role, setRole] = useState<MemberRole>(initialRole)
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
  const [success, setSuccess] = useState<Success | null>(null)

  const isMember = role === ROLES.SERVED_MEMBER

  const reset = () => {
    setStep(0)
    setRole(initialRole)
    setFullName("")
    setPhone("")
    setPassword("")
    setConfirmPassword("")
    setDateOfBirth("")
    setFatherPhone("")
    setMotherPhone("")
    setAddress("")
    setErrors(newFieldErrors())
    setGeneralError(null)
    setPending(false)
    setSuccess(null)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      reset()
    }
    onOpenChange(next)
  }

  const validateStep0 = (): boolean => {
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

  const validateStep1 = (): boolean => {
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
    if (!validateStep0()) return
    setGeneralError(null)
    setStep(1)
  }

  const submit = async () => {
    if (!validateStep0()) return
    if (isMember && !validateStep1()) return

    setPending(true)
    setGeneralError(null)

    const result = await adminCreateUserAction({
      role,
      fullName,
      phone,
      password,
      confirmPassword,
      dateOfBirth: dateOfBirth || undefined,
      fatherPhone: fatherPhone || undefined,
      motherPhone: motherPhone || undefined,
      address: address || undefined,
    })

    setPending(false)

    if (!result.ok) {
      const key = ("field" in result ? result.field : undefined) as
        | keyof FieldErrors
        | undefined
      if (key && key in errors) {
        setErrors((prev) => ({ ...prev, [key]: result.message }))
      } else {
        setGeneralError(result.message)
      }
      return
    }

    setSuccess({
      fullName,
      code: result.code,
      qrToken: result.qrToken,
      phone,
    })
    toast.success("تمت إضافة الحساب بنجاح")
    router.refresh()
  }

  const closeAll = () => {
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-md"
        showCloseButton={!success}
      >
        {success ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-center">تمت إضافة {ROLE_LABELS[role]} بنجاح</DialogTitle>
              <DialogDescription className="text-center">
                شارك هذه البيانات مع {ROLE_LABELS[role]} ليتمكّن من تسجيل الحضور
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col items-center gap-4 pt-1">
              <div className="rounded-2xl bg-white p-4 ring-1 ring-border">
                <QRCodeSVG value={success.qrToken} size={176} level="M" marginSize={1} />
              </div>

              <div className="w-full rounded-2xl bg-coptic-gold-soft p-4 text-center">
                <p className="text-xs font-medium text-accent-foreground">الكود الشخصي</p>
                <p className="mt-1 font-heading text-3xl font-bold tracking-widest text-foreground">
                  {success.code}
                </p>
              </div>

              <div className="w-full space-y-1.5 rounded-2xl bg-muted/50 p-4 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">الاسم</span>
                  <span className="font-medium">{success.fullName}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">رقم الموبايل</span>
                  <span className="font-medium" dir="ltr">{success.phone}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">الدخول برقم الموبايل</span>
                  <span className="font-medium">كلمة المرور المدخلة</span>
                </div>
              </div>

              <Button className="h-11 w-full text-base" onClick={closeAll}>
                إغلاق
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>إضافة {allowRoleSelection ? "حساب" : ROLE_LABELS[initialRole]}</DialogTitle>
              <DialogDescription>
                حساب جديد يدخل برقم الموبايل وكلمة المرور
              </DialogDescription>
            </DialogHeader>

            {allowRoleSelection && (
              <div className="space-y-2">
                <Label>نوع الحساب</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRole(ROLES.SERVED_MEMBER)}
                    className={
                      role === ROLES.SERVED_MEMBER
                        ? "rounded-xl border-2 border-coptic-gold bg-coptic-gold-soft px-4 py-3 text-sm font-semibold"
                        : "rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
                    }
                  >
                    {ROLE_LABELS.SERVED_MEMBER}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole(ROLES.SERVANT)}
                    className={
                      role === ROLES.SERVANT
                        ? "rounded-xl border-2 border-coptic-teal bg-coptic-teal/10 px-4 py-3 text-sm font-semibold"
                        : "rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
                    }
                  >
                    {ROLE_LABELS.SERVANT}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-4">
              {step === 0 && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="au-fullName">الاسم بالكامل</Label>
                    <Input
                      id="au-fullName"
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
                    <Label htmlFor="au-phone">رقم الموبايل</Label>
                    <Input
                      id="au-phone"
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
                    <Label htmlFor="au-password">كلمة المرور</Label>
                    <Input
                      id="au-password"
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
                    <Label htmlFor="au-confirmPassword">تأكيد كلمة المرور</Label>
                    <Input
                      id="au-confirmPassword"
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
                </>
              )}

              {step === 1 && isMember && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="au-dateOfBirth">تاريخ الميلاد</Label>
                    <Input
                      id="au-dateOfBirth"
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
                    <Label htmlFor="au-fatherPhone">رقم الأب (اختياري)</Label>
                    <Input
                      id="au-fatherPhone"
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
                    <Label htmlFor="au-motherPhone">رقم الأم (اختياري)</Label>
                    <Input
                      id="au-motherPhone"
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
                    <Label htmlFor="au-address">العنوان (اختياري)</Label>
                    <Input
                      id="au-address"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="h-11 text-base"
                      placeholder="العنوان"
                    />
                  </div>
                </>
              )}

              {step === 1 && !isMember && (
                <div className="space-y-2">
                  <Label htmlFor="au-dateOfBirth">تاريخ الميلاد (اختياري)</Label>
                  <Input
                    id="au-dateOfBirth"
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
              )}

              {generalError ? (
                <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {generalError}
                </p>
              ) : null}

              <div className="flex gap-2">
                {step === 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 w-1/4 text-base"
                    onClick={() => {
                      setStep(0)
                      setGeneralError(null)
                    }}
                  >
                    <ChevronRight className="size-4" />
                    رجوع
                  </Button>
                ) : null}

                {step === 0 ? (
                  <Button type="button" className="h-11 flex-1 text-base" onClick={nextStep}>
                    التالي
                    <ChevronLeft className="size-4" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    disabled={pending}
                    className="h-11 flex-1 text-base"
                    onClick={submit}
                  >
                    {pending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Check className="size-4" />
                    )}
                    {pending ? "جاري الإضافة..." : "إضافة الحساب"}
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
