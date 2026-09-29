"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ROLES } from "@/lib/roles"

export type ChurchSettings = {
  name: string
  tagline: string
  description: string
  phone: string | null
  email: string | null
  address: string | null
  service_times: ServiceTime[] | null
}

export type ServiceTime = {
  day: string
  time: string
  note: string
}

/** Any authenticated user can read public church info. */
export async function getChurchSettingsAction(): Promise<{
  ok: boolean
  settings: ChurchSettings | null
  message: string
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, settings: null, message: "غير مصرح" }

  const { data } = await supabase
    .from("church_settings")
    .select("*")
    .eq("id", "default")
    .maybeSingle()

  if (!data) {
    return {
      ok: true,
      settings: {
        name: "خدمتي",
        tagline: "كنيسة السيدة العذراء - وادي حوف",
        description: "",
        phone: null,
        email: null,
        address: null,
        service_times: null,
      },
      message: "",
    }
  }

  return {
    ok: true,
    settings: {
      name: data.name ?? "خدمتي",
      tagline: data.tagline ?? "كنيسة السيدة العذراء - وادي حوف",
      description: data.description ?? "",
      phone: data.phone ?? null,
      email: data.email ?? null,
      address: data.address ?? null,
      service_times: data.service_times ?? null,
    },
    message: "",
  }
}

/** Super Admin only: updates church info. All writes go through the service-role client. */
export async function updateChurchSettingsAction(settings: {
  name: string
  tagline: string
  description: string
  phone: string
  email: string
  address: string
  service_times?: ServiceTime[]
}): Promise<{ ok: boolean; message: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: "غير مصرح" }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile || profile.role !== ROLES.SUPER_ADMIN) {
    return { ok: false, message: "مسموح لمسؤولين أعلى فقط" }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from("church_settings")
    .upsert({
      id: "default",
      name: settings.name,
      tagline: settings.tagline,
      description: settings.description,
      phone: settings.phone || null,
      email: settings.email || null,
      address: settings.address || null,
      service_times: settings.service_times ?? null,
      updated_at: new Date().toISOString(),
    })

  if (error) return { ok: false, message: "تعذر حفظ الإعدادات" }
  return { ok: true, message: "تم حفظ إعدادات الكنيسة بنجاح ✓" }
}
