import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Globe, CalendarDays, Users, HeartHandshake, Bell, Phone, Clock } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { getCopticCalendarDay, getUpcomingFeasts } from "@/services/coptic-calendar-service"
import { cairoDateString } from "@/lib/cairo"
import { NileDivider, CopticCross } from "@/components/coptic/brand"
import { APP_NAME, APP_TAGLINE } from "@/lib/constants"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = { title: "عن الخدمة" }

const SERVICE_TIMES = [
  { day: "كل جمعة", time: "بعد صلاة الجمعة", note: "حضور القداس والخدمة" },
  { day: "كل أحد", time: "مساءً", note: "الخدمة الصباحية والأنشطة" },
]

const CHURCH_CONTACT = {
  phone: "٠٢٣١٠٠٠٠٠٠٠٠",
  email: "info@coptic-service.local",
  address: "كنيسة السيدة العذراء - وادي حوف",
}

export default async function ChurchInfoPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const admin = createAdminClient()
  const today = cairoDateString(new Date())

  const [calendarResult, feastsResult, counts] = await Promise.all([
    getCopticCalendarDay(undefined, today),
    getUpcomingFeasts(14),
    Promise.all([
      admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "SERVED_MEMBER")
        .eq("status", "ACTIVE"),
      admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "SERVANT")
        .eq("status", "ACTIVE"),
    ]),
  ])

  const memberCount = counts[0].count ?? 0
  const servantCount = counts[1].count ?? 0

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-xl bg-coptic-teal/10 text-coptic-teal">
          <Globe className="size-6" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-extrabold">عن الخدمة</h1>
          <p className="text-sm text-muted-foreground">{APP_NAME} — {APP_TAGLINE}</p>
        </div>
      </div>

      {/* Church identity card */}
      <div className="card-hover rounded-2xl border bg-card p-6">
        <div className="flex items-start gap-4">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-coptic-gold-soft text-coptic-gold">
            <CopticCross className="size-9" />
          </div>
          <div className="flex-1 space-y-2">
            <h2 className="font-heading text-xl font-bold">{APP_NAME}</h2>
            <p className="text-sm text-muted-foreground">{APP_TAGLINE}</p>
            <p className="text-sm">
              نظام إدارة الخدمة للكنيسة، يدعم تسجيل الحضور، إدارة الدرجات، والأنشطة
              الكنسية بين أبناء الخدمة.
                        </p>
          </div>
        </div>
      </div>

      {/* Service times */}
      <div className="space-y-3">
        <h2 className="font-heading text-lg font-bold">مواعيد الخدمة</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {SERVICE_TIMES.map((s) => (
            <div
              key={s.day}
              className="flex items-start gap-3 rounded-xl border bg-card p-4"
            >
              <Clock className="mt-0.5 size-5 text-coptic-teal" />
              <div>
                <p className="font-semibold">{s.day}</p>
                <p className="text-sm text-muted-foreground">{s.time}</p>
                <p className="text-xs text-muted-foreground">{s.note}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Contact */}
      <div className="space-y-3">
        <h2 className="font-heading text-lg font-bold">تواصل الكنيسة</h2>
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3">
            <Phone className="size-4 text-coptic-teal" />
            <span className="text-sm">{CHURCH_CONTACT.phone}</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3">
            <Bell className="size-4 text-coptic-teal" />
            <span className="text-sm">{CHURCH_CONTACT.email}</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3">
            <Globe className="size-4 text-coptic-teal" />
            <span className="text-sm">{CHURCH_CONTACT.address}</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
                <div className="card-hover flex items-center gap-3 rounded-xl border bg-card p-4">
          <div className="flex size-10 items-center justify-center rounded-xl bg-coptic-teal/10 text-coptic-teal">
            <Users className="size-5" />
          </div>
          <div>
            <p className="font-heading text-xl font-extrabold">{memberCount}</p>
            <p className="text-xs text-muted-foreground">مخدوم نشط</p>
          </div>
        </div>
        <div className="card-hover flex items-center gap-3 rounded-xl border bg-card p-4">
          <div className="flex size-10 items-center justify-center rounded-xl bg-coptic-gold-soft text-coptic-gold">
            <HeartHandshake className="size-5" />
          </div>
          <div>
            <p className="font-heading text-xl font-extrabold">{servantCount}</p>
            <p className="text-xs text-muted-foreground">خادم نشط</p>
          </div>
        </div>
      </div>

      <NileDivider />

      {/* Coptic calendar */}
      <div className="space-y-3">
        <h2 className="flex items-center gap-2 font-heading text-lg font-bold">
          <CalendarDays className="size-5 text-coptic-teal" />
          التقويم القبطي اليوم
        </h2>

        {calendarResult.ok ? (
          <div className="card-hover rounded-2xl border bg-card p-5">
            <h3 className="font-heading text-xl font-bold text-coptic-teal">
              {calendarResult.day.copticDate.monthString}{" "}
              {calendarResult.day.copticDate.day}، {calendarResult.day.copticDate.year}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {calendarResult.day.copticDate.dateString}
            </p>

            {calendarResult.day.celebrations.length > 0 ? (
              <div className="mt-3 space-y-1">
                {calendarResult.day.celebrations.map((c) => (
                  <p key={c.name} className="text-sm">
                    • {c.name}
                  </p>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                لا توجد احتفالات اليوم
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{calendarResult.message}</p>
        )}

        {feastsResult.ok && feastsResult.days.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">
              الأعياد القادمة (١٤ يوم)
            </h3>
            {feastsResult.days.map((day) => (
              <div
                key={day.date}
                className="card-hover flex items-center justify-between rounded-xl border bg-card px-4 py-3"
              >
                <div>
                  <p className="font-medium">{day.celebrations[0]?.name ?? "عيد"}</p>
                  <p className="text-xs text-muted-foreground">
                    {day.copticDate.monthString} {day.copticDate.day}
                  </p>
                </div>
                <Link href="/app/super-admin/coptic-calendar">
                  <Button variant="link" size="sm" className="text-xs">
                    التقويم الكامل
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="pt-4 text-center">
        <p className="text-xs text-muted-foreground">
          يحيا المسيح 🕊️ — {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}