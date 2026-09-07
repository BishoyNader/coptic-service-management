import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { QrCodeCard } from "@/components/app/qr-code-card"

export const metadata: Metadata = { title: "QR Code" }

export default async function MemberQrPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)

  if (!profile || profile.role !== ROLES.SERVED_MEMBER) redirect("/")

  const { data: codes } = await supabase
    .from("personal_codes")
    .select("code, qr_token")
    .eq("profile_id", profile.id)
    .maybeSingle()

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-center font-heading text-xl font-extrabold">كود الحضور</h1>
      {codes ? (
        <QrCodeCard
          value={codes.qr_token}
          name={profile.full_name}
          personalCode={codes.code}
        />
      ) : (
        <p className="mt-20 text-center text-muted-foreground">لم يتم إنشاء الكود بعد</p>
      )}
    </div>
  )
}