"use client"

import { QRCodeSVG } from "qrcode.react"
import { Copy, Check, Maximize2, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { cn } from "cn"
import { CopticCross } from "@/components/coptic/brand"
import { toast } from "sonner"

type QrCodeCardProps = {
  value: string
  name: string
  personalCode?: string
  className?: string
  size?: number
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
  size = 176,
}: QrCodeCardProps) {
  const [copied, setCopied] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!fullscreen) return undefined
    closeBtnRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false)
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [fullscreen])

  const closeFullscreen = () => {
    setFullscreen(false)
    triggerRef.current?.focus()
  }

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

  const qrDisplay = (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-border">
      <QRCodeSVG value={value} size={size} level="M" marginSize={1} />
    </div>
  )

  return (
    <>
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

        {qrDisplay}

        <button
          ref={triggerRef}
          type="button"
          onClick={() => setFullscreen(true)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <Maximize2 className="size-4" />
          تكبير الكود
        </button>

        <p className="text-sm text-muted-foreground">
          اعرض الكود لتسجيل الحضور
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

      {/* Fullscreen overlay */}
      {fullscreen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-fullscreen-title"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm"
          onClick={closeFullscreen}
        >
          <button
            ref={closeBtnRef}
            type="button"
            onClick={closeFullscreen}
            aria-label="إغلاق"
            className="absolute end-4 top-4 rounded-full bg-secondary p-2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-5" />
          </button>

          <div className="flex flex-col items-center gap-6">
            <div className="rounded-3xl bg-white p-8 ring-2 ring-border shadow-lg">
              <QRCodeSVG value={value} size={280} level="H" marginSize={1} />
            </div>

            <div className="text-center space-y-2">
              <p id="qr-fullscreen-title" className="font-heading text-lg font-bold">{name}</p>
              {personalCode ? (
                <p className="font-heading text-xl font-bold tracking-widest text-muted-foreground">
                  {personalCode}
                </p>
              ) : null}
              <p className="text-sm text-muted-foreground">
                اعرض الكود لتسجيل الحضور
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
