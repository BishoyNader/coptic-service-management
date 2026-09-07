import { redirect } from "next/navigation"
import Link from "next/link"
import { QrCode, HeartHandshake } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { arabicWeekday, formatArabicDate } from "@/lib/dates"
import { NileDivider } from "@/components/coptic/brand"
import { EmptyState } from "@/components/coptic/empty-state"

export default async function ServantHomePage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVANT) redirect("/")

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-sm font-medium text-coptic-gold">{arabicWeekday()}</p>
        <h1 className="text-balance font-heading text-2xl font-extrabold">
          أهلًا يا خادمنا 👋
        </h1>
        <p className="text-sm text-muted-foreground">{formatArabicDate(new Date())}</p>
      </div>

      <Link href="/app/servant/qr" className="block">
        <div className="group relative flex items-center gap-4 overflow-hidden rounded-3xl bg-coptic-teal p-5 text-primary-foreground shadow-md">
          <div className="pointer-events-none absolute inset-0 coptic-lattice-gold opacity-60" />
          <div className="relative flex size-14 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur transition-transform group-hover:scale-105">
            <QrCode className="size-7" />
          </div>
          <div className="relative">
            <p className="font-heading text-lg font-bold">كود الخادم</p>
            <p className="text-sm text-primary-foreground/85">
              يعرّفك بين الخدام في كنيسة الخدمة
            </p>
          </div>
        </div>
      </Link>

      <EmptyState
        icon={<HeartHandshake className="size-7" />}
        title="أنشطة اليوم"
        description="متابعة أنشطة الخدام هتظهر هنا قريبًا"
      />

      <NileDivider />
      <p className="text-center text-xs text-muted-foreground">
        يحيا المسيح 🕊️
      </p>
    </div>
  )
}