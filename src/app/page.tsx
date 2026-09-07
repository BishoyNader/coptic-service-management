import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { roleHomePath } from "@/lib/roles"
import type { AppRole } from "@/lib/roles"

export default async function HomePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  redirect(roleHomePath((profile?.role ?? "SERVED_MEMBER") as AppRole))
}