import twilio from "twilio"
import type {
  NotificationProvider,
  DeliveryContext,
  DeliveryResult,
} from "./types"

/**
 * WhatsApp delivery provider via Twilio.
 *
 * Configuration via environment variables:
 *   TWILIO_ACCOUNT_SID         – Twilio account SID
 *   TWILIO_AUTH_TOKEN          – Twilio auth token
 *   TWILIO_WHATSAPP_FROM       – WhatsApp sender (e.g. "whatsapp:+14155238886")
 *
 * When any required variable is missing, isConfigured() returns false
 * and send() returns PROVIDER_NOT_CONFIGURED without making any API call.
 *
 * Note: WhatsApp production messaging requires approved templates for
 * certain conversation types. This provider uses the standard Twilio
 * WhatsApp API. If the account is not WhatsApp-enabled, Twilio will
 * return an error which is captured as FAILED.
 */
export class WhatsAppProvider implements NotificationProvider {
  readonly channel = "WHATSAPP" as const
  readonly providerName = "TWILIO_WHATSAPP"

  private client: twilio.Twilio | null = null
  private fromNumber: string | null = null
  private _configured = false

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN
    this.fromNumber = process.env.TWILIO_WHATSAPP_FROM ?? null

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
      return `whatsapp:+${trimmed}`
    }
    if (/^\+\d{10,15}$/.test(trimmed)) return `whatsapp:${trimmed}`
    if (trimmed.startsWith("whatsapp:")) return trimmed
    return `whatsapp:+${trimmed}`
  }

  async send(context: DeliveryContext): Promise<DeliveryResult> {
    if (!this._configured || !this.client || !this.fromNumber) {
      return {
        channel: "WHATSAPP",
        status: "PROVIDER_NOT_CONFIGURED",
        provider: this.providerName,
        errorMessage:
          "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM not configured",
      }
    }

    if (!context.recipientPhone) {
      return {
        channel: "WHATSAPP",
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
        channel: "WHATSAPP",
        status: "SENT",
        provider: this.providerName,
        providerMessageId: message.sid,
      }
    } catch (err: unknown) {
      const twilioErr = err as { code?: string | number; message?: string }
      return {
        channel: "WHATSAPP",
        status: "FAILED",
        provider: this.providerName,
        errorCode: String(twilioErr.code ?? "UNKNOWN"),
        errorMessage: twilioErr.message ?? "Unknown Twilio error",
      }
    }
  }
}
