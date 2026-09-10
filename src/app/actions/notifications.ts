"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminRole, type AppRole } from "@/lib/roles"
import {
  audienceRolesFor,
  createNotification,
  getUnreadCount,
  markNotificationRead,
  NOTIFICATION_MAX_BODY,
  NOTIFICATION_MAX_TITLE,
  resolveRecipientIds,
  type NotificationAudience,
} from "@/services/notification-service"
import type { DeliveryChannel } from "@/services/notification-delivery"
import { isUuid } from "@/lib/validation"

async function requireAdminActor(): Promise<{ adminId: string; role: AppRole } | null> {
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
  return { adminId: user.id, role: profile.role as AppRole }
}

type ChannelCounts = { sent: number; failed: number; notConfigured: number }

export type SendNotificationResult =
  | {
      ok: true
      message: string
      recipientCount: number
      deliverySummary?: {
        sms: ChannelCounts
        whatsapp: ChannelCounts
      }
    }
  | { ok: false; message: string }

export type SendNotificationInput = {
  title: string
  body: string
  audiences: NotificationAudience[]
  channels?: DeliveryChannel[]
}

/**
 * Admin / Super Admin: create a broadcast notification and fan out
 * recipients server-side. The audience is validated against the actor role.
 * External delivery channels (SMS/WhatsApp) are optional and only used if
 * the corresponding provider is configured.
 */
export async function sendNotificationAction(
  input: SendNotificationInput
): Promise<SendNotificationResult> {
  const actor = await requireAdminActor()
  if (!actor) return { ok: false, message: "غير مصرح" }

  if (!Array.isArray(input.audiences) || input.audiences.length === 0) {
    return { ok: false, message: "اختار جمهور واحد على الأقل" }
  }

  const title = String(input.title ?? "").replace(/\s+/g, " ").trim()
  const body = String(input.body ?? "").replace(/\s+/g, " ").trim()

  if (title.length === 0) return { ok: false, message: "مطلوب كتابة عنوان الإشعار" }
  if (body.length === 0) return { ok: false, message: "مطلوب كتابة نص الإشعار" }
  if (title.length > NOTIFICATION_MAX_TITLE) {
    return { ok: false, message: "العنوان أطول من المسموح به" }
  }
  if (body.length > NOTIFICATION_MAX_BODY) {
    return { ok: false, message: "الرسالة أطول من المسموح به" }
  }

  const allowed = audienceRolesFor(actor.role)
  if (input.audiences.some((a) => !allowed.includes(a))) {
    return { ok: false, message: "غير مسموح بإرسال إشعار لهذا الجمهور" }
  }

  const admin = createAdminClient()
  const res = await createNotification(admin, {
    actorId: actor.adminId,
    actorRole: actor.role as NotificationAudience,
    title,
    body,
    audiences: input.audiences,
  })

  if (!res.ok) return { ok: false, message: res.message }

  // Trigger external delivery if channels beyond IN_APP are configured.
  const requested = Array.isArray(input.channels) ? input.channels : []
  const externalChannels = requested.filter((c) => c !== "IN_APP")
  let deliverySummary:
    | { sms: ChannelCounts; whatsapp: ChannelCounts }
    | undefined

  if (externalChannels.length > 0 && res.recipientCount > 0) {
    const { getConfiguredChannelsSummary, deliverBatch } = await import(
      "@/services/notification-delivery"
    )

    const available = await getConfiguredChannelsSummary()
    const cleanChannels = externalChannels.filter((ch) =>
      available.some((c) => c.channel === ch && c.configured)
    )

    if (cleanChannels.length > 0) {
      const recipients = await resolveRecipientIds(admin, input.audiences)
      try {
        const batchResult = await deliverBatch(
          admin,
          recipients.map((r) => ({ profileId: r.id, phone: r.phone })),
          cleanChannels,
          { notificationId: res.notificationId, title, body }
        )
        deliverySummary = {
          sms: batchResult.channelResults.SMS,
          whatsapp: batchResult.channelResults.WHATSAPP,
        }
      } catch {
        // External delivery failure must not break in-app notification
      }
    }
  }

  return {
    ok: true,
    message: "تم إرسال الإشعار بنجاح ✓",
    recipientCount: res.recipientCount,
    deliverySummary,
  }
}

/** User: mark one of their own notifications as read. */
export async function markNotificationReadAction(
  recipientId: string
): Promise<{ ok: boolean; message: string }> {
  if (!isUuid(recipientId)) return { ok: false, message: "بيانات غير صحيحة" }
  const supabase = await createClient()
  return markNotificationRead(supabase, recipientId)
}

/** User: unread notification count for the current profile. */
export async function getUnreadCountAction(): Promise<{ count: number }> {
  const supabase = await createClient()
  return { count: await getUnreadCount(supabase) }
}

/** Server action: get configured delivery channels for the UI (admin only). */
export async function getDeliveryChannelsAction(): Promise<
  Array<{ channel: DeliveryChannel; configured: boolean; label: string }>
> {
  const actor = await requireAdminActor()
  if (!actor) return []
  const { getConfiguredChannelsSummary } = await import(
    "@/services/notification-delivery"
  )
  return getConfiguredChannelsSummary()
}