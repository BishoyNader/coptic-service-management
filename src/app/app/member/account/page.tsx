import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { Calendar, Phone, MapPin, QrCode, Users } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES, ROLE_LABELS } from "@/lib/roles"
import { formatArabicDate } from "@/lib/dates"

export const metadata: Metadata = { title: "حسابي" }

export default async function MemberAccountPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVED_MEMBER) redirect("/")

  const { data: codes } = await supabase
    .from("personal_codes")
    .select("code")
    .eq("profile_id", profile.id)
    .maybeSingle()

  const rows: { icon: React.ReactNode; label: string; value: string }[] = [
    { icon: <Phone className="size-4" />, label: "رقم الموبايل", value: profile.phone },
    { icon: <QrCode className="size-4" />, label: "الكود الشخصي", value: codes?.code ?? "—" },
    {
      icon: <Calendar className="size-4" />,
      label: "تاريخ الميلاد",
      value: profile.date_of_birth ? formatArabicDate(profile.date_of_birth) : "—",
    },
    { icon: <MapPin className="size-4" />, label: "العنوان", value: profile.address ?? "—" },
    { icon: <Phone className="size-4" />, label: "رقم الأب", value: profile.father_phone ?? "—" },
    { icon: <Phone className="size-4" />, label: "رقم الأم", value: profile.mother_phone ?? "—" },
  ]

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex flex-col items-center gap-3 rounded-3xl bg-card p-6 text-center shadow-sm ring-1 ring-foreground/5">
        <div className="flex size-16 items-center justify-center rounded-full bg-coptic-teal font-heading text-2xl font-extrabold text-primary-foreground">
          {profile.full_name.trim().charAt(0)}
        </div>
        <div>
          <p className="font-heading text-lg font-extrabold">{profile.full_name}</p>
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-coptic-gold-soft px-3 py-1 text-xs font-bold text-coptic-gold">
            <Users className="size-3.5" />
            {ROLE_LABELS[profile.role]}
          </span>
        </div>
      </div>

      <div className="divide-y divide-border rounded-2xl bg-card shadow-sm ring-1 ring-foreground/5">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between px-4 py-3 text-sm"
          >
            <span className="flex items-center gap-2 text-muted-foreground">
              {row.icon}
              {row.label}
            </span>
            <span className="font-medium" dir="ltr">
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}