import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { navForRole } from "@/lib/constants"
import { ROLE_LABELS, ROLES } from "@/lib/roles"
import { AppShell } from "@/components/layout/app-shell"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const profile = await getProfile(supabase)

  if (!profile) {
    redirect("/login")
  }

  return (
    <AppShell
      roleLabel={ROLE_LABELS[profile.role]}
      name={profile.full_name}
      nav={navForRole(profile.role)}
      showUnreadBadge={
        profile.role === ROLES.SERVED_MEMBER || profile.role === ROLES.SERVANT
      }
    >
      {children}
    </AppShell>
  )
}