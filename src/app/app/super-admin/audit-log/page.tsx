import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { History } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { EmptyState } from "@/components/coptic/empty-state"

export const metadata: Metadata = { title: "سجل العمليات" }

export default async function SuperAdminAuditPage() {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const { data: logs } = await supabase
    .from("audit_logs")
    .select("id, action, entity, entity_id, actor_id, created_at, metadata")
    .order("created_at", { ascending: false })
    .limit(100)

  return (
    <div className="space-y-4">
      <h1 className="font-heading text-xl font-extrabold">سجل العمليات</h1>

      {!logs || logs.length === 0 ? (
        <EmptyState
          icon={<History className="size-7" />}
          title="لا توجد عمليات مسجلة"
          description="كل التغييرات المهمة هتتسجل هنا تلقائيًا"
        />
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div
              key={log.id}
              className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold" dir="ltr">
                  {log.action}
                </p>
                <span className="text-[11px] text-muted-foreground">
                  {new Date(log.created_at).toLocaleString("ar-EG")}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                {log.entity}
                {log.entity_id ? ` / ${log.entity_id}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}