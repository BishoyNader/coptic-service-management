"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Archive, Check, Loader2, Pencil, Plus, RotateCcw, Settings } from "lucide-react"
import { toast } from "sonner"
import type { ScoringRule } from "@/lib/types"
import type { ScoringCategory } from "@/lib/constants"
import { SCORING_CATEGORY_LABELS } from "@/lib/constants"
import { ROLE_LABELS, PUBLIC_REGISTRATION_ROLES, type AppRole } from "@/lib/roles"
import {
  archiveScoringRuleAction,
  createScoringRuleAction,
  restoreScoringRuleAction,
  updateScoringRuleAction,
} from "@/app/actions/settings"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { EmptyState } from "@/components/coptic/empty-state"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type RuleDraft = {
  category: ScoringCategory
  name: string
  point_value: string
  roles: AppRole[]
  start_time: string
  end_time: string
  requires_min_days: string
}

const EMPTY_DRAFT: RuleDraft = {
  category: "WEEKLY_COMMITMENT",
  name: "",
  point_value: "",
  roles: ["SERVED_MEMBER"],
  start_time: "",
  end_time: "",
  requires_min_days: "",
}

function draftFromRule(rule: ScoringRule): RuleDraft {
  return {
    category: rule.category,
    name: rule.name,
    point_value: String(rule.point_value),
    roles: [...rule.applicable_role],
    start_time: rule.start_time ?? "",
    end_time: rule.end_time ?? "",
    requires_min_days: rule.requires_min_days ? String(rule.requires_min_days) : "",
  }
}

/**
 * Super Admin — scoring rules settings. Add / edit / archive (soft-delete) /
 * restore the point configuration the scoring engine reads. Every mutation is
 * super-admin-gated in the server action and audited.
 */
