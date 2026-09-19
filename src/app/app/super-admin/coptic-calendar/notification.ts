"use server"

/**
 * Coptic feast notifications — Super Admin only.
 *
 * Fetches upcoming feast days (today + tomorrow + next few days) from the
 * Coptic Calendar API and sends a broadcast notification for each feast day
 * that does not already have a notification in the current Cairo calendar day.
 *
 * IDEMPOTENCY:
 * The notification title encodes both the feast name AND the feast date:
 *   "عيد قبطي [feast-date]: Feast Name"
 * A notification with that exact title is looked up in the database; if one
 * already exists, the feast is skipped. This means calling this action
 * multiple times on the same day will not create duplicates.
 *
 * SECURITY:
 * This runs as a server action; the caller's session is verified to be
 * SUPER_ADMIN before any write occurs. The actual notification create uses the
 * service-role admin client (as required by createNotification).
 */

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createNotification } from "@/services/notification-service"
import { getUpcomingFeasts } from "@/services/coptic-calendar-service"
import { ROLES } from "@/lib/roles"
import { cairoDateString, cairoDayStart, cairoDayEnd } from "@/lib/cairo"

/** Deterministic notification title for a given feast and its Gregorian date. */
function feastNotificationTitle(feastDate: string, feastName: string): string {
  return `🕊️ عيد قبطي ${feastDate}: ${feastName}`
}

/** Arabic label for how far away a feast day is from today. */
function relativeLabel(feastDate: string, today: string): string {
  const [fy, fm, fd] = feastDate.split("-").map(Number)
  const [ty, tm, td] = today.split("-").map(Number)
  const diffMs =
    Date.UTC(fy, fm - 1, fd) - Date.UTC(ty, tm - 1, td)
  const diffDays = Math.round(diffMs / 86_400_000)
  if (diffDays === 0) return "اليوم"
  if (diffDays === 1) return "غدًا"
  if (diffDays === 2) return "بعد يومين"
  return `بعد ${diffDays} أيام`
}

export type FeastNotificationResult = {
  ok: boolean
  message: string
  created: string[]
  skipped: string[]
}

/**
 * Sends broadcast notifications for upcoming Coptic feasts (within 3 days).
 * Idempotent — safe to call multiple times; already-sent feasts are skipped.
 * Requires the calling user to be SUPER_ADMIN.
 */
export async function notifyUpcomingFeasts(): Promise<FeastNotificationResult> {
  // 1. Verify the caller is SUPER_ADMIN.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, message: "غير مصرح", created: [], skipped: [] }
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile || profile.role !== ROLES.SUPER_ADMIN) {
    return { ok: false, message: "غير مصرح — يلزم دور المسؤول العام", created: [], skipped: [] }
  }

  const actorId = user.id

  // 2. Fetch upcoming feasts (3 days: today, tomorrow, day after).
  const feastsResult = await getUpcomingFeasts(3)
  if (!feastsResult.ok) {
    return { ok: false, message: feastsResult.message, created: [], skipped: [] }
  }

  const today = cairoDateString(new Date())

  // Collect only feast/lordlyFeast celebrations (not fasts) with days info.
  type PendingFeast = {
    feastDate: string
    name: string
    title: string
    body: string
  }
  const pending: PendingFeast[] = []

  for (const day of feastsResult.days) {
    const feasts = day.celebrations.filter(
      (c) => c.type === "feast" || c.type === "lordlyFeast"
    )
    for (const feast of feasts) {
      const title = feastNotificationTitle(day.date, feast.name)
      const label = relativeLabel(day.date, today)
      const body = `${label} عيد قبطي: ${feast.name} (${day.copticDate.monthString} ${day.copticDate.day}، ${day.copticDate.year})`
      pending.push({ feastDate: day.date, name: feast.name, title, body })
    }
  }

  if (pending.length === 0) {
    return {
      ok: false,
      message: "لا توجد أعياد قبطية في الأيام القليلة القادمة",
      created: [],
      skipped: [],
    }
  }

  // 3. Check which notifications already exist today to implement idempotency.
  // We check by exact title within the current Cairo day window.
  const admin = createAdminClient()
  const dayStart = cairoDayStart(new Date()).toISOString()
  const dayEnd = cairoDayEnd(new Date()).toISOString()

  const { data: existingRows } = await admin
    .from("notifications")
    .select("title")
    .in(
      "title",
      pending.map((p) => p.title)
    )
    .gte("created_at", dayStart)
    .lt("created_at", dayEnd)

  const alreadySentTitles = new Set(
    (existingRows ?? []).map((r) => r.title as string)
  )

  const created: string[] = []
  const skipped: string[] = []

  for (const feast of pending) {
    if (alreadySentTitles.has(feast.title)) {
      skipped.push(feast.name)
      continue
    }

    const result = await createNotification(admin, {
      actorId,
      actorRole: ROLES.SUPER_ADMIN,
      title: feast.title,
      body: feast.body,
      // Broadcast to everyone in the application.
      audiences: ["SERVED_MEMBER", "SERVANT"],
    })

    if (result.ok) {
      created.push(feast.name)
    } else {
      // Non-fatal: log and continue with remaining feasts.
      skipped.push(`${feast.name} (خطأ: ${result.message})`)
    }
  }

  if (created.length === 0 && skipped.length > 0) {
    return {
      ok: false,
      message: "لا جديد — إشعارات الأعياد موجودة مسبقًا",
      created,
      skipped,
    }
  }

  return {
    ok: true,
    message: `تم إنشاء ${created.length} إشعار(ات) للأعياد القبطية القادمة`,
    created,
    skipped,
  }
}
