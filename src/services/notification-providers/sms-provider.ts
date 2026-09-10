import twilio from "twilio"
import type {
  NotificationProvider,
  DeliveryContext,
  DeliveryResult,
} from "./types"

/**
 * SMS delivery provider via Twilio.
 *
 * Configuration via environment variables:
 *   TWILIO_ACCOUNT_SID       – Twilio account SID
 *   TWILIO_AUTH_TOKEN        – Twilio auth token
 *   TWILIO_SMS_FROM          – Twilio phone number (E.164, e.g. +1234567890)
 *
 * When any required variable is missing, isConfigured() returns false
 * and send() returns PROVIDER_NOT_CONFIGURED without making any API call.
 */
export class SmsProvider implements NotificationProvider {
  readonly channel = "SMS" as const
  readonly providerName = "TWILIO_SMS"

  private client: twilio.Twilio | null = null
  private fromNumber: string | null = null
  private _configured = false

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN
    this.fromNumber = process.env.TWILIO_SMS_FROM ?? null

    if (accountSid && authToken && this.fromNumber) {
      this.client = twilio(accountSid, authToken)
      this._configured = true
    }
  }

  isConfigured(): boolean {
    return this._configured
  }

  private normalizePhone(phone: string): string {
    const trimmed = phone.trim()
    if (/^\d{10,15}$/.test(trimmed)) {
      if (trimmed.startsWith("0")) return trimmed.replace(/^0/, "+20")
      return `+${trimmed}`
    }
    if (/^\+\d{10,15}$/.test(trimmed)) return trimmed
    return trimmed
  }

  async send(context: DeliveryContext): Promise<DeliveryResult> {
    if (!this._configured || !this.client || !this.fromNumber) {
      return {
        channel: "SMS",
        status: "PROVIDER_NOT_CONFIGURED",
        provider: this.providerName,
        errorMessage: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_SMS_FROM not configured",
      }
    }

    if (!context.recipientPhone) {
      return {
        channel: "SMS",
        status: "FAILED",
        provider: this.providerName,
        errorCode: "NO_PHONE",
        errorMessage: "Recipient has no phone number",
      }
    }

    const to = this.normalizePhone(context.recipientPhone)

    try {
      const message = await this.client.messages.create({
        body: `${context.title}\n\n${context.body}`,
        from: this.fromNumber,
        to,
      })

      return {
        channel: "SMS",
        status: "SENT",
        provider: this.providerName,
        providerMessageId: message.sid,
      }
    } catch (err: unknown) {
      const twilioErr = err as { code?: string | number; message?: string }
      return {
        channel: "SMS",
        status: "FAILED",
        provider: this.providerName,
        errorCode: String(twilioErr.code ?? "UNKNOWN"),
        errorMessage: twilioErr.message ?? "Unknown Twilio error",
      }
    }
  }
}
