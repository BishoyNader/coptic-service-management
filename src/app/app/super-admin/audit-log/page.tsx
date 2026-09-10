import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { History } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { getProfile } from "@/services/profile-service"
import { ROLES } from "@/lib/roles"
import { LIST_PAGE_SIZE } from "@/lib/pagination"
import { EmptyState } from "@/components/coptic/empty-state"
import { PaginationControls } from "@/components/app/pagination-controls"
import { ExportButton } from "@/components/app/export-button"
import { exportAuditLogAction } from "@/app/actions/exports"

export const metadata: Metadata = { title: "سجل العمليات" }

export default async function SuperAdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const supabase = await createClient()
  const profile = await getProfile(supabase)
  if (!profile || profile.role !== ROLES.SUPER_ADMIN) redirect("/")

  const sp = await searchParams
  const rawPage = Number.parseInt(sp.page ?? "", 10) || 1
  const page = Math.max(1, rawPage)
  const from = (page - 1) * LIST_PAGE_SIZE
  const to = from + LIST_PAGE_SIZE - 1

  const { data: logs, count } = await supabase
    .from("audit_logs")
    .select("id, action, entity, entity_id, actor_id, created_at, metadata", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to)

  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl font-extrabold">سجل العمليات</h1>
          {total > 0 && (
            <p className="text-sm text-muted-foreground">{total} عملية مسجلة</p>
          )}
        </div>
        {total > 0 && (
          <ExportButton action={exportAuditLogAction} label="تصدير CSV" />
        )}
      </div>

      {!logs || logs.length === 0 ? (
        <EmptyState
          icon={<History className="size-7" />}
          title="لا توجد عمليات مسجلة"
          description="كل التغييرات المهمة هتتسجل هنا تلقائيًا"
        />
      ) : (
        <>
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

          <PaginationControls
            pathname="/app/super-admin/audit-log"
            page={page}
            totalPages={totalPages}
            total={total}
          />
        </>
      )}
    </div>
  )
}