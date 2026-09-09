"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Send } from "lucide-react"
import { toast } from "sonner"
import { sendNotificationAction } from "@/app/actions/notifications"
import { NOTIFICATION_AUDIENCE_LABELS } from "@/lib/constants"
import type { NotificationAudience } from "@/services/notification-service"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export function NotificationComposer({
  allowedAudiences,
}: {
  allowedAudiences: readonly NotificationAudience[]
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<NotificationAudience[]>([])
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [sending, setSending] = useState(false)

  const toggle = (audience: NotificationAudience) => {
    setSelected((prev) =>
      prev.includes(audience) ? prev.filter((a) => a !== audience) : [...prev, audience]
    )
  }

  const handleSubmit = async () => {
    const t = title.replace(/\s+/g, " ").trim()
    const b = body.replace(/\s+/g, " ").trim()

    if (selected.length === 0) {
      toast.error("اختار جمهور واحد على الأقل")
      return
    }
    if (!t) {
      toast.error("مطلوب كتابة عنوان الإشعار")
      return
    }
    if (!b) {
      toast.error("مطلوب كتابة نص الإشعار")
      return
    }

    setSending(true)
    const res = await sendNotificationAction({ title: t, body: b, audiences: selected })
    setSending(false)

    if (!res.ok) {
      toast.error(res.message)
      return
    }

    toast.success(res.message)
    if (res.recipientCount > 0) {
      toast.info(`تم الإرسال إلى ${res.recipientCount} شخصًا`)
    }
    setTitle("")
    setBody("")
    setSelected([])
    window.dispatchEvent(new Event("notifications-updated"))
    router.refresh()
  }

  return (
    <section className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
      <h2 className="mb-3 font-heading text-base font-extrabold">إرسال إشعار جديد</h2>

      <div className="space-y-1">
        <Label>الجمهور</Label>
        <div className="flex flex-wrap gap-4 pb-1">
          {allowedAudiences.map((audience) => (
            <label
              key={audience}
              className="flex cursor-pointer items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium has-[[data-checked]]:border-coptic-teal has-[[data-checked]]:bg-coptic-teal/10"
            >
              <Checkbox
                checked={selected.includes(audience)}
                onCheckedChange={() => toggle(audience)}
              />
              {NOTIFICATION_AUDIENCE_LABELS[audience]}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-3 space-y-1">
        <Label htmlFor="notification-title">العنوان</Label>
        <Input
          id="notification-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="مثال: اجتماع الخدمة غدًا"
          maxLength={120}
        />
      </div>

      <div className="mt-3 space-y-1">
        <Label htmlFor="notification-body">الرسالة</Label>
        <Textarea
          id="notification-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="اكتب نص الإشعار هنا…"
          rows={4}
          maxLength={1000}
        />
      </div>

      <Button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={sending}
        className="mt-4 w-full bg-coptic-teal text-primary-foreground hover:bg-coptic-teal/80 sm:w-auto"
      >
        <Send className="size-4" />
        {sending ? "جارٍ الإرسال…" : "إرسال الإشعار"}
      </Button>
    </section>
  )
}