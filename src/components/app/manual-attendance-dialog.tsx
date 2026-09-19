"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, UserPlus, Loader2, Check, Star, Clock, Users } from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"
import { ATTENDANCE_TYPE_LABELS } from "@/lib/constants"
import { ROLE_LABELS, type AppRole } from "@/lib/roles"
import { formatCairoTime } from "@/lib/cairo"
import type { AttendanceType, ScoringRule } from "@/lib/types"
import { CATEGORY_BY_ATTENDANCE } from "@/services/attendance-rules"
import { recordManualAttendanceAction } from "@/app/actions/attendance"
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
  className?: string | null
}

type Tab = "MEMBERS" | "SERVANTS"

type ManualAttendanceDialogProps = {
  people: ManualAttendancePerson[]
  attendanceRules: ScoringRule[]
  selectedFriday: string
  defaultType?: AttendanceType
}

/**
 * "+ تسجيل حضور يدوي" — two tabs: served members (grouped by class) and
 * servants. Pick a person, type, and scoring rule.
 */
export function ManualAttendanceDialog({
  people,
  attendanceRules,
  selectedFriday,
  defaultType = "CHURCH",
}: ManualAttendanceDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<ManualAttendancePerson | null>(null)
  const [type, setType] = useState<AttendanceType>(defaultType)
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ name: string; time: string } | null>(null)
  const [tab, setTab] = useState<Tab>("MEMBERS")

  const members = useMemo(() => people.filter((p) => p.role === "SERVED_MEMBER"), [people])
  const servants = useMemo(() => people.filter((p) => p.role === "SERVANT"), [people])

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return members
    return members.filter(
      (p) =>
        p.fullName.toLowerCase().includes(q) ||
        p.phone.replace(/\D/g, "").includes(q.replace(/\D/g, ""))
    )
  }, [members, query])

  const filteredServants = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return servants
    return servants.filter(
      (p) =>
        p.fullName.toLowerCase().includes(q) ||
        p.phone.replace(/\D/g, "").includes(q.replace(/\D/g, ""))
    )
  }, [servants, query])

  const groupedMembers = useMemo(() => {
    const groups = new Map<string, ManualAttendancePerson[]>()
    for (const p of filteredMembers) {
      const cls = p.className || "بدون صنف"
      const list = groups.get(cls) ?? []
      list.push(p)
      groups.set(cls, list)
    }
    return groups
  }, [filteredMembers])

  const applicableRules = useMemo(() => {
    const category = CATEGORY_BY_ATTENDANCE[type]
    return attendanceRules.filter((r) => r.category === category && r.is_active)
  }, [attendanceRules, type])

  const confirm = async () => {
    if (!selected || !selectedRuleId) return
    setBusy(true)
    const res = await recordManualAttendanceAction(selected.id, selectedRuleId, selectedFriday)
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
    setSelectedRuleId(null)
    setDone(null)
    setBusy(false)
    setTab("MEMBERS")
  }

  const displayList = tab === "MEMBERS" ? filteredMembers : filteredServants

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : reset())}>
      <DialogTrigger render={<Button variant="outline" className="gap-1.5" />}>
        <UserPlus className="size-4" />
        تسجيل حضور يدوي
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تسجيل حضور يدوي</DialogTitle>
          <DialogDescription>
            اختر الشخص ثم نوع الحضور ونقطة التسجيل — الجمعة {selectedFriday}
          </DialogDescription>
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
                setSelectedRuleId(null)
                setQuery("")
              }}
            >
              تسجيل شخص آخر
            </Button>
          </div>
        ) : (
          <>
            {/* Tabs: Members / Servants */}
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-secondary/60 p-1">
              <button
                type="button"
                aria-pressed={tab === "MEMBERS"}
                onClick={() => {
                  setTab("MEMBERS")
                  setSelected(null)
                }}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors",
                  tab === "MEMBERS"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Users className="size-4" />
                المخدومين ({members.length})
              </button>
              <button
                type="button"
                aria-pressed={tab === "SERVANTS"}
                onClick={() => {
                  setTab("SERVANTS")
                  setSelected(null)
                }}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors",
                  tab === "SERVANTS"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Users className="size-4" />
                الخدام ({servants.length})
              </button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="ابحث بالاسم أو الموبايل"
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
                  aria-pressed={type === t}
                  onClick={() => {
                    setType(t)
                    setSelectedRuleId(null)
                  }}
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

            {/* Scoring rule selector */}
            {applicableRules.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium text-muted-foreground">نقطة التسجيل</p>
                <div className="flex flex-col gap-1">
                  {applicableRules.map((rule) => (
                    <button
                      key={rule.id}
                      type="button"
                      onClick={() => setSelectedRuleId(rule.id)}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-start transition-colors",
                        selectedRuleId === rule.id
                          ? "bg-coptic-teal/10 ring-1 ring-coptic-teal/30"
                          : "hover:bg-secondary/60"
                      )}
                    >
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground">
                        <Clock className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{rule.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {rule.start_time && rule.end_time
                            ? `${rule.start_time}–${rule.end_time}`
                            : rule.start_time
                              ? `من ${rule.start_time}`
                              : rule.end_time
                                ? `حتى ${rule.end_time}`
                                : "بدون حد زمني"}
                          {" — "}
                          <span className="font-bold">{rule.point_value} درجات</span>
                        </p>
                      </div>
                      {selectedRuleId === rule.id ? (
                        <Check className="size-4 text-coptic-teal" />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* People list */}
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {displayList.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  مفيش نتايج مطابقة
                </p>
              ) : tab === "MEMBERS" ? (
                // Grouped by class
                Array.from(groupedMembers.entries()).map(([cls, group]) => (
                  <div key={cls} className="space-y-1">
                    <p className="sticky top-0 bg-background/95 px-1 pt-1 pb-0.5 text-[11px] font-bold text-muted-foreground backdrop-blur">
                      {cls}
                    </p>
                    {group.map((p) => (
                      <PersonRow
                        key={p.id}
                        person={p}
                        selected={selected?.id === p.id}
                        onSelect={() => setSelected(p)}
                      />
                    ))}
                  </div>
                ))
              ) : (
                // Flat list for servants
                filteredServants.map((p) => (
                  <PersonRow
                    key={p.id}
                    person={p}
                    selected={selected?.id === p.id}
                    onSelect={() => setSelected(p)}
                  />
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
                    {selectedRuleId
                      ? ` — ${applicableRules.find((r) => r.id === selectedRuleId)?.name ?? ""}`
                      : ""}
                  </p>
                </div>
              </div>
            ) : null}
          </>
        )}

        <DialogFooter>
          {!done ? (
            <Button
              disabled={!selected || !selectedRuleId || busy}
              onClick={confirm}
              className="gap-1.5"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              تأكيد التسجيل
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PersonRow({
  person,
  selected,
  onSelect,
}: {
  person: ManualAttendancePerson
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-start transition-colors",
        selected
          ? "bg-coptic-teal/10 ring-1 ring-coptic-teal/30"
          : "hover:bg-secondary/60"
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-coptic-gold-soft font-heading font-bold text-coptic-gold">
        {person.fullName.trim().charAt(0)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{person.fullName}</p>
        <p className="text-[11px] text-muted-foreground" dir="ltr">
          {person.phone}
        </p>
      </div>
      <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-bold text-muted-foreground">
        {ROLE_LABELS[person.role]}
      </span>
      {selected ? <Check className="size-4 text-coptic-teal" /> : null}
    </button>
  )
}
