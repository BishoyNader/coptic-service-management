import type { SupabaseAdminClient } from "@/lib/supabase/admin"
import { generatePersonalCode, generateQrToken } from "@/lib/roles"

type InsertAuditParams = {
  actorId?: string | null
  action: string
  entity: string
  entityId?: string | null
  previous?: Record<string, unknown> | null
  next?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
}

/** Guard-friendly audit logging used by server-side services. */
export async function logAudit(
  admin: SupabaseAdminClient,
  params: InsertAuditParams
) {
  const { actorId, action, entity, entityId, previous, next, metadata } = params
  await admin.from("audit_logs").insert({
    actor_id: actorId ?? null,
    action,
    entity,
    entity_id: entityId ?? null,
    previous: previous ?? null,
    new: next ?? null,
    metadata: metadata ?? null,
  })
}

type UniqueCodes = { code: string; qrToken: string }

/**
 * Generates a unique personal code + QR token pair.
 * Retries on the rare collision with existing codes.
 */
export async function generateUniqueCodes(
  admin: SupabaseAdminClient
): Promise<UniqueCodes> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generatePersonalCode()
    const qrToken = generateQrToken()

    const { data: existing } = await admin
      .from("personal_codes")
      .select("id")
      .or(`code.eq.${code},qr_token.eq.${qrToken}`)
      .maybeSingle()

    if (!existing) {
      return { code, qrToken }
    }
  }
  throw new Error("تعذر إنشاء كود مميز، حاول مرة أخرى")
}

export { generatePersonalCode, generateQrToken }