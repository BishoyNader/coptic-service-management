import { redirect } from "next/navigation"
import Link from "next/link"
import { QrCode } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES, ROLE_LABELS } from "@/lib/roles"
import { startOfWeek, startOfMonth, toDateString, arabicWeekday, formatArabicDate } from "@/lib/dates"
import { WelcomeCard } from "@/components/app/welcome-card"
import { HomeScoresPreview } from "@/components/app/stat-cards"
import { NileDivider } from "@/components/coptic/brand"
import { Button } from "@/components/ui/button"

export default async function MemberHomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await createClient()
  const profile = await getProfile(supabase)

  if (!profile || profile.role !== ROLES.SERVED_MEMBER) {
    redirect("/")
  }

  const { welcome } = await searchParams ?? {}

  const [codesResult, weekResult, monthResult] = await Promise.all([
    supabase.from("personal_codes").select("code, qr_token").eq("profile_id", profile.id).maybeSingle(),
    supabase
      .from("score_records")
      .select("points")
      .eq("profile_id", profile.id)
      .gte("session_date", toDateString(startOfWeek()))
      .lte("session_date", toDateString(new Date())),
    supabase
      .from("score_records")
      .select("points")
      .eq("profile_id", profile.id)
      .gte("session_date", toDateString(startOfMonth()))
      .lte("session_date", toDateString(new Date())),
  ])

  const week = weekResult.data?.reduce((s, r) => s + Number(r.points), 0) ?? 0
  const month = monthResult.data?.reduce((s, r) => s + Number(r.points), 0) ?? 0

  if (welcome && codesResult.data) {
    return (
      <SeparatePageContent>
        <WelcomeCard
          name={profile.full_name}
          roleLabel={ROLE_LABELS[profile.role]}
          qrToken={codesResult.data.qr_token}
          personalCode={codesResult.data.code}
        />
        <Link href="/app/member" className="block">
          <Button className="h-12 w-full text-base">ابدأ التصفح</Button>
        </Link>
      </SeparatePageContent>
    )
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-sm font-medium text-coptic-gold">{arabicWeekday()}</p>
        <h1 className="text-balance font-heading text-2xl font-extrabold">
          أهلًا يا {profile.full_name.split(" ")[0]} 👋
        </h1>
        <p className="text-sm text-muted-foreground">{formatArabicDate(new Date())}</p>
      </div>

      <Link href="/app/member/qr" className="block">
        <div className="group relative flex items-center gap-4 overflow-hidden rounded-3xl bg-coptic-teal p-5 text-primary-foreground shadow-md">
          <div className="pointer-events-none absolute inset-0 coptic-lattice-gold opacity-60" />
          <div className="relative flex size-14 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur transition-transform group-hover:scale-105">
            <QrCode className="size-7" />
          </div>
          <div className="relative">
            <p className="font-heading text-lg font-bold">عرض QR Code</p>
            <p className="text-sm text-primary-foreground/85">
              اعرض الكود عند الحضور لتسجيل الحضور بسرعة
            </p>
          </div>
        </div>
      </Link>

      <HomeScoresPreview week={week} month={month} />

      <NileDivider />
      <p className="text-center text-xs text-muted-foreground">
        الخدمة تنتظرك كل يوم أحد 🙏
      </p>
    </div>
  )
}

function SeparatePageContent({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4">{children}</div>
}