import type { SupabaseAdminClient } from "@/lib/supabase/admin"
import { cairoDateString } from "@/lib/cairo"
import { logAudit } from "@/services/auth-service"
import {
  BIRTHDAY_GREETING_TITLE,
  BIRTHDAY_ENTITY,
  birthdayGreetingBody,
} from "@/services/birthday-service"
import { deliverBatch } from "@/services/notification-delivery"
import type { DeliveryChannel } from "@/services/notification-delivery"

export type BirthdayAutomationResult = {
  date: string
  totalEligible: number
  remindersCreated: number
  notificationsCreated: number
  skippedAlreadySent: number
  externalDeliveries: { sms: number; whatsapp: number }
  errors: string[]
}

/**
 * Run the daily birthday automation job.
 *
 * This function is idempotent: running it multiple times on the same day
 * will not duplicate reminders (the birthday_reminders unique constraint
 * prevents it, and the function checks before inserting).
 *
 * @param admin - Service-role Supabase client
 * @param targetDate - Optional override date (YYYY-MM-DD) for testing
 * @param externalChannels - Which external channels to deliver via
 * @param senderId - The actor ID to attribute the notifications to
 */
export async function runBirthdayAutomation(
  admin: SupabaseAdminClient,
  options: {
    targetDate?: string
    externalChannels?: DeliveryChannel[]
    senderId?: string
  } = {}
): Promise<BirthdayAutomationResult> {
  const targetDate = options.targetDate ?? cairoDateString(new Date())
  const externalChannels = options.externalChannels ?? []
  const senderId = options.senderId ?? null

  const result: BirthdayAutomationResult = {
    date: targetDate,
    totalEligible: 0,
    remindersCreated: 0,
    notificationsCreated: 0,
    skippedAlreadySent: 0,
    externalDeliveries: { sms: 0, whatsapp: 0 },
    errors: [],
  }

  // Use the SQL function to find eligible birthdays
  const { data: birthdays, error: queryError } = await admin.rpc("birthdays_for_today", {
    target_date: targetDate,
  })

  if (queryError) {
    result.errors.push(`Query failed: ${queryError.message}`)
    return result
  }

  const eligible = birthdays ?? []
  result.totalEligible = eligible.length

  if (eligible.length === 0) return result

  // Check which birthdays already have reminders for this date
  const profileIds = eligible.map((b: { profile_id: string }) => b.profile_id)
  const { data: existingReminders } = await admin
    .from("birthday_reminders")
    .select("profile_id")
    .eq("reminder_for", targetDate)
    .in("profile_id", profileIds)

  const alreadySent = new Set(
    (existingReminders ?? []).map((r) => r.profile_id as string)
  )
  result.skippedAlreadySent = alreadySent.size

  // Process each eligible birthday
  for (const birthday of eligible) {
    const pid = birthday.profile_id as string
    const name = birthday.full_name as string
    const phone = birthday.phone as string | null

    // Skip if already sent
    if (alreadySent.has(pid)) continue

    try {
      // Create the notification
      const { data: notification, error: notifError } = await admin
        .from("notifications")
        .insert({
          title: BIRTHDAY_GREETING_TITLE,
          body: birthdayGreetingBody(name),
          audience: ["SERVED_MEMBER"],
          sender_id: senderId,
        })
        .select("id")
        .single()

      if (notifError) {
        result.errors.push(`Notification create failed for ${name}: ${notifError.message}`)
        continue
      }

      const notificationId = notification.id as string

      // Create the recipient
      const { error: recipientError } = await admin
        .from("notification_recipients")
        .insert({ notification_id: notificationId, profile_id: pid })

      if (recipientError) {
        // Rollback notification
        await admin.from("notifications").delete().eq("id", notificationId)
        result.errors.push(`Recipient create failed for ${name}: ${recipientError.message}`)
        continue
      }

      // Create the birthday reminder (deduplication)
      const { error: reminderError } = await admin
        .from("birthday_reminders")
        .insert({ profile_id: pid, reminder_for: targetDate })

      if (reminderError) {
        // Rollback notification + recipient
        await admin.from("notifications").delete().eq("id", notificationId)
        if (String(reminderError.code) === "23505") {
          // Unique violation — already sent (race condition)
          result.skippedAlreadySent++
          continue
        }
        result.errors.push(`Reminder create failed for ${name}: ${reminderError.message}`)
        continue
      }

      result.notificationsCreated++

      // Trigger external delivery if channels are configured
      if (externalChannels.length > 0 && phone) {
        try {
          const batchResult = await deliverBatch(
            admin,
            [{ profileId: pid, phone }],
            externalChannels,
            {
              notificationId,
              title: BIRTHDAY_GREETING_TITLE,
              body: birthdayGreetingBody(name),
            }
          )
          result.externalDeliveries.sms += batchResult.channelResults.SMS.sent
          result.externalDeliveries.whatsapp += batchResult.channelResults.WHATSAPP.sent
        } catch {
          // External delivery failure must not block the birthday automation
        }
      }

      // Audit log
      await logAudit(admin, {
        actorId: senderId,
        action: "BIRTHDAY_NOTIFICATION_SENT",
        entity: BIRTHDAY_ENTITY,
        metadata: {
          memberId: pid,
          memberName: name,
          reminderFor: targetDate,
          notificationId,
          automated: true,
        },
      })

      result.remindersCreated++
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push(`Unexpected error for ${name}: ${msg}`)
    }
  }

  return result
}
