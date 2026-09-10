import type { Metadata } from "next"
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"
import { NileDivider } from "@/components/coptic/brand"

export const metadata: Metadata = { title: "نسيت كلمة المرور" }

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-1 flex-col justify-center gap-6">
      <div className="text-center">
        <h1 className="text-balance font-heading text-3xl font-extrabold">نسيت كلمة المرور؟</h1>
        <p className="mt-2 text-muted-foreground">
          هنساعدك تسترد حسابك — من غير ما نكشف أي معلومات عن الحسابات
        </p>
        <NileDivider className="mx-auto mt-4 max-w-40" />
      </div>

      <ForgotPasswordForm />
    </div>
  )
}