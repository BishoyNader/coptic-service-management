"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2, Shield, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"
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
import { adminCreatePrivilegedUserAction } from "@/app/actions/account"
import { ROLE_LABELS, ROLES, type AppRole } from "@/lib/roles"

type PrivilegedRole = Extract<AppRole, "ADMIN" | "SUPER_ADMIN">

type FieldErrors = {
  fullName?: string
  phone?: string
  email?: string
  password?: string
  confirmPassword?: string
}

type Success = {
  fullName: string
  phone: string
  role: PrivilegedRole
}

type PrivilegedUserFormProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultRole?: PrivilegedRole
}

const newFieldErrors = (): FieldErrors => ({})

export function PrivilegedUserForm({
  open,
  onOpenChange,
  defaultRole = ROLES.ADMIN,
}: PrivilegedUserFormProps) {
  const router = useRouter()
  const [role, setRole] = useState<PrivilegedRole>(defaultRole)
  const [fullName, setFullName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  const [errors, setErrors] = useState<FieldErrors>(newFieldErrors())
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [success, setSuccess] = useState<Success | null>(null)

  const reset = () => {
    setRole(defaultRole)
    setFullName("")
    setPhone("")
    setEmail("")
    setPassword("")
    setConfirmPassword("")
    setErrors(newFieldErrors())
    setGeneralError(null)
    setPending(false)
    setSuccess(null)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const validate = (): boolean => {
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
    if (email.trim()) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        next.email = "اكتب إيميل صحيح"
        ok = false
      }
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

  const submit = async () => {
    if (!validate()) return

    setPending(true)
    setGeneralError(null)

    const result = await adminCreatePrivilegedUserAction({
      role,
      fullName,
      phone,
      email: email.trim() || undefined,
      password,
      confirmPassword,
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

    setSuccess({ fullName, phone, role })
    toast.success("تمت إضافة الحساب بنجاح")
    router.refresh()
  }

  const closeAll = () => {
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md" showCloseButton={!success}>
        {success ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-center">
                تمت إضافة {ROLE_LABELS[success.role]} بنجاح
              </DialogTitle>
              <DialogDescription className="text-center">
                الحساب يدخل برقم الموبايل وكلمة المرور المدخلة
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5 rounded-2xl bg-muted/50 p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">الاسم</span>
                <span className="font-medium">{success.fullName}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">رقم الموبايل</span>
                <span className="font-medium" dir="ltr">{success.phone}</span>
              </div>
            </div>

            <Button className="h-11 w-full text-base" onClick={closeAll}>
              إغلاق
            </Button>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>إضافة مسؤول</DialogTitle>
              <DialogDescription>
                حساب إداري يملك صلاحيات داخل اللوحة — لا يحتاج كود حضور شخصي
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label>صلاحية الحساب</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRole(ROLES.ADMIN)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-xl px-4 py-3 text-sm font-semibold transition-colors",
                    role === ROLES.ADMIN
                      ? "border-2 border-coptic-navy bg-coptic-navy/10 text-coptic-navy"
                      : "border border-border bg-card text-muted-foreground"
                  )}
                >
                  <Shield className="size-4" />
                  {ROLE_LABELS.ADMIN}
                </button>
                <button
                  type="button"
                  onClick={() => setRole(ROLES.SUPER_ADMIN)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-xl px-4 py-3 text-sm font-semibold transition-colors",
                    role === ROLES.SUPER_ADMIN
                      ? "border-2 border-coptic-terra bg-coptic-terra/10 text-coptic-terra"
                      : "border border-border bg-card text-muted-foreground"
                  )}
                >
                  <ShieldCheck className="size-4" />
                  {ROLE_LABELS.SUPER_ADMIN}
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pu-fullName">الاسم بالكامل</Label>
                <Input
                  id="pu-fullName"
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
                <Label htmlFor="pu-phone">رقم الموبايل</Label>
                <Input
                  id="pu-phone"
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
                <Label htmlFor="pu-email">الإيميل (اختياري)</Label>
                <Input
                  id="pu-email"
                  type="email"
                  autoComplete="email"
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 px-3 text-center text-base"
                  placeholder="hello@example.com"
                />
                <p className="text-xs text-muted-foreground">
                  بالإيميل يقدر يسترجع كلمة المرور بنفسه؛ من بدونه تواصل مع مسؤول الخدمة العام.
                </p>
                {errors.email ? (
                  <p className="text-sm text-destructive">{errors.email}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="pu-password">كلمة المرور</Label>
                <Input
                  id="pu-password"
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
                <Label htmlFor="pu-confirmPassword">تأكيد كلمة المرور</Label>
                <Input
                  id="pu-confirmPassword"
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

              {generalError ? (
                <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {generalError}
                </p>
              ) : null}

              <Button
                type="button"
                disabled={pending}
                className="h-11 w-full text-base"
                onClick={submit}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                {pending ? "جاري الإضافة..." : "إضافة الحساب"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}