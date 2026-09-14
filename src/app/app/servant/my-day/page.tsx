import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { cairoDateString } from "@/lib/cairo"
import { ServantMyDay } from "@/components/app/servant-my-day"
import type { AttendanceType } from "@/lib/types"

export const metadata: Metadata = { title: "حضوري وأنشطتي" }

const SELF_HISTORY_DAYS = 14

export default async function ServantMyDayPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVANT) redirect("/")

  const now = new Date()
  const cairoToday = cairoDateString(now)
  const minDate = cairoDateString(new Date(now.getTime() - 90 * 86_400_000))
  const historySince = cairoDateString(new Date(now.getTime() - SELF_HISTORY_DAYS * 86_400_000))

  const [{ data: todayData }, { data: recentData }, { data: activitiesData }, { data: recordsData }] =
    await Promise.all([
      supabase
        .from("attendance_records")
        .select("id, points, attended_at, session:attendance_sessions(type)")
        .eq("profile_id", profile.id)
        .neq("status", "ARCHIVED")
        .eq("session.session_date", cairoToday),
      supabase
        .from("attendance_records")
        .select("id, points, attended_at, session:attendance_sessions(type, session_date)")
        .eq("profile_id", profile.id)
        .neq("status", "ARCHIVED")
        .gte("session.session_date", historySince)
        .order("attended_at", { ascending: false })
        .limit(60),
      supabase
        .from("activities")
        .select("id, name, icon, sort_order")
        .eq("for_role", ROLES.SERVANT)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      supabase
        .from("servant_activity_records")
        .select("id, recorded_on, activity_id, activity:activities(name, icon)")
        .eq("servant_id", profile.id)
        .order("recorded_on", { ascending: false })
        .limit(1000),
    ])

  const todayAttendance = (todayData ?? []).map((r) => ({
    id: r.id as string,
    type: ((r as { session?: { type?: string | null } | null }).session?.type ??
      "CHURCH") as AttendanceType,
    points: Number(r.points),
    attendedAt: r.attended_at as string,
  }))

  const recentAttendance = (recentData ?? []).map((r) => ({
    id: r.id as string,
    type: ((r as { session?: { type?: string | null } | null }).session?.type ??
      "CHURCH") as AttendanceType,
    date: ((r as { session?: { session_date?: string | null } | null }).session
      ?.session_date ?? cairoToday) as string,
    points: Number(r.points),
    attendedAt: r.attended_at as string,
  }))

  const activities = (activitiesData ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    icon: (a.icon as string | null) ?? null,
  }))

  const history = (recordsData ?? []).map((r) => ({
    activityId: r.activity_id as string,
    recordedOn: r.recorded_on as string,
  }))

  return (
    <div className="space-y-6">
      <ServantMyDay
        profileId={profile.id}
        cairoToday={cairoToday}
        minDate={minDate}
        todayAttendance={todayAttendance}
        recentAttendance={recentAttendance}
        activities={activities}
        history={history}
      />
    </div>
  )
}