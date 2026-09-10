"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Send } from "lucide-react"
import { toast } from "sonner"
import {
  sendNotificationAction,
  getDeliveryChannelsAction,
} from "@/app/actions/notifications"
import { NOTIFICATION_AUDIENCE_LABELS } from "@/lib/constants"
import type { NotificationAudience } from "@/services/notification-service"
import type { DeliveryChannel } from "@/services/notification-delivery"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

const CHANNEL_UI_LABELS: Record<DeliveryChannel, string> = {
  IN_APP: "إشعار داخل التطبيق",
  SMS: "رسالة SMS",
  WHATSAPP: "رسالة WhatsApp",
}

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
  const [channels, setChannels] = useState<
    Array<{ channel: DeliveryChannel; configured: boolean; label: string }>
  >([])
  const [selectedChannels, setSelectedChannels] = useState<DeliveryChannel[]>(["IN_APP"])

  useEffect(() => {
    getDeliveryChannelsAction().then(setChannels).catch(() => {})
  }, [])

  const toggle = (audience: NotificationAudience) => {
    setSelected((prev) =>
      prev.includes(audience) ? prev.filter((a) => a !== audience) : [...prev, audience]
    )
  }

  const toggleChannel = (channel: DeliveryChannel) => {
    if (channel === "IN_APP") return // always on
    setSelectedChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]
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
    const res = await sendNotificationAction({
      title: t,
      body: b,
      audiences: selected,
      channels: selectedChannels,
    })
    setSending(false)

    if (!res.ok) {
      toast.error(res.message)
      return
    }

    toast.success(res.message)
    if (res.recipientCount > 0) {
      toast.info(`تم الإرسال إلى ${res.recipientCount} شخصًا`)
    }

    // Show delivery summary if external channels were used
    if (res.deliverySummary) {
      const { sms, whatsapp } = res.deliverySummary
      if (sms.sent > 0) toast.info(`تم إرسال ${sms.sent} رسالة SMS`)
      if (sms.failed > 0) toast.warning(`فشل إرسال ${sms.failed} رسالة SMS`)
      if (sms.notConfigured > 0) toast.info("خدمة SMS غير مُعدة")
      if (whatsapp.sent > 0) toast.info(`تم إرسال ${whatsapp.sent} رسالة WhatsApp`)
      if (whatsapp.failed > 0) toast.warning(`فشل إرسال ${whatsapp.failed} رسالة WhatsApp`)
      if (whatsapp.notConfigured > 0) toast.info("خدمة WhatsApp غير مُعدة")
    }

    setTitle("")
    setBody("")
    setSelected([])
    setSelectedChannels(["IN_APP"])
    window.dispatchEvent(new Event("notifications-updated"))
    router.refresh()
  }

  const externalChannels = channels.filter((c) => c.channel !== "IN_APP")

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

      {externalChannels.length > 0 && (
        <div className="mt-3 space-y-1">
          <Label>قنوات الإرسال</Label>
          <div className="flex flex-wrap gap-4 pb-1">
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium has-[[data-checked]]:border-coptic-teal has-[[data-checked]]:bg-coptic-teal/10">
              <Checkbox checked={true} disabled />
              {CHANNEL_UI_LABELS.IN_APP}
            </label>
            {externalChannels.map((ch) => (
              <label
                key={ch.channel}
                className="flex cursor-pointer items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium has-[[data-checked]]:border-coptic-teal has-[[data-checked]]:bg-coptic-teal/10"
              >
                <Checkbox
                  checked={selectedChannels.includes(ch.channel)}
                  onCheckedChange={() => toggleChannel(ch.channel)}
                />
                <span>{CHANNEL_UI_LABELS[ch.channel]}</span>
                {!ch.configured && (
                  <span className="text-[10px] text-muted-foreground">(غير مُعدة)</span>
                )}
              </label>
            ))}
          </div>
        </div>
      )}

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
