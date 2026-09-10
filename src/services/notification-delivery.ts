import type { SupabaseAdminClient } from "@/lib/supabase/admin"
import type { DeliveryChannel, DeliveryResult, DeliveryContext } from "./notification-providers/types"
import { getProvider } from "./notification-providers"

export type { DeliveryChannel }

/** Result of delivering to a single recipient across multiple channels. */
export type RecipientDeliveryResult = {
  recipientProfileId: string
  phone?: string
  results: DeliveryResult[]
}

/** Result of a batch delivery operation. */
export type BatchDeliveryResult = {
  totalRecipients: number
  channelResults: Record<DeliveryChannel, { sent: number; failed: number; notConfigured: number }>
  perRecipient: RecipientDeliveryResult[]
}

/**
 * Normalize a phone number to E.164 format for the given provider.
 * Returns null if the phone is empty/invalid.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const trimmed = phone.trim()
  if (!trimmed) return null

  // Already E.164
  if (/^\+\d{10,15}$/.test(trimmed)) return trimmed

  // Egyptian local format: 01XXXXXXXXX → +201XXXXXXXXX
  if (/^01\d{8,9}$/.test(trimmed)) {
    return `+20${trimmed.slice(1)}`
  }

  // Raw digits, assume Egyptian
  if (/^\d{10,11}$/.test(trimmed)) {
    if (trimmed.startsWith("0")) return `+20${trimmed.slice(1)}`
    return `+20${trimmed}`
  }

  return trimmed
}

/**
 * Deliver a notification to a single recipient via the specified channels.
 * Each channel is independent — a failure in one does not affect others.
 * The in-app delivery is always attempted first.
 */
export async function deliverToRecipient(
  admin: SupabaseAdminClient,
  context: Omit<DeliveryContext, "recipientPhone"> & { recipientPhone?: string | null },
  channels: DeliveryChannel[]
): Promise<RecipientDeliveryResult> {
  const results: DeliveryResult[] = []

  // Ensure IN_APP is always included
  const effectiveChannels: DeliveryChannel[] = ["IN_APP", ...channels.filter((c) => c !== "IN_APP")]

  for (const channel of effectiveChannels) {
    const provider = await getProvider(channel)
    const result = await provider.send({
      ...context,
      recipientPhone: context.recipientPhone ?? undefined,
    })
    results.push(result)

    // Record delivery attempt in the database (best-effort; never crash the flow)
    const { error } = await admin.from("notification_deliveries").insert({
      notification_id: context.notificationId,
      recipient_profile_id: context.recipientProfileId,
      channel,
      status: result.status,
      provider: result.provider ?? null,
      provider_message_id: result.providerMessageId ?? null,
      error_code: result.errorCode ?? null,
      error_message: result.errorMessage ?? null,
      delivered_at: result.status === "DELIVERED" ? new Date().toISOString() : null,
    })
    if (error) {
      results.push({
        channel,
        status: "FAILED",
        provider: "DATABASE",
        errorCode: error.code,
        errorMessage: `Failed to record delivery: ${error.message}`,
      })
    }
  }

  return {
    recipientProfileId: context.recipientProfileId,
    phone: context.recipientPhone ?? undefined,
    results,
  }
}

/**
 * Deliver a notification to multiple recipients across multiple channels.
 * Collects per-recipient results without stopping on failure.
 */
export async function deliverBatch(
  admin: SupabaseAdminClient,
  recipients: Array<{ profileId: string; phone?: string | null }>,
  channels: DeliveryChannel[],
  notificationContext: {
    notificationId: string
    title: string
    body: string
    metadata?: Record<string, unknown>
  }
): Promise<BatchDeliveryResult> {
  const channelResults: Record<DeliveryChannel, { sent: number; failed: number; notConfigured: number }> = {
    IN_APP: { sent: 0, failed: 0, notConfigured: 0 },
    SMS: { sent: 0, failed: 0, notConfigured: 0 },
    WHATSAPP: { sent: 0, failed: 0, notConfigured: 0 },
  }

  const perRecipient: RecipientDeliveryResult[] = []

  for (const recipient of recipients) {
    const context: Omit<DeliveryContext, "recipientPhone"> & { recipientPhone?: string | null } = {
      notificationId: notificationContext.notificationId,
      recipientProfileId: recipient.profileId,
      recipientPhone: recipient.phone ?? null,
      title: notificationContext.title,
      body: notificationContext.body,
      metadata: notificationContext.metadata,
    }

    const result = await deliverToRecipient(admin, context, channels)
    perRecipient.push(result)

    for (const r of result.results) {
      if (r.status === "SENT" || r.status === "DELIVERED") {
        channelResults[r.channel].sent++
      } else if (r.status === "PROVIDER_NOT_CONFIGURED") {
        channelResults[r.channel].notConfigured++
      } else {
        channelResults[r.channel].failed++
      }
    }
  }

  return {
    totalRecipients: recipients.length,
    channelResults,
    perRecipient,
  }
}

/**
 * Get a summary of configured channels for display in the UI.
 */
export async function getConfiguredChannelsSummary(): Promise<
  Array<{
    channel: DeliveryChannel
    configured: boolean
    label: string
  }>
> {
  const { getAvailableChannels } = await import("./notification-providers")
  const capabilities = await getAvailableChannels()
  const labels: Record<DeliveryChannel, string> = {
    IN_APP: "إشعار داخل التطبيق",
    SMS: "رسالة SMS",
    WHATSAPP: "رسالة WhatsApp",
  }
  return capabilities.map((c) => ({
    channel: c.channel,
    configured: c.configured,
    label: labels[c.channel],
  }))
}