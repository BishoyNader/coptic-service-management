import type { Metadata } from "next"
import { redirect, notFound } from "next/navigation"
import { ArrowRight } from "lucide-react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/server"
import { getProfile, getProfileById } from "@/services/profile-service"
import { ROLES, ROLE_LABELS } from "@/lib/roles"
import { AdminMemberView } from "@/components/app/admin-member-view"
import { adminUpdateProfileAction, adminUpdateStatusAction } from "@/app/actions/profile"

export const metadata: Metadata = { title: "عرض مستخدم" }

export default async function SuperAdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const session = await getProfile(supabase)
  if (!session || session.role !== ROLES.SUPER_ADMIN) redirect("/")

  const profile = await getProfileById(supabase, id)
  if (!profile) notFound()

  const [codesResult, attendanceResult, scoresResult] = await Promise.all([
    supabase
      .from("personal_codes")
      .select("code, qr_token")
      .eq("profile_id", id)
      .maybeSingle(),
    supabase
      .from("attendance_records")
      .select("id, attended_at")
      .eq("profile_id", id)
      .in("status", ["PRESENT", "LATE"])
      .order("attended_at", { ascending: false })
      .limit(50),
    supabase
      .from("score_records")
      .select("id, category, points, session_date, note")
      .eq("profile_id", id)
      .order("session_date", { ascending: false })
      .limit(50),
  ])

  const attendance = (attendanceResult.data ?? []) as { id: string; attended_at: string }[]
  const scores = (scoresResult.data ?? []) as {
    id: string
    category: string
    points: number
    session_date: string
    note: string | null
  }[]

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href="/app/super-admin/users"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowRight className="size-4" />
          رجوع للمستخدمين
        </Link>
        <span className="rounded-full bg-secondary px-3 py-1 text-xs font-bold text-muted-foreground">
          {ROLE_LABELS[profile.role]}
        </span>
      </div>

      <AdminMemberView
        profile={profile}
        personalCode={codesResult.data?.code}
        qrToken={codesResult.data?.qr_token}
        attendance={attendance}
        scores={scores}
        onSubmit={adminUpdateProfileAction}
        onChangeStatus={adminUpdateStatusAction}
      />
    </div>
  )
}