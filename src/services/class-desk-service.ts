/**
 * Super Admin class desk.
 *
 * One Cairo day, one class: every ACTIVE servant of the class with their day
 * desk (today's attendance + SERVANT activities + history) and every ACTIVE
 * served member of the class already covered by the shared scoring board.
 *
 * All reads run over the service-role client; the caller (server page / action)
 * owns the SUPER_ADMIN gate.
 */
import type { SupabaseAdminClient } from "../lib/supabase/admin"
import { ROLES } from "../lib/roles"
import { getServantDayData, type ServantDayData } from "./servant-day-service"
import { getScoringBoardData, type ScoringBoardData } from "./member-scoring-service"

export type DeskServant = {
  profileId: string
  fullName: string
  day: ServantDayData
}

export type ClassDeskData = {
  classId: string
  className: string
  servants: DeskServant[]
  board: ScoringBoardData
}

/** Active servants of a class, ordered by name. */
async function listClassServants(
  admin: SupabaseAdminClient,
  classId: string
): Promise<{ id: string; full_name: string }[]> {
  const { data } = await admin
    .from("profiles")
    .select("id, full_name")
    .eq("role", ROLES.SERVANT)
    .eq("status", "ACTIVE")
    .eq("servants.class_id", classId)
    .order("full_name", { ascending: true })
  return (data ?? []) as { id: string; full_name: string }[]
}

export async function getClassDeskData(
  admin: SupabaseAdminClient,
  classId: string,
  date: string,
  historySince: string
): Promise<ClassDeskData> {
  const { data: cls } = await admin
    .from("classes")
    .select("id, name")
    .eq("id", classId)
    .maybeSingle()

  const [servantProfiles, board] = await Promise.all([
    listClassServants(admin, classId),
    getScoringBoardData(admin, date, classId),
  ])

  const servants: DeskServant[] = await Promise.all(
    servantProfiles.map(async (p) => ({
      profileId: p.id,
      fullName: p.full_name,
      day: await getServantDayData(admin, p.id, date, historySince),
    }))
  )

  return {
    classId,
    className: (cls?.name as string | undefined) ?? "صف",
    servants,
    board,
  }
}