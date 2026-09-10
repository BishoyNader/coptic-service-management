import type { NotificationProvider, DeliveryChannel, ProviderCapability } from "./types"
import { InAppProvider } from "./in-app-provider"

/**
 * Lazy provider instances. The InAppProvider is stateless and safe to
 * instantiate eagerly. The Twilio-based providers (SMS/WhatsApp) are
 * loaded lazily so the twilio SDK (which pulls Node built-ins) is only
 * resolved in server bundles.
 */
let inAppInstance: InAppProvider | null = null
let smsInstance: NotificationProvider | null = null
let whatsappInstance: NotificationProvider | null = null

function getInApp(): InAppProvider {
  if (!inAppInstance) inAppInstance = new InAppProvider()
  return inAppInstance
}

async function getSms(): Promise<NotificationProvider> {
  if (!smsInstance) {
    const { SmsProvider } = await import("./sms-provider")
    smsInstance = new SmsProvider()
  }
  return smsInstance
}

async function getWhatsApp(): Promise<NotificationProvider> {
  if (!whatsappInstance) {
    const { WhatsAppProvider } = await import("./whatsapp-provider")
    whatsappInstance = new WhatsAppProvider()
  }
  return whatsappInstance
}

/** Get a provider for the given channel. */
export function getProvider(channel: DeliveryChannel): Promise<NotificationProvider> {
  switch (channel) {
    case "IN_APP":
      return Promise.resolve(getInApp())
    case "SMS":
      return getSms()
    case "WHATSAPP":
      return getWhatsApp()
  }
}

/** Check which channels are actually configured and available. */
export async function getAvailableChannels(): Promise<ProviderCapability[]> {
  const sms = await getSms()
  const whatsapp = await getWhatsApp()
  return [
    { channel: "IN_APP", configured: getInApp().isConfigured(), providerName: "IN_APP" },
    { channel: "SMS", configured: sms.isConfigured(), providerName: "TWILIO_SMS" },
    { channel: "WHATSAPP", configured: whatsapp.isConfigured(), providerName: "TWILIO_WHATSAPP" },
  ]
}

/**
 * Reset singletons (for testing only).
 * In production, providers are long-lived for connection pooling.
 */
export function resetProviders(): void {
  inAppInstance = null
  smsInstance = null
  whatsappInstance = null
}