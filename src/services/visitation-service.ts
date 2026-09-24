/**
 * Member visitation service (الافتقاد).
 *
 * A servant (or super-admin) records that they checked on an active served
 * member on a given Cairo day. The board groups active served members by
 * class and enriches each member with their latest visit (date + recorder)
 * so the UI can colour freshness green → red over 30 days.
 */
import type { SupabaseAdminClient } from "../lib/supabase/admin"
import { ROLES } from "../lib/roles"
import { logAudit } from "./auth-service"
import { getServerNow } from "./attendance-service"
import { cairoDateString } from "../lib/cairo"
import { daysBetweenDates } from "../lib/dates"
import { listActiveClasses } from "./classes-service"

export const VISITATION_ENTITY = "MEMBER_VISIT"
export const VISITATION_RECORDED_ACTION = "MEMBER_VISITED"

/** Days after a visit when a member is considered overdue for الافتقاد. */
export const VISIT_WINDOW_DAYS = 30

/** Group key used for active members whose class is not assigned. */
const UNCLASSIFIED_KEY = "unclassified"

export type VisitationMember = {
  memberId: string
  fullName: string
  /** Cairo date (YYYY-MM-DD) of the latest visit, null when never visited. */
  lastVisitDate: string | null
  /** full name of the servant who recorded the latest visit. */
  visitedBy: string | null
  /** Whole Cairo days since the latest visit; null when never visited. */
  daysSince: number | null
}

export type VisitationGroup = {
  key: string
  className: string
  members: VisitationMember[]
}

export type VisitationBoardOptions = {
  /**
   * Restrict to these classes only (a servant's assigned class). When empty,
   * every class that has active members is returned.
   */
  classIds?: string[] | null
  /** Include an extra "بدون صنف" group for members without a class. */
  includeUnclassified?: boolean
  /** Cairo date string used as "today"; defaults to the server's Cairo now. */
  today?: string
}

type RawServedRow = {
  id: string
  full_name: string
  served_members?: { class_id: string | null } | Array<{ class_id: string | null }> | null
}

type RawVisitRow = {
  member_id: string
  visit_date: string
  recorded_by: string | null
}

type MemberTuple = { memberId: string; fullName: string; classId: string | null }

/** Diagnostic- and query-friendly description of the whole board. */
export async function getVisitationBoard(
  admin: SupabaseAdminClient,
  opts: VisitationBoardOptions = {}
): Promise<VisitationGroup[]> {
  const today = opts.today ?? cairoDateString(getServerNow())
  const scoped = opts.classIds?.length ? opts.classIds : null

  const { data: raw } = await admin
    .from("profiles")
    .select("id, full_name, served_members!inner(class_id)")
    .eq("role", ROLES.SERVED_MEMBER)
    .eq("status", "ACTIVE")
    .order("full_name")

  const members: MemberTuple[] = ((raw ?? []) as RawServedRow[])
    .map((r) => {
      const detail = Array.isArray(r.served_members)
        ? r.served_members[0]
        : r.served_members
      return { memberId: r.id, fullName: r.full_name, classId: detail?.class_id ?? null }
    })
    .filter((m) => (scoped ? m.classId !== null && scoped.includes(m.classId) : true))

  const visits = await loadLatestVisits(admin, members.map((m) => m.memberId))

  const byClass = new Map<string, VisitationMember[]>()
  for (const m of members) {
    const visit = visits.get(m.memberId)
    const member: VisitationMember = {
      memberId: m.memberId,
      fullName: m.fullName,
      lastVisitDate: visit?.visitDate ?? null,
      visitedBy: visit?.recordedBy ?? null,
      daysSince: visit ? daysBetweenDates(visit.visitDate, today) : null,
    }
    const key = m.classId ?? UNCLASSIFIED_KEY
    const list = byClass.get(key) ?? []
    if (list.length === 0) byClass.set(key, list)
    list.push(member)
  }

  // Build groups in stable class order, then the unclassified bucket last.
  const groups: VisitationGroup[] = []
  if (scoped) {
    const { data: classes } = await admin
      .from("classes")
      .select("id, name")
      .in("id", scoped)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true })
    for (const c of classes ?? []) appendGroup(groups, c.id, c.name, byClass)
  } else {
    for (const c of await listActiveClasses(admin)) {
      appendGroup(groups, c.id, c.name, byClass)
    }
  }

  if (opts.includeUnclassified) {
    appendGroup(groups, UNCLASSIFIED_KEY, "بدون صنف", byClass)
  }

  return groups
}