export function ScoringRulesSettings({ rules }: { rules: ScoringRule[] }) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<RuleDraft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<ScoringRule | null>(null)
  const [archiveBusy, setArchiveBusy] = useState(false)

  const openAdd = () => {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setDialogOpen(true)
  }

  const openEdit = (rule: ScoringRule) => {
    setEditingId(rule.id)
    setDraft(draftFromRule(rule))
    setDialogOpen(true)
  }

  const toggleRole = (role: AppRole) => {
    setDraft((d) =>
      d.roles.includes(role)
        ? { ...d, roles: d.roles.filter((r) => r !== role) }
        : { ...d, roles: [...d.roles, role] }
    )
  }

  const submit = async () => {
    setBusy(true)
    const payload = {
      category: draft.category,
      name: draft.name,
      point_value: Number(draft.point_value),
      applicable_role: draft.roles,
      start_time: draft.start_time || null,
      end_time: draft.end_time || null,
      requires_min_days: draft.requires_min_days ? Number(draft.requires_min_days) : null,
    }
    const res = editingId
      ? await updateScoringRuleAction(editingId, payload)
      : await createScoringRuleAction(payload)
    setBusy(false)
    if (!res.ok) {
      toast.error(res.message)
      return
    }
    toast.success(res.message)
    setDialogOpen(false)
    router.refresh()
  }

  const confirmArchive = async () => {
    if (!archiveTarget) return
    setArchiveBusy(true)
    const res = await archiveScoringRuleAction(archiveTarget.id)
    setArchiveBusy(false)
    if (!res.ok) {
      toast.error(res.message)
      setArchiveBusy(false)
      return
    }
    toast.success(res.message)
    setArchiveTarget(null)
    router.refresh()
  }

  const restore = async (rule: ScoringRule) => {
    const res = await restoreScoringRuleAction(rule.id)
    if (!res.ok) {
      toast.error(res.message)
      return
    }
    toast.success(res.message)
    router.refresh()
  }

  return (
    <div className="space-y-4" data-testid="rule-settings-list">
      <div className="flex items-center gap-2">
        <p className="font-heading text-sm font-bold text-muted-foreground">
          قواعد الدرجات — يقرأها محرك التقدير مباشرة
        </p>
        <Button onClick={openAdd} className="ms-auto gap-1.5" size="sm" data-testid="add-rule">
          <Plus className="size-4" />
          إضافة قاعدة
        </Button>
      </div>

      {rules.length === 0 ? (
        <EmptyState
          icon={<Settings className="size-7" />}
          title="لا توجد قواعد"
          description="أضف قاعدة درجات ليبدأ محرك التقدير في الاعتماد عليها"
        />
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => {
            const archived = !rule.is_active
            return (
              <div
                key={rule.id}
                data-testid={`rule-row-${rule.id}`}
                className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
                    {SCORING_CATEGORY_LABELS[rule.category]}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold">{rule.name}</p>
                  <span className="font-heading text-sm font-extrabold text-coptic-gold">
                    +{rule.point_value}
                  </span>
                  <span
                    className={`size-2 rounded-full ${archived ? "bg-muted" : "bg-coptic-teal"}`}
                  />
                  {archived ? (
                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-bold text-destructive">
                      مؤرشفة
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    {rule.applicable_role.map((r) => ROLE_LABELS[r]).join("، ")}
                    {rule.start_time || rule.end_time
                      ? ` • ${rule.start_time ?? "…"} – ${rule.end_time ?? "…"}`
                      : ""}
                    {rule.requires_min_days ? ` • يتطلب ${rule.requires_min_days} يوم` : ""}
                  </p>
                  <div className="flex gap-1.5">
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => openEdit(rule)}
                      data-testid={`edit-rule-${rule.id}`}
                      className="gap-1"
                    >
                      <Pencil className="size-3" />
                      تعديل
                    </Button>
                    {archived ? (
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => restore(rule)}
                        data-testid={`restore-rule-${rule.id}`}
                        className="gap-1"
                      >
                        <RotateCcw className="size-3" />
                        استرجاع
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setArchiveTarget(rule)}
                        data-testid={`archive-rule-${rule.id}`}
                        className="gap-1 text-destructive"
                      >
                        <Archive className="size-3" />
                        أرشفة
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add / edit form */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "تعديل قاعدة" : "إضافة قاعدة درجات"}</DialogTitle>
            <DialogDescription>
              القاعدة تنطبق فورًا على تسجيل الدرجات الجديد
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3" data-testid="rule-form">
            <Field label="الفئة">
              <select
                value={draft.category}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, category: e.target.value as ScoringCategory }))
                }
                data-testid="rule-form-category"
                className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                {(Object.keys(SCORING_CATEGORY_LABELS) as ScoringCategory[]).map((cat) => (
                  <option key={cat} value={cat}>
                    {SCORING_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="الاسم">
              <input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="مثال: حضور القداس — من 8 لـ 8:30"
                data-testid="rule-form-name"
                className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
              />
            </Field>

            <Field label="قيمة النقاط">
              <input
                type="number"
                min={0}
                step="0.5"
                value={draft.point_value}
                onChange={(e) => setDraft((d) => ({ ...d, point_value: e.target.value }))}
                data-testid="rule-form-points"
                className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
              />
            </Field>

            <div className="space-y-1.5">
              <span className="text-sm font-medium">مطبقة على</span>
              <div className="flex gap-4">
                {PUBLIC_REGISTRATION_ROLES.map((role) => (
                  <label
                    key={role}
                    className="flex items-center gap-2 text-sm"
                    data-testid={`rule-form-roles-${role}`}
                  >
                    <Checkbox
                      checked={draft.roles.includes(role)}
                      onCheckedChange={() => toggleRole(role)}
                      aria-label={ROLE_LABELS[role]}
                    />
                    {ROLE_LABELS[role]}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="من (توقيت)">
                <input
                  type="time"
                  value={draft.start_time}
                  onChange={(e) => setDraft((d) => ({ ...d, start_time: e.target.value }))}
                  data-testid="rule-form-start"
                  className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
                />
              </Field>
              <Field label="إلى (توقيت)">
                <input
                  type="time"
                  value={draft.end_time}
                  onChange={(e) => setDraft((d) => ({ ...d, end_time: e.target.value }))}
                  data-testid="rule-form-end"
                  className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
                />
              </Field>
            </div>

            <Field label="يتطلب على الأقل (أيام)">
              <input
                type="number"
                min={1}
                value={draft.requires_min_days}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, requires_min_days: e.target.value }))
                }
                data-testid="rule-form-min-days"
                className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
              />
            </Field>
          </div>

          <DialogFooter>
            <Button
              onClick={submit}
              disabled={busy}
              className="gap-1.5"
              data-testid="rule-form-submit"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {editingId ? "حفظ التعديلات" : "إضافة القاعدة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive confirmation */}
      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>أرشفة القاعدة؟</AlertDialogTitle>
            <AlertDialogDescription>
              بعد الأرشفة لن يستخدم محرك التقدير قاعدة «{archiveTarget?.name}» في تسجيل درجات
              جديدة، ويمكنك استرجاعها في أي وقت.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmArchive}
              disabled={archiveBusy}
              data-testid="archive-confirm"
            >
              {archiveBusy ? <Loader2 className="size-4 animate-spin" /> : <Archive className="size-4" />}
              تأكيد الأرشفة
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  )
}
