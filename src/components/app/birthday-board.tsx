"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Cake, Send } from "lucide-react"
import { toast } from "sonner"
import { sendBirthdayGreetingAction } from "@/app/actions/birthdays"
import {
  BIRTHDAY_GREETING_TITLE,
  BIRTHDAY_WINDOW_DAYS,
  birthdayGreetingBody,
  type UpcomingBirthday,
} from "@/services/birthday-service"
import { formatArabicDate } from "@/lib/dates"
import { EmptyState } from "@/components/coptic/empty-state"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

type Draft = {
  id: string
  name: string
  title: string
  body: string
}

export function BirthdayBoard({ rows }: { rows: UpcomingBirthday[] }) {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)

  const openDraft = (r: UpcomingBirthday) =>
    setDraft({
      id: r.id,
      name: r.name,
      title: BIRTHDAY_GREETING_TITLE,
      body: birthdayGreetingBody(r.name),
    })

  const handleSend = async () => {
    if (!draft) return
    const title = draft.title.replace(/\s+/g, " ").trim()
    const body = draft.body.replace(/\s+/g, " ").trim()

    if (!title) {
      toast.error("مطلوب كتابة عنوان التهنئة")
      return
    }
    if (!body) {
      toast.error("مطلوب كتابة نص التهنئة")
      return
    }

    setBusy(true)
    const res = await sendBirthdayGreetingAction({
      profileId: draft.id,
      title,
      body,
    })
    setBusy(false)

    if (!res.ok) {
      if (res.alreadySent) toast.info(res.message)
      else toast.error(res.message)
      setDraft(null)
      router.refresh()
      return
    }

    toast.success(res.message)
    setDraft(null)
    window.dispatchEvent(new Event("notifications-updated"))
    router.refresh()
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Cake className="size-7" />}
        title="لا توجد أعياد قريبة"
        description="أعياد الميلاد اللي في خلال 30 يوم هتظهر هنا"
      />
    )
  }

  const sections = [
    { key: "today", title: "اليوم", items: rows.filter((r) => r.days === 0) },
    {
      key: "week",
      title: "هذا الأسبوع",
      items: rows.filter((r) => r.days >= 1 && r.days <= 6),
    },
    {
      key: "month",
      title: "خلال 30 يومًا",
      items: rows.filter((r) => r.days >= 7 && r.days <= BIRTHDAY_WINDOW_DAYS),
    },
  ]

  return (
    <div className="space-y-6">
      {sections.map((section) =>
        section.items.length === 0 ? null : (
          <section key={section.key} className="space-y-2">
            <p className="font-heading text-sm font-bold text-muted-foreground">
              {section.title}
            </p>
            <div className="space-y-2">
              {section.items.map((r) => (
                <div
                  key={r.id}
                  data-testid="birthday-row"
                  className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5"
                >
                  <div className="flex size-11 items-center justify-center rounded-full bg-coptic-gold-soft">
                    <Cake className="size-5 text-coptic-gold" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">🎂 {r.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {r.days === 0 ? "عيد ميلاده النهاردة 🎉" : `بعد ${r.days} يوم`} —{" "}
                      {formatArabicDate(r.dateOfBirth)}
                    </p>
                  </div>
                  {r.alreadySent ? (
                    <span className="rounded-full bg-coptic-teal/10 px-2.5 py-1 text-[11px] font-semibold text-coptic-teal">
                      ✓ تم إرسال التهنئة
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openDraft(r)}
                    >
                      <Cake className="size-3.5" />
                      إرسال تهنئة
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )
      )}

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) setDraft(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تهنئة عيد الميلاد</DialogTitle>
            <DialogDescription>الرسالة هتوصّل للمخدوم في إشعاراته</DialogDescription>
          </DialogHeader>

          <div className="space-y-1">
            <Label htmlFor="birthday-title">العنوان</Label>
            <Input
              id="birthday-title"
              value={draft?.title ?? ""}
              maxLength={120}
              onChange={(e) =>
                setDraft((d) => (d ? { ...d, title: e.target.value } : d))
              }
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="birthday-body">الرسالة</Label>
            <Textarea
              id="birthday-body"
              value={draft?.body ?? ""}
              rows={3}
              maxLength={1000}
              onChange={(e) =>
                setDraft((d) => (d ? { ...d, body: e.target.value } : d))
              }
            />
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline">إلغاء</Button>} />
            <Button
              type="button"
              onClick={() => void handleSend()}
              disabled={busy || !draft}
              className="bg-coptic-teal text-primary-foreground hover:bg-coptic-teal/80"
            >
              <Send className="size-4" />
              {busy ? "جارٍ الإرسال…" : "إرسال التهنئة"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}