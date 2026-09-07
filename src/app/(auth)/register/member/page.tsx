import type { Metadata } from "next"
import { Users } from "lucide-react"
import { RegistrationForm } from "@/components/auth/registration-form"
import { CoverPhoto } from "@/components/auth/cover-photo"

export const metadata: Metadata = { title: "تسجيل مخدوم جديد" }

export default function RegisterMemberPage() {
  return (
    <div className="space-y-6">
      <CoverPhoto
        icon={<Users className="size-7" />}
        title="سجّل حساب مخدوم"
        subtitle="خطوتين قصيرتين ونبدأ"
      />
      <RegistrationForm mode="member" />
    </div>
  )
}