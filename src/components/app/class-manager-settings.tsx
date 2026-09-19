"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { ClassRecord } from "@/services/classes-service"
import {
  createClassAction,
  updateClassAction,
  deleteClassAction,
} from "@/app/actions/settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

type ClassDraft = { name: string; sort_order: string }
const EMPTY_DRAFT: ClassDraft = { name: "", sort_order: "0" }

/**
 * Super Admin — class management. Add / edit / delete predefined class names
 * that are used to group served members.
 */
export function ClassManagerSettings({ classes }: { classes: ClassRecord[] }) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ClassDraft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const openCreate = () => {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setDialogOpen(true)
  }

  const openEdit = (cls: ClassRecord) => {
    setEditingId(cls.id)
    setDraft({ name: cls.name, sort_order: String(cls.sort_order) })
    setDialogOpen(true)
  }

  const save = async () => {
    setSaving(true)
    const payload = {
      name: draft.name,
      sort_order: Number(draft.sort_order) || 0,
    }
    const res = editingId
      ? await updateClassAction(editingId, payload)
      : await createClassAction(payload)
    setSaving(false)
    if (res.ok) {
      toast.success(res.message)
      setDialogOpen(false)
      router.refresh()
    } else {
      toast.error(res.message)
    }
  }

  const confirmDelete = async () => {
    if (!deleteId) return
    setDeleting(true)
    const res = await deleteClassAction(deleteId)
    setDeleting(false)
    setDeleteId(null)
    if (res.ok) {
      toast.success(res.message)
      router.refresh()
    } else {
      toast.error(res.message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          الأصناف المتاحة لتصنيف المخدومين
        </p>
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <Plus className="size-4" />
          إضافة صنف
        </Button>
      </div>

      {classes.length === 0 ? (
        <EmptyState
          icon={<Plus className="size-6" />}
          title="مفيش أصناف بعد"
          description="أضف أصناف لتصنيف المخدومين"
        />
      ) : (
        <div className="space-y-1.5">
          {classes.map((cls) => (
            <div
              key={cls.id}
              className="flex items-center gap-3 rounded-xl bg-secondary/40 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{cls.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  ترتيب: {cls.sort_order}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => openEdit(cls)}
                aria-label={`تعديل ${cls.name}`}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDeleteId(cls.id)}
                aria-label={`حذف ${cls.name}`}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "تعديل الصنف" : "إضافة صنف جديد"}</DialogTitle>
            <DialogDescription>
              {editingId ? "حدّث اسم الصنف أو ترتيبه" : "أدخل اسم الصنف الجديد"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cls-name">اسم الصنف</Label>
              <Input
                id="cls-name"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="مثال: الصف الأول"
                className="h-11 text-base"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cls-order">الترتيب</Label>
              <Input
                id="cls-order"
                type="number"
                min={0}
                value={draft.sort_order}
                onChange={(e) => setDraft((d) => ({ ...d, sort_order: e.target.value }))}
                className="h-11 text-base"
              />
            </div>
          </div>

          <DialogFooter>
            <Button disabled={!draft.name.trim() || saving} onClick={save} className="gap-1.5">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {editingId ? "حفظ التعديلات" : "إضافة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الصنف</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف هذا الصنف؟ المخدومون المرتبون به سيبقون لكن بدون صنف.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
