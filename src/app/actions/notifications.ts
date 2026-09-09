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
  type NotificationAudience,
} from "@/services/notification-service"

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

export type SendNotificationResult =
  | { ok: true; message: string; recipientCount: number }
  | { ok: false; message: string }

export type SendNotificationInput = {
  title: string
  body: string
  audiences: NotificationAudience[]
}

/**
 * Admin / Super Admin: create a broadcast notification and fan out
 * recipients server-side. The audience is validated against the actor role.
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
  return {
    ok: true,
    message: "تم إرسال الإشعار بنجاح ✓",
    recipientCount: res.recipientCount,
  }
}

/** User: mark one of their own notifications as read. */
export async function markNotificationReadAction(
  recipientId: string
): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient()
  return markNotificationRead(supabase, recipientId)
}

/** User: unread notification count for the current profile. */
export async function getUnreadCountAction(): Promise<{ count: number }> {
  const supabase = await createClient()
  return { count: await getUnreadCount(supabase) }
}