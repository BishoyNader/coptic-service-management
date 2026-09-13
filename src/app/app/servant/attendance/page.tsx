import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { getServerNow } from "@/services/attendance-service"
import { cairoDateString } from "@/lib/cairo"
import { formatArabicDate } from "@/lib/dates"
import { fetchAttendanceBoardPageAction } from "@/app/actions/attendance"
import { ServantAttendanceBoard } from "@/components/app/servant-attendance-board"

export const metadata: Metadata = { title: "الحضور" }

export default async function ServantAttendancePage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVANT) redirect("/")

  const today = cairoDateString(getServerNow())

  const [servantsRes, membersRes, todayResult] = await Promise.all([
    fetchAttendanceBoardPageAction({ role: "SERVANT", query: "", offset: 0 }),
    fetchAttendanceBoardPageAction({ role: "SERVED_MEMBER", query: "", offset: 0 }),
    supabase
      .from("attendance_records")
      .select(
        "profile_id, attended_at, points, source, status, session:attendance_sessions(type), subject:profiles!attendance_records_profile_id_fkey(role)"
      )
      .eq("session.session_date", today)
      .neq("status", "ARCHIVED"),
  ])

  const todayRows = (todayResult.data ?? []) as unknown as {
    profile_id: string
    subject: { role: string } | null
  }[]

  const subjects = new Map<string, string>()
  for (const row of todayRows) {
    const role = row.subject?.role
    if (role === "SERVANT" || role === "SERVED_MEMBER") {
      subjects.set(row.profile_id, role)
    }
  }

  let servantsPresent = 0
  let membersPresent = 0
  for (const [, role] of subjects) {
    if (role === "SERVANT") servantsPresent++
    else membersPresent++
  }

  return (
    <ServantAttendanceBoard
      initialServants={servantsRes.people}
      initialMembers={membersRes.people}
      servantsTotal={servantsRes.total}
      membersTotal={membersRes.total}
      summary={{
        servantsPresent,
        membersPresent,
        ownPresent: subjects.has(profile.id),
      }}
      todayLabel={formatArabicDate(new Date())}
      actorId={profile.id}
    />
  )
}