"use client"

import { QRCodeSVG } from "qrcode.react"
import { Copy, Check } from "lucide-react"
import { useState } from "react"
import { cn } from "cn"
import { CopticCross } from "@/components/coptic/brand"
import { toast } from "sonner"

type QrCodeCardProps = {
  value: string
  name: string
  personalCode?: string
  className?: string
}

/**
 * Displays a user's QR code together with their personal numeric code.
 * The QR encodes only a random capability token — never personal data.
 */
export function QrCodeCard({
  value,
  name,
  personalCode,
  className,
}: QrCodeCardProps) {
  const [copied, setCopied] = useState(false)

  const copyCode = async () => {
    if (!personalCode) return
    try {
      await navigator.clipboard.writeText(personalCode)
      setCopied(true)
      toast.success("تم نسخ الكود")
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("تعذر النسخ")
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-4 rounded-3xl bg-card p-6 shadow-sm ring-1 ring-foreground/5",
        className
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <CopticCross className="size-4 text-coptic-gold" />
        <p className="font-medium">{name}</p>
      </div>

      <div className="rounded-2xl bg-white p-4 ring-1 ring-border">
        <QRCodeSVG value={value} size={176} level="M" marginSize={1} />
      </div>

      <p className="text-sm text-muted-foreground">
        اعرض الكود في أثناء الحضور لتسجيل حضورك بسرعة
      </p>

      {personalCode ? (
        <div className="w-full rounded-2xl bg-coptic-gold-soft p-4 text-center">
          <p className="text-xs font-medium text-accent-foreground">الكود الشخصي</p>
          <div className="mt-1 flex items-center justify-center gap-2">
            <p className="font-heading text-2xl font-bold tracking-widest text-foreground">
              {personalCode}
            </p>
            <button
              type="button"
              onClick={copyCode}
              aria-label="نسخ الكود"
              className="rounded-lg p-1.5 text-accent-foreground transition-colors hover:bg-accent"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}