"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isAdminRole, type AppRole } from "@/lib/roles"
import {
  sendBirthdayGreeting,
  type SendBirthdayGreetingResult,
} from "@/services/birthday-service"

/**
 * Admin / Super Admin: send a single-recipient birthday greeting to one
 * ACTIVE served member. The actor and target are both derived server-side —
 * the client only supplies the target profile id and the editable message.
 */
export async function sendBirthdayGreetingAction(input: {
  profileId: string
  title: string
  body: string
}): Promise<SendBirthdayGreetingResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: "غير مصرح", alreadySent: false }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile || !isAdminRole(profile.role)) {
    return { ok: false, message: "غير مصرح", alreadySent: false }
  }

  if (!input?.profileId) {
    return { ok: false, message: "بيانات غير صحيحة", alreadySent: false }
  }

  const admin = createAdminClient()
  return sendBirthdayGreeting(admin, {
    actorId: user.id,
    actorRole: profile.role as AppRole,
    targetProfileId: input.profileId,
    title: String(input.title ?? ""),
    body: String(input.body ?? ""),
  })
}