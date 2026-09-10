/** Notification delivery channels. */
export type DeliveryChannel = "IN_APP" | "SMS" | "WHATSAPP"

/** Delivery status tracking. */
export type DeliveryStatus =
  | "QUEUED"
  | "SENT"
  | "DELIVERED"
  | "FAILED"
  | "PROVIDER_NOT_CONFIGURED"

/** Result of a single delivery attempt. */
export type DeliveryResult = {
  channel: DeliveryChannel
  status: DeliveryStatus
  provider?: string
  providerMessageId?: string
  errorCode?: string
  errorMessage?: string
}

/** Context for a delivery attempt. */
export type DeliveryContext = {
  notificationId: string
  recipientProfileId: string
  recipientPhone?: string
  title: string
  body: string
  metadata?: Record<string, unknown>
}

/** Provider capability check. */
export type ProviderCapability = {
  channel: DeliveryChannel
  configured: boolean
  providerName: string
}

/** Abstract contract for a notification provider. */
export interface NotificationProvider {
  readonly channel: DeliveryChannel
  readonly providerName: string

  /** Whether this provider has valid credentials configured. */
  isConfigured(): boolean

  /** Send a notification via this channel. Must never throw. */
  send(context: DeliveryContext): Promise<DeliveryResult>
}

/** All available delivery channels. */
export const ALL_CHANNELS: DeliveryChannel[] = ["IN_APP", "SMS", "WHATSAPP"]

/** Human-readable Arabic labels for channels. */
export const CHANNEL_LABELS: Record<DeliveryChannel, string> = {
  IN_APP: "إشعار داخل التطبيق",
  SMS: "رسالة SMS",
  WHATSAPP: "رسالة WhatsApp",
}

/** Human-readable Arabic labels for delivery statuses. */
export const STATUS_LABELS: Record<DeliveryStatus, string> = {
  QUEUED: "قيد الانتظار",
  SENT: "تم الإرسال",
  DELIVERED: "تم التوصيل",
  FAILED: "فشل الإرسال",
  PROVIDER_NOT_CONFIGURED: "الخدمة غير مُعدة",
}
