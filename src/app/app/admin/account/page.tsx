import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES, ROLE_LABELS } from "@/lib/roles"
import { ProfileForm } from "@/components/app/profile-form"
import { PasswordChangeCard } from "@/components/app/password-change-card"
import { updateProfileAction } from "@/app/actions/profile"

export const metadata: Metadata = { title: "حسابي" }

export default async function AdminAccountPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.ADMIN) redirect("/")

  return (
    <div className="mx-auto max-w-md space-y-5">
      <h1 className="font-heading text-xl font-extrabold">حسابي</h1>
      <ProfileForm profile={profile} role="admin" onSubmit={updateProfileAction} />
      <PasswordChangeCard />
      <p className="text-center text-xs text-muted-foreground">
        نوع الحساب: {ROLE_LABELS[profile.role]} — صلاحية مسؤول الخدمة
      </p>
    </div>
  )
}