"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ROLES } from "@/lib/roles"
import { isUuid } from "@/lib/validation"
import { cairoDateString } from "@/lib/cairo"
import { getServerNow } from "@/services/attendance-service"
import {
  getScoringBoardData,
  upsertMemberActivityScore,
  type ScoringBoardData,
} from "@/services/member-scoring-service"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** True for a real "YYYY-MM-DD" calendar date (rejects e.g. 2026-02-30). */
function isRealDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false
  const [y, m, d] = value.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

async function requireServantActor(): Promise<{ actorId: string; role: string } | null> {
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

  if (
    !profile ||
    (profile.role !== ROLES.SERVANT && profile.role !== ROLES.SUPER_ADMIN)
  ) {
    return null
  }
  return { actorId: user.id, role: profile.role }
}

export type ScoringBoardResult =
  | { ok: true; board: ScoringBoardData }
  | { ok: false; message: string }

/** Servant/super-admin unified board: all active members + their day's data. */
export async function getScoringBoardAction(date: string): Promise<ScoringBoardResult> {
  const actor = await requireServantActor()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (typeof date !== "string" || !isRealDateString(date)) {
    return { ok: false, message: "التاريخ غير صحيح" }
  }
  const cairoToday = cairoDateString(getServerNow())
  if (date > cairoToday) return { ok: false, message: "لا يمكن عرض تاريخ مستقبلي" }

  const board = await getScoringBoardData(createAdminClient(), date)
  return { ok: true, board }
}

export type SaveBoardScoresInput = {
  memberId: string
  date: string
  scores: { activityId: string; points: number }[]
}

export type SaveBoardScoresResult = {
  ok: boolean
  saved: number
  failed: number
  message: string
}

/**
 * Saves a member's day-of activity grades from the unified board. Each entry
 * goes through the same validated service path (0 clears the row, range and
 * active-member checks), and every row is audited.
 */
export async function saveMemberActivityScoresAction(
  input: SaveBoardScoresInput
): Promise<SaveBoardScoresResult> {
  const actor = await requireServantActor()
  if (!actor) return { ok: false, saved: 0, failed: 0, message: "غير مصرح" }
  if (!input || !isUuid(input.memberId) || !isRealDateString(input.date)) {
    return { ok: false, saved: 0, failed: 0, message: "بيانات غير صحيحة" }
  }
  const cairoToday = cairoDateString(getServerNow())
  if (input.date > cairoToday) {
    return { ok: false, saved: 0, failed: 0, message: "لا يمكن تسجيل درجة في تاريخ مستقبلي" }
  }
  if (!Array.isArray(input.scores) || input.scores.length === 0) {
    return { ok: false, saved: 0, failed: 0, message: "لا توجد درجات للحفظ" }
  }

  const admin = createAdminClient()
  let saved = 0
  let failed = 0

  for (const entry of input.scores) {
    if (!entry || !isUuid(entry.activityId) || !Number.isFinite(entry.points)) {
      failed += 1
      continue
    }
    const res = await upsertMemberActivityScore(admin, {
      actorId: actor.actorId,
      memberId: input.memberId,
      activityId: entry.activityId,
      date: input.date,
      points: entry.points,
    })
    if (res.ok) saved += 1
    else failed += 1
  }

  if (saved === 0 && failed > 0) {
    return { ok: false, saved, failed, message: "تعذر حفظ الدرجات" }
  }
  if (failed > 0) {
    return { ok: true, saved, failed, message: `تم حفظ ${saved} درجة، ورفض ${failed}` }
  }
  return { ok: true, saved, failed, message: `تم حفظ ${saved} درجة ✓` }
}