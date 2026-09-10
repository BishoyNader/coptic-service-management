"use server"

import { createClient } from "@/lib/supabase/server"
import { ROLES, type AppRole } from "@/lib/roles"
import { toAttendanceRows } from "@/services/attendance-service"
import { LIST_PAGE_SIZE, ATTENDANCE_PAGE_SIZE } from "@/lib/pagination"
import type {
  AttendanceSource,
  AttendanceStatus,
  AttendanceType,
} from "@/lib/types"

type ActorCheck =
  | { ok: true }
  | { ok: false }

async function requireSuperAdmin(): Promise<ActorCheck> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false }

  const { data: actor } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()
  if (!actor || actor.role !== ROLES.SUPER_ADMIN) return { ok: false }
  return { ok: true }
}

export type ListedUser = {
  id: string
  full_name: string
  phone: string
  role: AppRole
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED"
}

export type ListedAttendance = {
  id: string
  attended_at: string
  points: number
  source: AttendanceSource
  status: AttendanceStatus
  type: AttendanceType
  fullName: string
  role: AppRole
}

/**
 * Loads the next page of ALL profiles for the super-admin users list.
 * SUPER_ADMIN only; offset pagination keeps the page responsive.
 */
export async function loadMoreUsersAction(
  offset: number
): Promise<{ ok: boolean; users: ListedUser[]; message?: string }> {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return { ok: false, users: [], message: "غير مصرح" }

  const supabase = await createClient()
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role, status")
    .order("full_name", { ascending: true })
    .order("id")
    .range(offset, offset + LIST_PAGE_SIZE - 1)

  return {
    ok: true,
    users: (data ?? []).map((u) => ({
      id: u.id as string,
      full_name: u.full_name as string,
      phone: u.phone as string,
      role: u.role as AppRole,
      status: u.status as ListedUser["status"],
    })),
  }
}

/**
 * Loads the next page of attendance records for the super-admin log.
 * SUPER_ADMIN only.
 */
export async function loadMoreAttendanceAction(
  offset: number
): Promise<{ ok: boolean; records: ListedAttendance[]; message?: string }> {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return { ok: false, records: [], message: "غير مصرح" }

  const supabase = await createClient()
  const { data } = await supabase
    .from("attendance_records")
    .select(
      "id, attended_at, points, source, status, session:attendance_sessions(type), profile:profiles!attendance_records_profile_id_fkey(full_name, role)"
    )
    .order("attended_at", { ascending: false })
    .order("id")
    .range(offset, offset + ATTENDANCE_PAGE_SIZE - 1)

  return { ok: true, records: toAttendanceRows((data ?? []) as never[]) }
}