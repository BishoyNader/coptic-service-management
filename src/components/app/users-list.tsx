"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Search,
  User,
  HeartHandshake,
  Shield,
  ShieldCheck,
  ChevronLeft,
  Power,
  Archive,
  Loader2,
} from "lucide-react"
import { cn } from "cn"
import { toast } from "sonner"
import { ROLE_LABELS, type AppRole } from "@/lib/roles"
import { Input } from "@/components/ui/input"
import { EmptyState } from "@/components/coptic/empty-state"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type UsersListProps = {
  users: {
    id: string
    full_name: string
    phone: string
    role: AppRole
    status: "ACTIVE" | "INACTIVE" | "ARCHIVED"
  }[]
  homePrefix: string
  onToggleStatus: (
    id: string,
    status: "ACTIVE" | "INACTIVE" | "ARCHIVED"
  ) => Promise<{ ok: boolean; message: string }>
}

const STATUS_LABELS = {
  ACTIVE: "نشط",
  INACTIVE: "موقوف",
  ARCHIVED: "مؤرشف",
} as const

export function UsersList({ users, homePrefix, onToggleStatus }: UsersListProps) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState<AppRole | "ALL">("ALL")
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<(typeof users)[number] | null>(null)
  const [archiving, setArchiving] = useState(false)

  const filtered = useMemo(() => {
    let list = users
    if (roleFilter !== "ALL") {
      list = list.filter((u) => u.role === roleFilter)
    }
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (u) =>
          u.full_name.toLowerCase().includes(q) ||
          u.phone.toLowerCase().includes(q)
      )
    }
    return list
  }, [users, query, roleFilter])

  const roleIcon = (role: AppRole) => {
    switch (role) {
      case "SERVED_MEMBER":
        return <User className="size-4" />
      case "SERVANT":
        return <HeartHandshake className="size-4" />
      case "ADMIN":
        return <Shield className="size-4" />
      case "SUPER_ADMIN":
        return <ShieldCheck className="size-4" />
    }
  }

  const roleColor = (role: AppRole) => {
    switch (role) {
      case "SERVED_MEMBER":
        return "bg-coptic-gold-soft text-coptic-gold"
      case "SERVANT":
        return "bg-coptic-teal/10 text-coptic-teal"
      case "ADMIN":
        return "bg-coptic-navy/10 text-coptic-navy"
      case "SUPER_ADMIN":
        return "bg-coptic-terra/10 text-coptic-terra"
    }
  }

  const handleToggle = async (u: UsersListProps["users"][number]) => {
    setPendingId(u.id)
    const next = u.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"
    const result = await onToggleStatus(u.id, next)
    setPendingId(null)
    if (result.ok) {
      toast.success(next === "ACTIVE" ? "تم تفعيل الحساب" : "تم إيقاف الحساب")
      router.refresh()
    } else {
      toast.error(result.message)
    }
  }

  const handleArchive = async () => {
    if (!archiveTarget) return
    setArchiving(true)
    const result = await onToggleStatus(archiveTarget.id, "ARCHIVED")
    setArchiving(false)
    if (result.ok) {
      toast.success("تم أرشفة الحساب")
      router.refresh()
    } else {
      toast.error(result.message)
    }
    setArchiveTarget(null)
  }

  const filters: { key: AppRole | "ALL"; label: string }[] = [
    { key: "ALL", label: "الكل" },
    { key: "SERVED_MEMBER", label: "مخدوم" },
    { key: "SERVANT", label: "خادم" },
    { key: "ADMIN", label: "مسؤول" },
    { key: "SUPER_ADMIN", label: "مسؤول عام" },
  ]

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث بالاسم أو رقم الموبايل..."
          className="h-11 ps-10"
        />
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setRoleFilter(f.key)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
              roleFilter === f.key
                ? "bg-coptic-teal text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="size-7" />}
          title="لا توجد نتائج"
          description="جرّب كلمة بحث مختلفة أو غيّر الفلتر"
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((u) => (
            <div
              key={u.id}
              className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5"
            >
              <div
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-full font-heading font-bold",
                  roleColor(u.role)
                )}
              >
                {u.full_name.trim().charAt(0)}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{u.full_name}</p>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                      roleColor(u.role)
                    )}
                  >
                    {roleIcon(u.role)}
                    {ROLE_LABELS[u.role]}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <p className="text-[11px] text-muted-foreground" dir="ltr">
                    {u.phone}
                  </p>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                      u.status === "ACTIVE" && "bg-coptic-teal/10 text-coptic-teal",
                      u.status === "INACTIVE" && "bg-destructive/10 text-destructive",
                      u.status === "ARCHIVED" && "bg-muted text-muted-foreground"
                    )}
                  >
                    {STATUS_LABELS[u.status]}
                  </span>
                </div>
              </div>

              {u.status !== "ARCHIVED" ? (
                <button
                  type="button"
                  onClick={() => handleToggle(u)}
                  disabled={pendingId === u.id}
                  title={u.status === "ACTIVE" ? "إيقاف الحساب" : "تفعيل الحساب"}
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors",
                    u.status === "ACTIVE"
                      ? "bg-secondary text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      : "bg-coptic-gold-soft text-coptic-gold"
                  )}
                >
                  {pendingId === u.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Power className="size-4" />
                  )}
                </button>
              ) : null}

              {u.status !== "ARCHIVED" ? (
                <button
                  type="button"
                  onClick={() => setArchiveTarget(u)}
                  title="أرشفة الحساب"
                  className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Archive className="size-4" />
                </button>
              ) : null}

              <a
                href={`${homePrefix}/user/${u.id}`}
                className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
                aria-label="عرض"
              >
                <ChevronLeft className="size-4" />
              </a>
            </div>
          ))}
        </div>
      )}

      {archiveTarget ? (
        <AlertDialog open onOpenChange={() => setArchiveTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia className="bg-destructive/10 text-destructive">
                <Archive className="size-6" />
              </AlertDialogMedia>
              <AlertDialogTitle>أرشفة الحساب؟</AlertDialogTitle>
              <AlertDialogDescription>
                سيتم أرشفة حساب {archiveTarget.full_name}. لن يظهر في قوائم النشطة لكن بياناته محفوظة.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={archiving}>إلغاء</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={archiving}
                onClick={handleArchive}
              >
                {archiving ? <Loader2 className="size-4 animate-spin" /> : null}
                أرشفة الحساب
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  )
}