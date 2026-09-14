"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  Archive,
  Check,
  ClipboardList,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
} from "lucide-react"
import { toast } from "sonner"
import type { Activity } from "@/lib/types"
import { ROLE_LABELS, type AppRole } from "@/lib/roles"
import {
  archiveActivityAction,
  createActivityAction,
  restoreActivityAction,
  updateActivityAction,
} from "@/app/actions/activities"
import { Button } from "@/components/ui/button"
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

const ACTIVITY_ROLES: readonly AppRole[] = ["SERVED_MEMBER", "SERVANT"]

type ActivityDraft = {
  name: string
  for_role: AppRole
  min_score: string
  max_score: string
}

function draftFromActivity(a: Activity): ActivityDraft {
  return {
    name: a.name,
    for_role: a.for_role,
    min_score: String(a.min_score),
    max_score: String(a.max_score),
  }
}

const EMPTY_DRAFT: ActivityDraft = {
  name: "",
  for_role: "SERVED_MEMBER",
  min_score: "0",
  max_score: "10",
}

/**
 * Super Admin — activity settings. Add / edit / archive (soft-delete) /
 * restore the activities the scoring board and servant panels use, with the
 * scoring range (min – max) for both roles (خادم / مخدوم). Every mutation is
 * super-admin-gated in the server action and audited.
 */
export function ActivitiesSettings({
  activities,
}: {
  activities: Activity[]
}) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ActivityDraft>(EMPTY_DRAFT)
  const [busy, setBusy] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<Activity | null>(null)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const openAdd = () => {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setDialogOpen(true)
  }

  const openEdit = (a: Activity) => {
    setEditingId(a.id)
    setDraft(draftFromActivity(a))
    setDialogOpen(true)
  }

  const submit = async () => {
    setBusy(true)
    const payload = {
      name: draft.name,
      for_role: draft.for_role,
      min_score: Number(draft.min_score),
      max_score: Number(draft.max_score),
      icon: null,
      sort_order: 0,
    }
    const res = editingId
      ? await updateActivityAction(editingId, payload)
      : await createActivityAction(payload)
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
    const res = await archiveActivityAction(archiveTarget.id)
    setArchiveBusy(false)
    if (!res.ok) {
      toast.error(res.message)
      return
    }
    toast.success(res.message)
    setArchiveTarget(null)
    router.refresh()
  }

  const restore = async (a: Activity) => {
    setRestoringId(a.id)
    const res = await restoreActivityAction(a.id)
    setRestoringId(null)
    if (!res.ok) {
      toast.error(res.message)
      return
    }
    toast.success(res.message)
    router.refresh()
  }

  const minNum = Number(draft.min_score)
  const maxNum = Number(draft.max_score)
  const invalidRange =
    !Number.isFinite(minNum) || !Number.isFinite(maxNum) || maxNum < minNum
  const nameEmpty = draft.name.trim() === ""

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="font-heading text-sm font-bold text-muted-foreground">
          الأنشطة والدرجات — يقرؤها لوح تقييم الخدام وشاشة درجات المخدوم
        </p>
        <Button
          onClick={openAdd}
          className="ms-auto gap-1.5"
          size="sm"
          data-testid="add-activity"
        >
          <Plus className="size-4" />
          إضافة نشاط
        </Button>
      </div>

      {activities.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="size-7" />}
          title="لا توجد أنشطة"
          description="أضف نشاطًا ليظهر في شاشة التقييم والدرجات"
        />
      ) : (
        <div className="space-y-2">
          {activities.map((a) => {
            const archived = !a.is_active
            return (
              <div
                key={a.id}
                data-testid={`activity-row-${a.id}`}
                className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
                    {ROLE_LABELS[a.for_role]}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {a.name}
                  </p>
                  <span className="font-heading text-sm font-extrabold text-coptic-gold">
                    {Number(a.min_score)}–{Number(a.max_score)}
                  </span>
                  <span
                    className={`size-2 rounded-full ${archived ? "bg-muted" : "bg-coptic-teal"}`}
                  />
                  {archived ? (
                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-bold text-destructive">
                      محذوف
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    درجات النشاط من {Number(a.min_score)} لـ {Number(a.max_score)}{" "}
                    — يسجّلها {a.for_role === "SERVED_MEMBER" ? "الخادم" : "الخادم لنفسه"}
                  </p>
                  <div className="flex gap-1.5">
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => openEdit(a)}
                      data-testid={`edit-activity-${a.id}`}
                      className="gap-1"
                    >
                      <Pencil className="size-3" />
                      تعديل
                    </Button>
                    {archived ? (
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => restore(a)}
                        disabled={restoringId === a.id}
                        data-testid={`restore-activity-${a.id}`}
                        className="gap-1"
                      >
                        {restoringId === a.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <RotateCcw className="size-3" />
                        )}
                        {restoringId === a.id ? "جاري الاسترجاع..." : "استرجاع"}
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setArchiveTarget(a)}
                        data-testid={`archive-activity-${a.id}`}
                        className="gap-1 text-destructive"
                      >
                        <Archive className="size-3" />
                        حذف
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
            <DialogTitle>{editingId ? "تعديل نشاط" : "إضافة نشاط"}</DialogTitle>
            <DialogDescription>
              النشاط يظهر فورًا في شاشة التقييم بمجرد الحفظ
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Field id="activity-form-name" label="اسم النشاط">
              <input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="مثال: حفظ المزامير"
                data-testid="activity-form-name"
                className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
              />
            </Field>

            <Field id="activity-form-role" label="يُطبَّق على">
              <select
                value={draft.for_role}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    for_role: e.target.value as AppRole,
                  }))
                }
                data-testid="activity-form-role"
                className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                {ACTIVITY_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field id="activity-form-min" label="أقل درجة">
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={draft.min_score}
                  onChange={(e) => setDraft((d) => ({ ...d, min_score: e.target.value }))}
                  data-testid="activity-form-min"
                  className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
                />
              </Field>
              <Field id="activity-form-max" label="أعلى درجة">
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={draft.max_score}
                  onChange={(e) => setDraft((d) => ({ ...d, max_score: e.target.value }))}
                  data-testid="activity-form-max"
                  className="w-full rounded-xl border border-input bg-transparent px-3 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
                />
              </Field>
            </div>

            {invalidRange ? (
              <p className="text-xs text-destructive">
                أعلى درجة لازم تكون أكبر من أو تساوي أقل درجة
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              onClick={submit}
              disabled={busy || nameEmpty || invalidRange}
              className="gap-1.5"
              data-testid="activity-form-submit"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {editingId ? "حفظ التعديلات" : "إضافة النشاط"}
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
            <AlertDialogTitle>حذف النشاط؟</AlertDialogTitle>
            <AlertDialogDescription>
              بعد الحذف لن يظهر نشاط «{archiveTarget?.name}» في شاشات التقييم والدرجات،
              ويمكنك استرجاعه في أي وقت.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={confirmArchive}
              disabled={archiveBusy}
              data-testid="archive-activity-confirm"
            >
              {archiveBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Archive className="size-4" />
              )}
              تأكيد الحذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Field({
  id,
  label,
  children,
}: {
  id?: string
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  )
}