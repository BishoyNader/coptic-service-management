import type { SupabaseAdminClient } from "@/lib/supabase/admin"
import type { SupabaseServerClient } from "@/lib/supabase/server"
import { isAdminRole, ROLES, type AppRole } from "@/lib/roles"
import { cairoDateString } from "@/lib/cairo"
import { daysBetweenDates, nextBirthdayDateString } from "@/lib/dates"
import {
  NOTIFICATION_MAX_BODY,
  NOTIFICATION_MAX_TITLE,
} from "@/services/notification-service"
import { logAudit } from "@/services/auth-service"

export const BIRTHDAY_WINDOW_DAYS = 30
export const BIRTHDAY_ENTITY = "BIRTHDAY_REMINDER"
export const BIRTHDAY_ACTION = "BIRTHDAY_NOTIFICATION_SENT"
export const BIRTHDAY_GREETING_TITLE = "🎂 عيد ميلاد سعيد!"

export function birthdayGreetingBody(name: string): string {
  return `كل سنة وإنت طيب يا ${name} ❤️`
}

export type UpcomingBirthday = {
  id: string
  name: string
  dateOfBirth: string
  nextDate: string
  days: number
  alreadySent: boolean
}

export type SendBirthdayGreetingInput = {
  actorId: string
  actorRole: AppRole
  targetProfileId: string
  title: string
  body: string
}

export type SendBirthdayGreetingResult =
  | {
      ok: true
      message: string
      alreadySent: false
      reminderId: string
      notificationId: string
    }
  | { ok: false; message: string; alreadySent: boolean }

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

/**
 * Upcoming ACTIVE served-member birthdays within the 30-day window.
 * Computed entirely on the server (month/day comparison in the Cairo
 * calendar, leap-year aware); the client only ever receives the rows.
 */
export async function getUpcomingBirthdays(
  supabase: SupabaseServerClient
): Promise<UpcomingBirthday[]> {
  const today = cairoDateString(new Date())

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, date_of_birth")
    .eq("role", ROLES.SERVED_MEMBER)
    .eq("status", "ACTIVE")
    .not("date_of_birth", "is", null)
    .limit(1000)

  const rows = (profiles ?? [])
    .filter((p) => p.date_of_birth)
    .map((p) => {
      const nextDate = nextBirthdayDateString(p.date_of_birth as string, today)
      const days = daysBetweenDates(today, nextDate)
      return {
        id: p.id as string,
        name: p.full_name as string,
        dateOfBirth: p.date_of_birth as string,
        nextDate,
        days,
      }
    })
    .filter((r) => r.days >= 0 && r.days <= BIRTHDAY_WINDOW_DAYS)
    .sort((a, b) => a.days - b.days)

  const memberIds = rows.map((r) => r.id)
  const { data: reminders } = memberIds.length
    ? await supabase.from("birthday_reminders").select("profile_id, reminder_for")
    : { data: [] }
  const sentKeys = new Set(
    (reminders ?? []).map((r) => `${r.profile_id as string}|${r.reminder_for as string}`)
  )

  return rows.map((r) => ({
    ...r,
    alreadySent: sentKeys.has(`${r.id}|${r.nextDate}`),
  }))
}

/**
 * Sends a single-recipient birthday greeting notification to one ACTIVE
 * served member and records a birthday_reminders row so the same birthday
 * occurrence can never be greeted twice. Both writes always happen together:
 * if the reminder insert fails, the notification is rolled back.
 */
export async function sendBirthdayGreeting(
  admin: SupabaseAdminClient,
  input: SendBirthdayGreetingInput
): Promise<SendBirthdayGreetingResult> {
  if (!isAdminRole(input.actorRole)) {
    return { ok: false, message: "غير مصرح", alreadySent: false }
  }

  const { data: target, error: targetError } = await admin
    .from("profiles")
    .select("id, full_name, role, status, date_of_birth")
    .eq("id", input.targetProfileId)
    .maybeSingle()
  if (targetError || !target) {
    return { ok: false, message: "المخدوم غير موجود", alreadySent: false }
  }
  if (target.role !== ROLES.SERVED_MEMBER) {
    return { ok: false, message: "التهنئة متاحة للمخدومين فقط", alreadySent: false }
  }
  if (target.status !== "ACTIVE") {
    return { ok: false, message: "الحساب غير نشط", alreadySent: false }
  }
  if (!target.date_of_birth) {
    return { ok: false, message: "لا يوجد تاريخ ميلاد مسجل", alreadySent: false }
  }

  const title = cleanText(input.title)
  const body = cleanText(input.body)
  if (title.length === 0) {
    return { ok: false, message: "مطلوب كتابة عنوان التهنئة", alreadySent: false }
  }
  if (body.length === 0) {
    return { ok: false, message: "مطلوب كتابة نص التهنئة", alreadySent: false }
  }
  if (title.length > NOTIFICATION_MAX_TITLE) {
    return { ok: false, message: "العنوان أطول من المسموح به", alreadySent: false }
  }
  if (body.length > NOTIFICATION_MAX_BODY) {
    return { ok: false, message: "الرسالة أطول من المسموح به", alreadySent: false }
  }

  const today = cairoDateString(new Date())
  const reminderFor = nextBirthdayDateString(target.date_of_birth, today)
  const days = daysBetweenDates(today, reminderFor)
  if (days < 0 || days > BIRTHDAY_WINDOW_DAYS) {
    return { ok: false, message: "عيد الميلاد مش في فترة التهنئة", alreadySent: false }
  }

  const { data: existing } = await admin
    .from("birthday_reminders")
    .select("id")
    .eq("profile_id", target.id)
    .eq("reminder_for", reminderFor)
    .maybeSingle()
  if (existing) {
    return { ok: false, message: "تم إرسال تهنئة عيد الميلاد بالفعل.", alreadySent: true }
  }

  const { data: notification, error: notificationError } = await admin
    .from("notifications")
    .insert({
      title,
      body,
      audience: [ROLES.SERVED_MEMBER],
      sender_id: input.actorId,
    })
    .select("id")
    .single()
  if (notificationError) throw new Error(`create notification: ${notificationError.message}`)
  const notificationId = notification.id as string

  const { error: recipientError } = await admin
    .from("notification_recipients")
    .insert({ notification_id: notificationId, profile_id: target.id })
  if (recipientError) {
    await admin.from("notifications").delete().eq("id", notificationId)
    throw new Error(`create recipient: ${recipientError.message}`)
  }

  const { data: reminder, error: reminderError } = await admin
    .from("birthday_reminders")
    .insert({ profile_id: target.id, reminder_for: reminderFor })
    .select("id")
    .single()
  if (reminderError) {
    await admin.from("notifications").delete().eq("id", notificationId)
    if (String(reminderError.code) === "23505") {
      return { ok: false, message: "تم إرسال تهنئة عيد الميلاد بالفعل.", alreadySent: true }
    }
    throw new Error(`create birthday reminder: ${reminderError.message}`)
  }
  const reminderId = reminder.id as string

  await logAudit(admin, {
    actorId: input.actorId,
    action: BIRTHDAY_ACTION,
    entity: BIRTHDAY_ENTITY,
    entityId: reminderId,
    metadata: {
      memberId: target.id,
      memberName: target.full_name,
      reminderFor,
      notificationId,
    },
  })

  return {
    ok: true,
    message: "تم إرسال تهنئة عيد الميلاد بنجاح ✓",
    alreadySent: false,
    reminderId,
    notificationId,
  }
}