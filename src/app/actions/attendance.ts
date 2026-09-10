"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ROLES, isAdminRole } from "@/lib/roles"
import { ATTENDANCE_TYPE_LABELS } from "@/lib/constants"
import {
  checkInByIdentifier,
  checkInByProfileId,
  correctAttendance,
  resolvePersonByIdentifier,
  type AttendanceCorrection,
} from "@/services/attendance-service"
import type { AttendanceSource, AttendanceType } from "@/lib/types"
import { isUuid } from "@/lib/validation"

const VALID_TYPES = Object.keys(ATTENDANCE_TYPE_LABELS) as AttendanceType[]

function isAttendanceType(value: string): value is AttendanceType {
  return (VALID_TYPES as string[]).includes(value)
}

async function requireAdminActor(): Promise<{ adminId: string; role: string } | null> {
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

  if (!profile || !isAdminRole(profile.role)) return null
  return { adminId: user.id, role: profile.role }
}

export type ResolveIdentityResult =
  | {
      ok: true
      person: {
        id: string
        fullName: string
        role: string
        avatarUrl: string | null
      }
    }
  | { ok: false; message: string }

/** Identity preview for the manual 6-digit code fallback. Nothing is recorded. */
export async function resolveAttendanceIdentityAction(
  code: string,
  type: AttendanceType
): Promise<ResolveIdentityResult> {
  const actor = await requireAdminActor()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (typeof type !== "string" || !isAttendanceType(type)) {
    return { ok: false, message: "نوع الحضور غير صحيح" }
  }

  const admin = createAdminClient()
  const person = await resolvePersonByIdentifier(admin, "CODE", code.trim())
  if (!person) return { ok: false, message: "الكود غير صحيح" }
  if (person.status !== "ACTIVE") return { ok: false, message: "هذا الحساب غير نشط" }

  return {
    ok: true,
    person: {
      id: person.id,
      fullName: person.fullName,
      role: person.role,
      avatarUrl: person.avatarUrl,
    },
  }
}

export type RecordAttendanceResult = {
  status: "success" | "duplicate" | "error"
  message?: string
  person?: { id: string; fullName: string; role: string; avatarUrl: string | null }
  attendedAt?: string
  cairoTime?: string
  type?: AttendanceType
  source?: AttendanceSource
  points?: number
}

/**
 * Records attendance from the scanner (QR capability token) or the manual
 * 6-digit code. The server owns resolution, time, points and duplicate rules.
 */
export async function recordAttendanceAction(
  mode: "QR" | "CODE",
  identifier: string,
  type: AttendanceType
): Promise<RecordAttendanceResult> {
  const actor = await requireAdminActor()
  if (!actor) return { status: "error", message: "غير مصرح" }
  if (mode !== "QR" && mode !== "CODE") return { status: "error", message: "طريقة غير صحيحة" }
  if (typeof type !== "string" || !isAttendanceType(type)) {
    return { status: "error", message: "نوع الحضور غير صحيح" }
  }

  const admin = createAdminClient()
  const outcome = await checkInByIdentifier(admin, {
    actorId: actor.adminId,
    mode,
    identifier: identifier.trim(),
    type,
  })

  if (outcome.status === "error") return outcome
  if (outcome.status === "success") {
    return {
      status: "success",
      person: outcome.person,
      attendedAt: outcome.attendedAt,
      cairoTime: outcome.cairoTime,
      type: outcome.type,
      source: outcome.source,
      points: outcome.points,
    }
  }
  return {
    status: "duplicate",
    person: outcome.person,
    attendedAt: outcome.attendedAt,
    type: outcome.type,
    points: outcome.points,
  }
}

/**
 * Admin/Super Admin manual attendance. Time and points always come from the
 * server — admins cannot backdate records (that is a separate correction flow
 * reserved for Super Admin).
 */
export async function manualAttendanceAction(
  profileId: string,
  type: AttendanceType
): Promise<RecordAttendanceResult> {
  const actor = await requireAdminActor()
  if (!actor) return { status: "error", message: "غير مصرح" }
  if (!isUuid(profileId)) return { status: "error", message: "بيانات غير صحيحة" }
  if (typeof type !== "string" || !isAttendanceType(type)) {
    return { status: "error", message: "نوع الحضور غير صحيح" }
  }

  const admin = createAdminClient()
  const outcome = await checkInByProfileId(admin, {
    actorId: actor.adminId,
    profileId,
    type,
  })

  if (outcome.status === "error") return outcome
  if (outcome.status === "success") {
    return {
      status: "success",
      person: outcome.person,
      attendedAt: outcome.attendedAt,
      cairoTime: outcome.cairoTime,
      type: outcome.type,
      source: outcome.source,
      points: outcome.points,
    }
  }
  return {
    status: "duplicate",
    person: outcome.person,
    attendedAt: outcome.attendedAt,
    type: outcome.type,
    points: outcome.points,
  }
}

export type CorrectAttendanceResult = { ok: boolean; message: string }

/** Super Admin only: change attendance type or void. Every change is audited. */
export async function correctAttendanceAction(
  recordId: string,
  change: AttendanceCorrection
): Promise<CorrectAttendanceResult> {
  const actor = await requireAdminActor()
  if (!actor) return { ok: false, message: "غير مصرح" }
  if (!isUuid(recordId)) return { ok: false, message: "بيانات غير صحيحة" }
  if (actor.role !== ROLES.SUPER_ADMIN) {
    return { ok: false, message: "هذه العملية متاحة لمسؤول عام فقط" }
  }

  const admin = createAdminClient()
  return correctAttendance(admin, { actorId: actor.adminId, recordId, change })
}