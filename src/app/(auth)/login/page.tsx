import type { Metadata } from "next"
import { LoginForm } from "@/components/auth/login-form"
import { NileDivider } from "@/components/coptic/brand"

export const metadata: Metadata = { title: "تسجيل الدخول" }

export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col justify-center gap-6">
      <div className="text-center">
        <h1 className="text-balance font-heading text-3xl font-extrabold">
          أهلًا بيك من جديد
        </h1>
        <p className="mt-2 text-muted-foreground">سجّل دخولك لمتابعة الخدمة</p>
        <NileDivider className="mx-auto mt-4 max-w-40" />
      </div>

      <LoginForm />
    </div>
  )
}