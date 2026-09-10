import type { SupabaseAdminClient } from "@/lib/supabase/admin"
import type { SupabaseServerClient } from "@/lib/supabase/server"
import type { AppRole } from "@/lib/roles"
import { logAudit } from "@/services/auth-service"

/** Roles that can be targeted as a notification audience. */
export type NotificationAudience = Exclude<AppRole, "SUPER_ADMIN">

export const NOTIFICATION_MAX_TITLE = 120
export const NOTIFICATION_MAX_BODY = 1000
/** Chunk size for recipient inserts (fan-out for hundreds/thousands of users). */
export const RECIPIENT_BATCH_SIZE = 500

/**
 * Which audiences an actor role is allowed to target.
 * Admins may reach members and servants only; Super Admin may also reach
 * admins. This is enforced server-side — the client never decides targeting.
 */
const ALLOWED_AUDIENCES: Record<AppRole, readonly NotificationAudience[]> = {
  SERVED_MEMBER: [],
  SERVANT: [],
  ADMIN: ["SERVED_MEMBER", "SERVANT"],
  SUPER_ADMIN: ["SERVED_MEMBER", "SERVANT", "ADMIN"],
}

export function audienceRolesFor(actorRole: AppRole): readonly NotificationAudience[] {
  return ALLOWED_AUDIENCES[actorRole] ?? []
}

export function isAudienceAllowed(
  actorRole: AppRole,
  audience: NotificationAudience
): boolean {
  return ALLOWED_AUDIENCES[actorRole]?.includes(audience) ?? false
}

export type UserNotification = {
  recipientId: string
  title: string
  body: string | null
  createdAt: string
  readAt: string | null
}

export type CreateNotificationInput = {
  actorId: string
  actorRole: AppRole
  title: string
  body: string
  audiences: NotificationAudience[]
}

export type CreateNotificationResult =
  | { ok: true; notificationId: string; recipientCount: number }
  | { ok: false; message: string }

/** Resolved recipient info returned alongside notification creation. */
export type ResolvedRecipient = { id: string; phone: string | null }

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

/**
 * Server-side recipient resolution. Only profile ids and phones are returned.
 */
export async function resolveRecipientIds(
  admin: SupabaseAdminClient,
  audiences: NotificationAudience[]
): Promise<ResolvedRecipient[]> {
  if (audiences.length === 0) return []
  const { data } = await admin
    .from("profiles")
    .select("id, phone")
    .in("role", audiences as string[])
    .eq("status", "ACTIVE")
    .order("id", { ascending: true })
  return (data ?? []).map((p) => ({ id: p.id as string, phone: (p.phone as string) ?? null }))
}

async function insertRecipients(
  admin: SupabaseAdminClient,
  notificationId: string,
  profileIds: string[]
): Promise<void> {
  for (let i = 0; i < profileIds.length; i += RECIPIENT_BATCH_SIZE) {
    const chunk = profileIds.slice(i, i + RECIPIENT_BATCH_SIZE)
    const rows = chunk.map((profileId) => ({ notification_id: notificationId, profile_id: profileId }))
    const { error } = await admin.from("notification_recipients").insert(rows)
    if (error) throw new Error(`failed to fan out recipients: ${error.message}`)
  }
}

/**
 * Creates a broadcast notification and fans out recipient rows.
 * The actor must be an admin; audiences are validated against the actor role.
 * External delivery is NOT triggered here — the caller handles that
 * (action layer or automation service) to avoid pulling Twilio into
 * client bundles.
 */
export async function createNotification(
  admin: SupabaseAdminClient,
  input: CreateNotificationInput
): Promise<CreateNotificationResult> {
  const title = cleanText(input.title)
  const body = cleanText(input.body)

  if (input.audiences.length === 0) {
    return { ok: false, message: "اختار جمهور واحد على الأقل" }
  }
  if (title.length === 0) {
    return { ok: false, message: "مطلوب كتابة عنوان الإشعار" }
  }
  if (body.length === 0) {
    return { ok: false, message: "مطلوب كتابة نص الإشعار" }
  }
  if (title.length > NOTIFICATION_MAX_TITLE) {
    return { ok: false, message: "العنوان أطول من المسموح به" }
  }
  if (body.length > NOTIFICATION_MAX_BODY) {
    return { ok: false, message: "الرسالة أطول من المسموح به" }
  }
  if (input.audiences.some((a) => !isAudienceAllowed(input.actorRole, a))) {
    return { ok: false, message: "غير مسموح بإرسال إشعار لهذا الجمهور" }
  }

  const recipients = await resolveRecipientIds(admin, input.audiences)
  const recipientIds = recipients.map((r) => r.id)

  const { data: inserted, error } = await admin
    .from("notifications")
    .insert({
      title,
      body,
      audience: input.audiences,
      sender_id: input.actorId,
    })
    .select("id")
    .single()
  if (error) throw new Error(`create notification: ${error.message}`)
  const notificationId = inserted.id as string

  if (recipientIds.length > 0) {
    await insertRecipients(admin, notificationId, recipientIds)
  }

  await logAudit(admin, {
    actorId: input.actorId,
    action: "NOTIFICATION_CREATED",
    entity: "NOTIFICATION",
    entityId: notificationId,
    metadata: { audiences: input.audiences, recipientCount: recipientIds.length },
  })

  return { ok: true, notificationId, recipientCount: recipientIds.length }
}

/**
 * Fetch the current user's inbox. RLS guarantees only rows where this user
 * is a recipient are returned, joined with the notification content.
 */
export async function getUserNotifications(
  supabase: SupabaseServerClient
): Promise<UserNotification[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await supabase
    .from("notification_recipients")
    .select("id, read_at, created_at, notification:notifications(title, body, created_at)")
    .eq("profile_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50)

  return ((data ?? []) as unknown as Array<{
    id: string
    read_at: string | null
    created_at: string
    notification: {
      title: string
      body: string | null
      created_at: string
    } | null
  }>).map((r) => ({
    recipientId: r.id,
    title: r.notification?.title ?? "",
    body: r.notification?.body ?? null,
    createdAt: r.notification?.created_at ?? r.created_at,
    readAt: r.read_at,
  }))
}

/** Number of UNREAD notifications targeted at the current user. */
export async function getUnreadCount(supabase: SupabaseServerClient): Promise<number> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return 0

  const { count } = await supabase
    .from("notification_recipients")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", user.id)
    .is("read_at", null)
  return count ?? 0
}

/**
 * Marks the current user's recipient row as read. Ownership is enforced both
 * by the action (passes the authenticated user id) and by RLS.
 */
export async function markNotificationRead(
  supabase: SupabaseServerClient,
  recipientId: string
): Promise<{ ok: boolean; message: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: "غير مصرح" }
  if (!recipientId) return { ok: false, message: "بيانات غير صحيحة" }

  const { error } = await supabase
    .from("notification_recipients")
    .update({ read_at: new Date().toISOString() })
    .eq("id", recipientId)
    .eq("profile_id", user.id)

  if (error) return { ok: false, message: "حدث خطأ أثناء التحديث" }
  return { ok: true, message: "تم" }
}
