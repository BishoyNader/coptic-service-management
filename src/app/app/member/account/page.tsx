import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES, ROLE_LABELS } from "@/lib/roles"
import { ProfileForm } from "@/components/app/profile-form"
import { updateProfileAction } from "@/app/actions/profile"

export const metadata: Metadata = { title: "حسابي" }

export default async function MemberAccountPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SERVED_MEMBER) redirect("/")

  const { data: codes } = await supabase
    .from("personal_codes")
    .select("code")
    .eq("profile_id", profile.id)
    .maybeSingle()

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-4 font-heading text-xl font-extrabold">حسابي</h1>
      <ProfileForm
        profile={profile}
        role="member"
        personalCode={codes?.code}
        onSubmit={updateProfileAction}
      />
      <p className="mt-4 text-center text-xs text-muted-foreground">
        نوع الحساب: {ROLE_LABELS[profile.role]}
      </p>
    </div>
  )
}
