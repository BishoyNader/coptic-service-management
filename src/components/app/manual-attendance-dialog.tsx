"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, UserPlus, Loader2, Check, Star } from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"
import { ATTENDANCE_TYPE_LABELS } from "@/lib/constants"
import { ROLE_LABELS, type AppRole } from "@/lib/roles"
import { formatCairoTime } from "@/lib/cairo"
import type { AttendanceType } from "@/lib/types"
import { manualAttendanceAction } from "@/app/actions/attendance"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

export type ManualAttendancePerson = {
  id: string
  fullName: string
  role: AppRole
  phone: string
}

type ManualAttendanceDialogProps = {
  people: ManualAttendancePerson[]
  defaultType?: AttendanceType
}

/**
 * "+ تسجيل حضور يدوي" — pick a person, pick the attendance type. The server
 * still decides the current time and the scoring window; admins cannot backdate.
 */
export function ManualAttendanceDialog({
  people,
  defaultType = "CHURCH",
}: ManualAttendanceDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<ManualAttendancePerson | null>(null)
  const [type, setType] = useState<AttendanceType>(defaultType)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ name: string; time: string } | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return people
    return people.filter(
      (p) =>
        p.fullName.toLowerCase().includes(q) ||
        p.phone.replace(/\D/g, "").includes(q.replace(/\D/g, ""))
    )
  }, [people, query])

  const confirm = async () => {
    if (!selected) return
    setBusy(true)
    const res = await manualAttendanceAction(selected.id, type)
    setBusy(false)
    if (res.status === "success") {
      setDone({ name: selected.fullName, time: formatCairoTime(res.attendedAt!) })
      router.refresh()
    } else if (res.status === "duplicate") {
      toast.info(`تم تسجيل حضور ${selected.fullName} بالفعل`)
      router.refresh()
    } else {
      toast.error(res.message ?? "تعذر تسجيل الحضور")
    }
  }

  const reset = () => {
    setOpen(false)
    setQuery("")
    setSelected(null)
    setDone(null)
    setBusy(false)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : reset())}>
      <DialogTrigger render={<Button variant="outline" className="gap-1.5" />}>
        <UserPlus className="size-4" />
        تسجيل حضور يدوي
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تسجيل حضور يدوي</DialogTitle>
          <DialogDescription>اختر الشخص ثم نوع الحضور</DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-coptic-teal/10 text-coptic-teal">
              <Check className="size-8" strokeWidth={3} />
            </div>
            <p className="font-heading text-lg font-extrabold">تم تسجيل حضور {done.name}</p>
            <p className="text-sm text-muted-foreground">وقت التسجيل: {done.time}</p>
            <Button
              className="mt-2"
              onClick={() => {
                setDone(null)
                setSelected(null)
                setQuery("")
              }}
            >
              تسجيل شخص آخر
            </Button>
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="relative">
              <Search className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ابحث بالاسم أو الموبايل…"
                className="w-full rounded-xl border border-input bg-transparent px-4 py-2.5 pr-9 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
              />
            </div>

            {/* Attendance type */}
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary/60 p-1">
              {(Object.keys(ATTENDANCE_TYPE_LABELS) as AttendanceType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn(
                    "rounded-lg py-2 text-sm font-medium transition-colors",
                    type === t
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {ATTENDANCE_TYPE_LABELS[t]}
                </button>
              ))}
            </div>

            {/* People list */}
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  مفيش نتايج مطابقة
                </p>
              ) : (
                filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelected(p)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-start transition-colors",
                      selected?.id === p.id
                        ? "bg-coptic-teal/10 ring-1 ring-coptic-teal/30"
                        : "hover:bg-secondary/60"
                    )}
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-coptic-gold-soft font-heading font-bold text-coptic-gold">
                      {p.fullName.trim().charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.fullName}</p>
                      <p className="text-[11px] text-muted-foreground" dir="ltr">
                        {p.phone}
                      </p>
                    </div>
                    <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-bold text-muted-foreground">
                      {ROLE_LABELS[p.role]}
                    </span>
                    {selected?.id === p.id ? (
                      <Check className="size-4 text-coptic-teal" />
                    ) : null}
                  </button>
                ))
              )}
            </div>

            {selected ? (
              <div className="flex items-center gap-3 rounded-xl bg-coptic-teal/10 px-3 py-2.5 ring-1 ring-coptic-teal/30">
                <div className="flex size-10 items-center justify-center rounded-xl bg-coptic-teal text-primary-foreground">
                  <Star className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{selected.fullName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {ROLE_LABELS[selected.role]} — {ATTENDANCE_TYPE_LABELS[type]}
                  </p>
                </div>
              </div>
            ) : null}
          </>
        )}

        <DialogFooter>
          {!done ? (
            <Button disabled={!selected || busy} onClick={confirm} className="gap-1.5">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              تأكيد التسجيل
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}