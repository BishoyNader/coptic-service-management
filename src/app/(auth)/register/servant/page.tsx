import type { Metadata } from "next"
import { HeartHandshake } from "lucide-react"
import { RegistrationForm } from "@/components/auth/registration-form"
import { CoverPhoto } from "@/components/auth/cover-photo"

export const metadata: Metadata = { title: "تسجيل خادم جديد" }

export default function RegisterServantPage() {
  return (
    <div className="space-y-6">
      <CoverPhoto
        icon={<HeartHandshake className="size-7" />}
        title="سجّل حساب خادم"
        subtitle="أهلًا بيك في الخدمة — أهلا وسهلا"
      />
      <RegistrationForm mode="servant" />
    </div>
  )
}