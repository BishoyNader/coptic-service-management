"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Calendar, Cake, Search, Check, X, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { formatArabicDate } from "@/lib/dates"
import { EmptyState } from "@/components/coptic/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { servantUpdateMemberDobAction } from "@/app/actions/profile"

export type ServantMemberRow = {
  id: string
  full_name: string
  date_of_birth: string | null
}

/**
 * Servant-facing list of ACTIVE served members for entering/updating their
 * date of birth. Renders only name + date of birth — no phone numbers, auth
 * IDs, QR tokens or addresses. Every write goes through the scoped
 * servantUpdateMemberDobAction which re-validates the caller's role and the
 * target's role/status server-side.
 */
export function ServantMemberDobList({ members }: { members: ServantMemberRow[] }) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState(false)

  const filtered = members.filter((m) => m.full_name.includes(query.trim()))

  const startEdit = (m: ServantMemberRow) => {
    setEditingId(m.id)
    setDraft(m.date_of_birth ?? "")
  }

  const handleSave = async (id: string) => {
    if (draft && draft.length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(draft)) {
      toast.error("تاريخ الميلاد غير صحيح")
      return
    }
    setPending(true)
    const res = await servantUpdateMemberDobAction({ profileId: id, dateOfBirth: draft })
    setPending(false)
    setEditingId(null)
    if (res.ok) {
      toast.success(res.message)
      router.refresh()
    } else {
      toast.error(res.message)
    }
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => e.preventDefault()}
        role="search"
        className="relative"
      >
        <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="البحث بالاسم"
          placeholder="ابحث عن مخدوم..."
          className="h-11 w-full rounded-xl border border-input bg-transparent ps-10 pe-4 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
        />
      </form>

      {members.length === 0 ? (
        <EmptyState
          icon={<Cake className="size-7" />}
          title="لا يوجد مخدومين"
          description="مفيش مخدومين نشطين حاليًا يمكنك إدارة تاريخ ميلادهم"
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="size-7" />}
          title="لا توجد نتائج"
          description="جرّب كلمة بحث مختلفة"
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((m) => (
            <div
              key={m.id}
              data-testid="servant-member-row"
              className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5"
            >
              <div className="flex size-11 items-center justify-center rounded-full bg-coptic-gold-soft font-heading font-bold text-coptic-gold">
                {m.full_name.trim().charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{m.full_name}</p>
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Calendar className="size-3" />
                  {m.date_of_birth ? formatArabicDate(m.date_of_birth) : "لا يوجد تاريخ ميلاد"}
                </p>
              </div>

              {editingId === m.id ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    type="date"
                    value={draft}
                    max={new Date().toISOString().split("T")[0]}
                    onChange={(e) => setDraft(e.target.value)}
                    className="h-9 w-40 text-sm text-start"
                    aria-label={`تاريخ ميلاد ${m.full_name}`}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleSave(m.id)}
                    disabled={pending}
                    className="h-9 gap-1"
                  >
                    {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                    حفظ
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingId(null)}
                    disabled={pending}
                    className="h-9 px-2"
                    aria-label="إلغاء"
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => startEdit(m)}
                  className="h-9 gap-1"
                >
                  <Calendar className="size-3.5" />
                  تاريخ الميلاد
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}