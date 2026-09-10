"use server"

import { createClient } from "@/lib/supabase/server"
import type { SupabaseServerClient } from "@/lib/supabase/server"
import { ROLES } from "@/lib/roles"
import {
  buildActivitiesReport,
  buildAttendanceReport,
  buildScoresReport,
  validateRange,
  type ActivitiesReport,
  type AttendanceReport,
  type ScoresReport,
} from "@/services/reports-service"

/**
 * Reports are accessible to ADMIN and SUPER_ADMIN.
 * The actor is re-verified inside every action from the session (never from
 * anything the browser forwards); reports read through the authenticated
 * client so RLS still applies.
 */
async function requireAdmin(): Promise<{ supabase: SupabaseServerClient; actorId: string } | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile || (profile.role !== ROLES.SUPER_ADMIN && profile.role !== ROLES.ADMIN)) return null
  return { supabase, actorId: user.id }
}

export type ReportActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string }

export async function getAttendanceReportAction(
  range: unknown
): Promise<ReportActionResult<AttendanceReport>> {
  const actor = await requireAdmin()
  if (!actor) return { ok: false, message: "غير مصرح" }

  let rangeValue
  try {
    rangeValue = validateRange(range)
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
  const data = await buildAttendanceReport(actor.supabase, rangeValue)
  return { ok: true, data }
}

export async function getScoresReportAction(
  range: unknown
): Promise<ReportActionResult<ScoresReport>> {
  const actor = await requireAdmin()
  if (!actor) return { ok: false, message: "غير مصرح" }

  let rangeValue
  try {
    rangeValue = validateRange(range)
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
  const data = await buildScoresReport(actor.supabase, rangeValue)
  return { ok: true, data }
}

export async function getActivitiesReportAction(
  range: unknown
): Promise<ReportActionResult<ActivitiesReport>> {
  const actor = await requireAdmin()
  if (!actor) return { ok: false, message: "غير مصرح" }

  let rangeValue
  try {
    rangeValue = validateRange(range)
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }
  const data = await buildActivitiesReport(actor.supabase, rangeValue)
  return { ok: true, data }
}
