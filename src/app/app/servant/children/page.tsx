import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { ServantChildRecords } from "@/components/app/servant-child-records"

export const metadata: Metadata = { title: "سجلات الأولاد" }

export default async function ServantChildrenPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVANT) redirect("/")

  const { data: members } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("role", ROLES.SERVED_MEMBER)
    .eq("status", "ACTIVE")
    .order("full_name", { ascending: true })
    .limit(1000)

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-xl font-extrabold">سجلات الأولاد</h1>
      <p className="text-sm text-muted-foreground">
        سجّل حضور المخدومين ودرجاتهم باليوم الذي تريده وعدّلها في أي وقت
      </p>
      <ServantChildRecords
        members={(members ?? []) as { id: string; full_name: string }[]}
        currentUserId={profile.id}
        minDate="2020-01-01"
      />
    </div>
  )
}