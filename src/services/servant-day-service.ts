import type { SupabaseAdminClient } from "@/lib/supabase/admin"
import { ROLES } from "@/lib/roles"
import type { AttendanceType } from "@/lib/types"

export type SelfTodayAttendance = {
  id: string
  type: AttendanceType
  points: number
  attendedAt: string
}

export type SelfRecentAttendance = {
  id: string
  type: AttendanceType
  date: string
  points: number
  attendedAt: string
}

export type SelfActivity = { id: string; name: string; icon: string | null }

export type SelfHistoryEntry = { activityId: string; recordedOn: string }

export type ServantDayData = {
  servantId: string
  servantName: string
  todayAttendance: SelfTodayAttendance[]
  recentAttendance: SelfRecentAttendance[]
  activities: SelfActivity[]
  history: SelfHistoryEntry[]
}

/**
 * One servant's "day desk": today's attendance, a recent window of
 * attendance, the SERVANT-scoped active activities and their participation
 * history. Shared by the servant self tab (their own desk) and the super
 * admin on-behalf tab (any active servant). Reads run over the service-role
 * client; the caller owns the role gate.
 */
export async function getServantDayData(
  admin: SupabaseAdminClient,
  servantId: string,
  cairoToday: string,
  historySince: string
): Promise<ServantDayData> {
  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("id", servantId)
    .maybeSingle()

  const [{ data: todayData }, { data: recentData }, { data: activitiesData }, { data: recordsData }] =
    await Promise.all([
      admin
        .from("attendance_records")
        .select("id, points, attended_at, session:attendance_sessions!inner(type)")
        .eq("profile_id", servantId)
        .neq("status", "ARCHIVED")
        .eq("session.session_date", cairoToday),
      admin
        .from("attendance_records")
        .select(
          "id, points, attended_at, session:attendance_sessions!inner(type, session_date)"
        )
        .eq("profile_id", servantId)
        .neq("status", "ARCHIVED")
        .gte("session.session_date", historySince)
        .order("attended_at", { ascending: false })
        .limit(60),
      admin
        .from("activities")
        .select("id, name, icon, sort_order")
        .eq("for_role", ROLES.SERVANT)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      admin
        .from("servant_activity_records")
        .select("id, recorded_on, activity_id, activity:activities(name, icon)")
        .eq("servant_id", servantId)
        .order("recorded_on", { ascending: false })
        .limit(1000),
    ])

  const todayAttendance: SelfTodayAttendance[] = (todayData ?? []).map((r) => ({
    id: r.id,
    type: ((r as { session?: { type?: string | null } | null }).session?.type ??
      "CHURCH") as AttendanceType,
    points: Number(r.points),
    attendedAt: r.attended_at,
  }))

  const recentAttendance: SelfRecentAttendance[] = (recentData ?? []).map((r) => {
    const session = (r as { session?: { type?: string | null; session_date?: string | null } | null })
      .session
    return {
      id: r.id,
      type: (session?.type ?? "CHURCH") as AttendanceType,
      date: (session?.session_date ?? cairoToday) as string,
      points: Number(r.points),
      attendedAt: r.attended_at,
    }
  })

  return {
    servantId,
    servantName: (profile?.full_name as string | undefined) ?? "خادم",
    todayAttendance,
    recentAttendance,
    activities: (activitiesData ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      icon: (a.icon as string | null) ?? null,
    })),
    history: (recordsData ?? []).map((r) => ({
      activityId: r.activity_id,
      recordedOn: r.recorded_on,
    })),
  }
}