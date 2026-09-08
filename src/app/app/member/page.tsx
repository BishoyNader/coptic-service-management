import { redirect } from "next/navigation"
import Link from "next/link"
import { QrCode, Star, CalendarDays, History, Bell } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { startOfWeek, startOfMonth, toDateString, formatArabicDate } from "@/lib/dates"
import { WelcomeCard } from "@/components/app/welcome-card"
import { NileDivider } from "@/components/coptic/brand"
import { Button } from "@/components/ui/button"

export default async function MemberHomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await createClient()
  const profile = await getProfile(supabase)

  if (!profile || profile.role !== "SERVED_MEMBER") {
    redirect("/")
  }

  const { welcome } = (await searchParams) ?? {}

  const [codesResult, weekResult, monthResult, attendanceResult, notifResult] = await Promise.all([
    supabase
      .from("personal_codes")
      .select("code, qr_token")
      .eq("profile_id", profile.id)
      .maybeSingle(),
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
    supabase
      .from("attendance_records")
      .select("attended_at")
      .eq("profile_id", profile.id)
      .in("status", ["PRESENT", "LATE"])
      .order("attended_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("notification_recipients")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profile.id)
      .is("read_at", null),
  ])

  const week = weekResult.data?.reduce((s, r) => s + Number(r.points), 0) ?? 0
  const month = monthResult.data?.reduce((s, r) => s + Number(r.points), 0) ?? 0
  const hasWeek = (weekResult.data?.length ?? 0) > 0
  const hasMonth = (monthResult.data?.length ?? 0) > 0
  const lastAttendance = attendanceResult.data?.attended_at ?? null
  const unread = notifResult.count ?? 0

  if (welcome && codesResult.data) {
    return (
      <div className="space-y-4">
        <WelcomeCard
          name={profile.full_name}
          roleLabel="مخدوم"
          qrToken={codesResult.data.qr_token}
          personalCode={codesResult.data.code}
        />
        <Link href="/app/member" className="block">
          <Button className="h-12 w-full text-base">ابدأ التصفح</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-balance font-heading text-2xl font-extrabold">
          أهلاً بيك {profile.full_name.split(" ")[0]} 👋
        </h1>
        <p className="text-sm text-muted-foreground">{formatArabicDate(new Date())}</p>
      </div>

      {/* Prominent QR action */}
      <Link href="/app/member/qr" className="block">
        <div className="group relative flex items-center gap-4 overflow-hidden rounded-3xl bg-coptic-teal p-5 text-primary-foreground shadow-md">
          <div className="pointer-events-none absolute inset-0 coptic-lattice-gold opacity-60" />
          <div className="relative flex size-16 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur transition-transform group-hover:scale-105">
            <QrCode className="size-8" />
          </div>
          <div className="relative">
            <p className="font-heading text-lg font-bold">عرض كود الحضور</p>
            <p className="text-sm text-primary-foreground/85">
              اعرض الكود لتسجيل الحضور بسرعة
            </p>
          </div>
        </div>
      </Link>

      {/* Scores */}
      <div className="grid grid-cols-2 gap-3">
        <ScoreCard
          icon={<Star className="size-6" />}
          label="درجات الأسبوع"
          hasData={hasWeek}
          value={String(week)}
          emptyText="لسه مفيش درجات مسجلة"
        />
        <ScoreCard
          icon={<CalendarDays className="size-6" />}
          label="درجات الشهر"
          hasData={hasMonth}
          value={String(month)}
          emptyText="لسه مفيش درجات مسجلة"
        />
        <HistoryCard
          title="آخر حضور"
          hasData={!!lastAttendance}
          emptyText="لسه مفيش حضور مسجل"
          value={lastAttendance ? formatArabicDate(lastAttendance) : ""}
        />
        <LinkCard
          href="/app/member/notifications"
          icon={<Bell className="size-6" />}
          label="الإشعارات"
          hasData={unread > 0}
          value={unread > 0 ? `${unread} جديد` : "مفيش إشعارات جديدة"}
        />
      </div>

      <NileDivider />
      <p className="text-center text-xs text-muted-foreground">
        الخدمة تنتظرك كل يوم أحد 🙏
      </p>
    </div>
  )
}

function ScoreCard({
  icon,
  label,
  value,
  hasData,
  emptyText,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hasData: boolean
  emptyText: string
}) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
      <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
        <span className="flex size-8 items-center justify-center rounded-xl bg-coptic-gold-soft text-coptic-gold">
          {icon}
        </span>
        <span>{label}</span>
      </div>
      {hasData ? (
        <p className="mt-2 font-heading text-2xl font-extrabold text-foreground">{value}</p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{emptyText}</p>
      )}
    </div>
  )
}

function HistoryCard({
  title,
  value,
  hasData,
  emptyText,
}: {
  title: string
  value: string
  hasData: boolean
  emptyText: string
}) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
      <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
        <span className="flex size-8 items-center justify-center rounded-xl bg-coptic-teal/10 text-coptic-teal">
          <History className="size-4" />
        </span>
        <span>{title}</span>
      </div>
      {hasData ? (
        <p className="mt-2 font-heading text-xl font-extrabold text-foreground">{value}</p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{emptyText}</p>
      )}
    </div>
  )
}

function LinkCard({
  href,
  icon,
  label,
  value,
  hasData,
}: {
  href: string
  icon: React.ReactNode
  label: string
  value: string
  hasData: boolean
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5 transition-colors hover:bg-secondary/50"
    >
      <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
        <span className="flex size-8 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
          {icon}
        </span>
        <span>{label}</span>
      </div>
      <p
        className={`mt-2 text-sm ${
          hasData ? "font-bold text-coptic-gold" : "text-muted-foreground"
        }`}
      >
        {value}
      </p>
    </Link>
  )
}
