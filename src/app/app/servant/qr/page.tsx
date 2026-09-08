import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { QrCodeCard } from "@/components/app/qr-code-card"
import { EmptyState } from "@/components/coptic/empty-state"
import { QrCode } from "lucide-react"

export const metadata: Metadata = { title: "QR Code" }

export default async function ServantQrPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVANT) redirect("/")

  const { data: codes } = await supabase
    .from("personal_codes")
    .select("code, qr_token")
    .eq("profile_id", profile.id)
    .maybeSingle()

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-center font-heading text-xl font-extrabold">كود الخادم</h1>
      {codes ? (
        <QrCodeCard
          value={codes.qr_token}
          name={profile.full_name}
          personalCode={codes.code}
          size={200}
        />
      ) : (
        <EmptyState
          icon={<QrCode className="size-7" />}
          title="لم يتم إنشاء الكود بعد"
          description="الكود الشخصي بيتولد لوحدو لما يسجّل الحساب"
        />
      )}
    </div>
  )
}