function appendGroup(
  groups: VisitationGroup[],
  key: string,
  className: string,
  byClass: Map<string, VisitationMember[]>
): void {
  const members = byClass.get(key)
  if (members?.length) groups.push({ key, className, members })
}

/**
 * Latest visit per member. Rows arrive ordered by visit_date DESC, so the
 * first row seen for a member is their most recent visit. Recorder names are
 * resolved in a single batched profile lookup.
 */
async function loadLatestVisits(
  admin: SupabaseAdminClient,
  memberIds: string[]
): Promise<Map<string, { visitDate: string; recordedBy: string | null }>> {
  const latest = new Map<string, { visitDate: string; recordedBy: string | null }>()
  if (memberIds.length === 0) return latest

  const { data } = await admin
    .from("member_visits")
    .select("member_id, visit_date, recorded_by")
    .in("member_id", memberIds)
    .order("visit_date", { ascending: false })
    .limit(50000)

  const recorderIds = new Set<string>()
  for (const v of (data ?? []) as RawVisitRow[]) {
    if (v.recorded_by) recorderIds.add(v.recorded_by)
    if (!latest.has(v.member_id)) {
      latest.set(v.member_id, { visitDate: v.visit_date, recordedBy: v.recorded_by })
    }
  }

  const nameById = new Map<string, string>()
  const ids = [...recorderIds]
  if (ids.length > 0) {
    const { data: recorders } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", ids)
    for (const r of (recorders ?? []) as { id: string; full_name: string }[]) {
      nameById.set(r.id, r.full_name)
    }
  }

  for (const entry of latest.values()) {
    entry.recordedBy = entry.recordedBy ? (nameById.get(entry.recordedBy) ?? null) : null
  }
  return latest
}

export type VisitRecordResult = {
  ok: boolean
  duplicate?: boolean
  message: string
  visitDate?: string
}

/**
 * Records a visitation for a member on today's Cairo date. Repeating the same
 * member the same day is a no-op flagged as `duplicate` (safe to call from a
 * double-click).
 */
export async function recordMemberVisit(
  admin: SupabaseAdminClient,
  params: { actorId: string; memberId: string; today?: string }
): Promise<VisitRecordResult> {
  const today = params.today ?? cairoDateString(getServerNow())

  const { data: member } = await admin
    .from("profiles")
    .select("id, full_name, role, status")
    .eq("id", params.memberId)
    .maybeSingle()

  if (!member || member.role !== ROLES.SERVED_MEMBER || member.status !== "ACTIVE") {
    return { ok: false, message: "المخدوم غير موجود أو غير نشط" }
  }

  const { data: inserted, error } = await admin
    .from("member_visits")
    .insert({ member_id: params.memberId, recorded_by: params.actorId, visit_date: today })
    .select("id")
    .maybeSingle()

  if (error) {
    if (error.code === "23505") {
      return { ok: false, duplicate: true, message: "تم الافتقاد اليوم بالفعل", visitDate: today }
    }
    return { ok: false, message: "تعذّر تسجيل الافتقاد" }
  }

  await logAudit(admin, {
    actorId: params.actorId,
    action: VISITATION_RECORDED_ACTION,
    entity: VISITATION_ENTITY,
    entityId: inserted?.id ?? null,
    metadata: {
      member_id: params.memberId,
      member_name: member.full_name,
      visit_date: today,
    },
  })

  return { ok: true, message: "تم تسجيل الافتقاد", visitDate: today }
}