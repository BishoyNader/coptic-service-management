"use server"

import { createClient } from "@/lib/supabase/server"
import type { SupabaseServerClient } from "@/lib/supabase/server"
import { ROLES } from "@/lib/roles"
import { validateRange, type ReportRange } from "@/services/reports-service"

const REPORT_EXPORT_LIMIT = 5000
const MEMBERS_EXPORT_LIMIT = 5000
const AUDIT_EXPORT_LIMIT = 5000

type ExportActionResult =
  | { ok: true; csv: string; filename: string }
  | { ok: false; message: string }

async function requireAdmin(): Promise<SupabaseServerClient | null> {
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
  return supabase
}

function csvEscape(value: string | number | null | undefined): string {
  const s = String(value ?? "")
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(csvEscape).join(",")]
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","))
  }
  return lines.join("\n")
}

// --- Members export ----------------------------------------------------------

export async function exportMembersAction(): Promise<ExportActionResult> {
  const supabase = await requireAdmin()
  if (!supabase) return { ok: false, message: "غير مصرح" }

  const { data } = await supabase
    .from("profiles")
    .select("full_name, phone, role, status, date_of_birth, created_at")
    .eq("role", "SERVED_MEMBER")
    .order("full_name", { ascending: true })
    .limit(MEMBERS_EXPORT_LIMIT)

  const csv = toCsv(
    ["الاسم", "الموبايل", "الدور", "الحالة", "تاريخ الميلاد", "تاريخ الإنشاء"],
    (data ?? []).map((r) => [
      r.full_name,
      r.phone,
      r.role,
      r.status,
      r.date_of_birth ?? "",
      new Date(r.created_at).toLocaleDateString("ar-EG"),
    ]),
  )

  return { ok: true, csv, filename: "members.csv" }
}

// --- Attendance report export ------------------------------------------------

export async function exportAttendanceReportAction(
  range: unknown
): Promise<ExportActionResult> {
  const supabase = await requireAdmin()
  if (!supabase) return { ok: false, message: "غير مصرح" }

  let rangeValue: ReportRange
  try {
    rangeValue = validateRange(range)
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }

  const { from, to } = rangeValue
  const { data } = await supabase
    .from("attendance_records")
    .select(
      "attended_at, points, source, status, session:attendance_sessions(type), profile:profiles!attendance_records_profile_id_fkey(full_name, role)"
    )
    .gte("attended_at", `${from}T00:00:00.000Z`)
    .lte("attended_at", `${to}T23:59:59.999Z`)
    .order("attended_at", { ascending: false })
    .limit(REPORT_EXPORT_LIMIT)

  const csv = toCsv(
    ["الاسم", "الدور", "التاريخ", "النوع", "النقاط", "المصدر", "الحالة"],
    (data ?? [])
      .filter((r: Record<string, unknown>) => (r as { status: string }).status !== "ARCHIVED")
      .map((r: Record<string, unknown>): (string | number | null | undefined)[] => {
        const profile = r.profile as { full_name?: string; role?: string } | null
        const session = r.session as { type?: string } | null
        return [
          profile?.full_name ?? "",
          profile?.role ?? "",
          new Date(r.attended_at as string).toLocaleString("ar-EG"),
          session?.type === "CHURCH" ? "قداس" : "خدمة",
          r.points as number,
          r.source as string,
          r.status as string,
        ]
      }),
  )

  return { ok: true, csv, filename: "attendance-report.csv" }
}

// --- Scores report export ----------------------------------------------------

export async function exportScoresReportAction(
  range: unknown
): Promise<ExportActionResult> {
  const supabase = await requireAdmin()
  if (!supabase) return { ok: false, message: "غير مصرح" }

  let rangeValue: ReportRange
  try {
    rangeValue = validateRange(range)
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }

  const { from, to } = rangeValue
  const { data } = await supabase
    .from("score_records")
    .select(
      "category, points, profile:profiles!score_records_profile_id_fkey(full_name, role)"
    )
    .eq("is_voided", false)
    .gte("session_date", from)
    .lte("session_date", to)
    .limit(REPORT_EXPORT_LIMIT)

  const csv = toCsv(
    ["الاسم", "الدور", "الفئة", "النقاط"],
    (data ?? []).map((r: Record<string, unknown>): (string | number | null | undefined)[] => {
      const profile = r.profile as { full_name?: string; role?: string } | null
      return [
        profile?.full_name ?? "",
        profile?.role ?? "",
        r.category as string,
        r.points as number,
      ]
    }),
  )

  return { ok: true, csv, filename: "scores-report.csv" }
}

// --- Activities report export ------------------------------------------------

export async function exportActivitiesReportAction(
  range: unknown
): Promise<ExportActionResult> {
  const supabase = await requireAdmin()
  if (!supabase) return { ok: false, message: "غير مصرح" }

  let rangeValue: ReportRange
  try {
    rangeValue = validateRange(range)
  } catch (error) {
    return { ok: false, message: (error as Error).message }
  }

  const { from, to } = rangeValue
  const { data } = await supabase
    .from("servant_activity_records")
    .select(
      "recorded_on, activity:activities(code, name), profile:profiles!servant_activity_records_servant_id_fkey(full_name)"
    )
    .gte("recorded_on", from)
    .lte("recorded_on", to)
    .order("recorded_on", { ascending: false })
    .limit(REPORT_EXPORT_LIMIT)

  const csv = toCsv(
    ["الخادم", "النشاط", "كود النشاط", "التاريخ"],
    (data ?? []).map((r: Record<string, unknown>): (string | number | null | undefined)[] => {
      const profile = r.profile as { full_name?: string } | null
      const activity = r.activity as { code?: string; name?: string } | null
      return [
        profile?.full_name ?? "",
        activity?.name ?? activity?.code ?? "",
        activity?.code ?? "",
        r.recorded_on as string,
      ]
    }),
  )

  return { ok: true, csv, filename: "activities-report.csv" }
}

// --- Audit log export --------------------------------------------------------

export async function exportAuditLogAction(): Promise<ExportActionResult> {
  const supabase = await requireAdmin()
  if (!supabase) return { ok: false, message: "غير مصرح" }

  const { data } = await supabase
    .from("audit_logs")
    .select("action, entity, entity_id, created_at, metadata")
    .order("created_at", { ascending: false })
    .limit(AUDIT_EXPORT_LIMIT)

  const csv = toCsv(
    ["العملية", "الكيان", "معرف الكيان", "التاريخ", "بيانات إضافية"],
    (data ?? []).map((r) => [
      r.action,
      r.entity,
      r.entity_id ?? "",
      new Date(r.created_at).toLocaleString("ar-EG"),
      r.metadata ? JSON.stringify(r.metadata) : "",
    ]),
  )

  return { ok: true, csv, filename: "audit-log.csv" }
}
