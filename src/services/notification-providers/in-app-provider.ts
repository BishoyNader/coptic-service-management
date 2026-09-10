import type {
  NotificationProvider,
  DeliveryContext,
  DeliveryResult,
} from "./types"

/**
 * In-app notification provider.
 *
 * In-app delivery is handled by the existing notification_recipients row
 * created during fan-out. This provider exists for interface compliance
 * and always reports success (the row already exists).
 */
export class InAppProvider implements NotificationProvider {
  readonly channel = "IN_APP" as const
  readonly providerName = "IN_APP"

  isConfigured(): boolean {
    return true
  }

  async send(_context: DeliveryContext): Promise<DeliveryResult> {
    void _context
    return {
      channel: "IN_APP",
      status: "DELIVERED",
      provider: "IN_APP",
    }
  }
}
