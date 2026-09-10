import type { Metadata } from "next"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"
import { NileDivider } from "@/components/coptic/brand"

export const metadata: Metadata = { title: "إعادة تعيين كلمة المرور" }

export default function ResetPasswordPage() {
  return (
    <div className="flex flex-1 flex-col justify-center gap-6">
      <div className="text-center">
        <h1 className="text-balance font-heading text-3xl font-extrabold">كلمة مرور جديدة</h1>
        <p className="mt-2 text-muted-foreground">اختار كلمة مرور قوية من 8 أحرف على الأقل</p>
        <NileDivider className="mx-auto mt-4 max-w-40" />
      </div>

      <ResetPasswordForm />
    </div>
  )
}