import { redirect } from "next/navigation"
import Link from "next/link"
import { QrCode, History, Bell, ClipboardList, CalendarCheck, Users, HandHelping } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { getServerNow } from "@/services/attendance-service"
import { cairoDateString } from "@/lib/cairo"
import { formatArabicDate, toDateString, startOfMonth } from "@/lib/dates"
import { NileDivider } from "@/components/coptic/brand"
import { QrCodeCard } from "@/components/app/qr-code-card"

export default async function ServantHomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVANT) redirect("/")

  const { welcome } = (await searchParams) ?? {}

  const today = cairoDateString(getServerNow())

  const [codesResult, attendanceResult, activityResult, notifResult, todayResult] =
    await Promise.all([
      supabase
        .from("personal_codes")
        .select("code, qr_token")
        .eq("profile_id", profile.id)
        .maybeSingle(),
      supabase
        .from("attendance_records")
        .select("attended_at")
        .eq("profile_id", profile.id)
        .in("status", ["PRESENT", "LATE"])
        .order("attended_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("servant_activity_records")
        .select("id, recorded_on, activity:activities(name, icon)")
        .eq("servant_id", profile.id)
        .gte("recorded_on", toDateString(startOfMonth()))
        .order("recorded_on", { ascending: false })
        .limit(3),
      supabase
        .from("notification_recipients")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", profile.id)
        .is("read_at", null),
      supabase
        .from("attendance_records")
        .select(
          "profile_id, subject:profiles!attendance_records_profile_id_fkey(role)"
        )
        .eq("session.session_date", today)
        .neq("status", "ARCHIVED"),
    ])

  const lastAttendance = attendanceResult.data?.attended_at ?? null
  const activities = activityResult.data as unknown as {
    id: string
    recorded_on: string
    activity: { name: string; icon: string | null } | null
  }[]
  const unread = notifResult.count ?? 0

  const todayRows = (todayResult.data ?? []) as unknown as {
    profile_id: string
    subject: { role: string } | null
  }[]
  const todaySubjects = new Map<string, string>()
  for (const row of todayRows) {
    const role = row.subject?.role
    if (role === "SERVANT" || role === "SERVED_MEMBER") todaySubjects.set(row.profile_id, role)
  }
  let todayServants = 0
  let todayMembers = 0
  for (const [, role] of todaySubjects) {
    if (role === "SERVANT") todayServants++
    else todayMembers++
  }

  if (welcome && codesResult.data) {
    return (
      <div className="space-y-4">
        <div className="relative overflow-hidden rounded-3xl bg-coptic-teal p-6 text-center text-primary-foreground">
          <div className="pointer-events-none absolute inset-0 coptic-lattice-gold opacity-60" />
          <div className="relative">
            <p className="font-heading text-2xl font-extrabold">تم إنشاء حسابك بنجاح 🎉</p>
            <p className="mt-1 text-sm text-primary-foreground/85">
              أهلاً بيك يا {profile.full_name} — حسابك كخادم جاهز
            </p>
          </div>
        </div>
        <QrCodeCard
          value={codesResult.data.qr_token}
          name={profile.full_name}
          personalCode={codesResult.data.code}
        />
        <Link href="/app/servant" className="block">
          <button className="h-12 w-full rounded-2xl bg-coptic-teal text-base font-semibold text-primary-foreground">
            ابدأ التصفح
          </button>
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h1 className="text-balance font-heading text-2xl font-extrabold">
          أهلاً بيك خادمنا {profile.full_name.split(" ")[0]} 👋
        </h1>
        <p className="text-sm text-muted-foreground">{formatArabicDate(new Date())}</p>
      </div>

      {/* Prominent QR action */}
      <Link href="/app/servant/qr" className="block">
        <div className="group relative flex items-center gap-4 overflow-hidden rounded-3xl bg-coptic-teal p-5 text-primary-foreground shadow-md">
          <div className="pointer-events-none absolute inset-0 coptic-lattice-gold opacity-60" />
          <div className="relative flex size-16 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur transition-transform group-hover:scale-105">
            <QrCode className="size-8" />
          </div>
          <div className="relative">
            <p className="font-heading text-lg font-bold">كود الخادم</p>
            <p className="text-sm text-primary-foreground/85">يعرّفك بين الخدام في الخدمة</p>
          </div>
        </div>
      </Link>

      {/* Attendance board widget */}
      <Link
        href="/app/servant/attendance"
        aria-label="فتح لوحة الحضور"
        className="block rounded-3xl bg-card p-5 shadow-md ring-1 ring-foreground/5 transition-colors hover:bg-secondary/40"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-coptic-gold-soft text-coptic-gold">
              <CalendarCheck className="size-5" />
            </span>
            <p className="font-heading font-bold">حضور اليوم</p>
          </div>
          <span className="flex items-center gap-1 text-xs font-medium text-coptic-teal">
            فتح الحضور
            <span aria-hidden="true" className="text-sm">←</span>
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <MiniStat
            icon={<HandHelping className="size-4" />}
            label="خدام"
            value={todayServants}
          />
          <MiniStat icon={<Users className="size-4" />} label="مخدومين" value={todayMembers} />
        </div>
      </Link>

      <div className="grid grid-cols-2 gap-3">
        <AttendanceCard
          hasData={!!lastAttendance}
          emptyText="لسه مفيش حضور مسجل"
          value={lastAttendance ? formatArabicDate(lastAttendance) : ""}
        />

        <Link
          href="/app/servant/notifications"
          className="block rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5 transition-colors hover:bg-secondary/50"
        >
          <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
            <span className="flex size-8 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
              <Bell className="size-4" />
            </span>
            <span>الإشعارات</span>
          </div>
          <p
            className={`mt-2 text-sm ${
              unread > 0 ? "font-bold text-coptic-gold" : "text-muted-foreground"
            }`}
          >
            {unread > 0 ? `${unread} جديد` : "مفيش إشعارات جديدة"}
          </p>
        </Link>
      </div>

      {/* Activities */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-heading font-bold">أنشطتك</h2>
          <Link href="/app/servant/activities" className="text-xs text-muted-foreground hover:text-foreground">
            عرض الكل
          </Link>
        </div>
        {activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card/60 px-6 py-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-coptic-gold-soft text-coptic-gold">
              <ClipboardList className="size-6" />
            </div>
            <p className="font-heading font-semibold">مفيش أنشطة مسجلة</p>
            <p className="text-sm text-muted-foreground">لما تشارك في نشاط، هيظهر هنا</p>
          </div>
        ) : (
          <div className="space-y-2">
            {activities.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5"
              >
                <div className="flex size-10 items-center justify-center rounded-xl bg-coptic-teal/10 text-coptic-teal">
                  <ClipboardList className="size-5" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">{a.activity?.name ?? "نشاط"}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatArabicDate(a.recorded_on)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <NileDivider />
      <p className="text-center text-xs text-muted-foreground">يحيا المسيح 🕊️</p>
    </div>
  )
}

function MiniStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: number
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-secondary/50 px-3 py-2.5">
      <span className="text-coptic-teal">{icon}</span>
      <div className="flex items-baseline gap-1.5">
        <p className="font-heading text-lg font-extrabold leading-none text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

function AttendanceCard({
  value,
  hasData,
  emptyText,
}: {
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
        <span>آخر حضور</span>
      </div>
      {hasData ? (
        <p className="mt-2 font-heading text-xl font-extrabold text-foreground">{value}</p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{emptyText}</p>
      )}
    </div>
  )
}

