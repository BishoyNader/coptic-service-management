import type { Metadata } from "next"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Users, Phone, ChevronLeft } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { EmptyState } from "@/components/coptic/empty-state"
import { AddMemberButton } from "@/components/app/add-member-button"

export const metadata: Metadata = { title: "المخدومين" }

export default async function AdminMembersPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.ADMIN) redirect("/")

  const { data: members } = await supabase
    .from("profiles")
    .select("id, full_name, phone, status")
    .eq("role", "SERVED_MEMBER")
    .order("full_name", { ascending: true })
    .limit(100)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-heading text-xl font-extrabold">المخدومين</h1>
        <AddMemberButton />
      </div>

      {!members || members.length === 0 ? (
        <EmptyState
          icon={<Users className="size-7" />}
          title="لا يوجد مخدومين حتى الآن"
          description="لما تسجّل أو تضيف أول مخدوم، هيظهر هنا"
          action={<AddMemberButton />}
        />
      ) : (
        <div className="space-y-2">
          {members.map((m) => (
            <Link
              key={m.id}
              href={`/app/admin/members/${m.id}`}
              className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5 transition-colors hover:bg-secondary/50"
            >
              <div className="flex size-11 items-center justify-center rounded-full bg-coptic-gold-soft font-heading font-bold text-coptic-gold">
                {m.full_name.trim().charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{m.full_name}</p>
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground" dir="ltr">
                  <Phone className="size-3" />
                  {m.phone}
                </p>
              </div>
              <ChevronLeft className="size-5 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}