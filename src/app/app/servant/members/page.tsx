import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { ServantMemberDobList } from "@/components/app/servant-member-dob-list"

export const metadata: Metadata = { title: "المخدومين" }

export default async function ServantMembersPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVANT) redirect("/")

  // Servant-scoped RLS lets a servant read ACTIVE SERVED_MEMBER rows. Only
  // name + date of birth are selected — no phone, QR token or address.
  const { data: members } = await supabase
    .from("profiles")
    .select("id, full_name, date_of_birth")
    .eq("role", ROLES.SERVED_MEMBER)
    .eq("status", "ACTIVE")
    .order("full_name", { ascending: true })
    .limit(1000)

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-xl font-extrabold">المخدومين</h1>
      <p className="text-sm text-muted-foreground">
        سجّل أو حدّث تاريخ ميلاد المخدومين المسموح لك بإدارة بياناتهم
      </p>
      <ServantMemberDobList members={(members ?? []) as { id: string; full_name: string; date_of_birth: string | null }[]} />
    </div>
  )
}