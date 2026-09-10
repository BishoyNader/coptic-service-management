"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  BrowserQRCodeReader,
  type IScannerControls,
} from "@zxing/browser"
import {
  Camera,
  ScanLine,
  Keyboard,
  Check,
  Loader2,
  RotateCcw,
  User,
  AlertCircle,
  X,
} from "lucide-react"
import { cn } from "cn"
import { ATTENDANCE_TYPE_LABELS } from "@/lib/constants"
import { ROLE_LABELS } from "@/lib/roles"
import { formatCairoTime } from "@/lib/cairo"
import type { AttendanceType } from "@/lib/types"
import {
  recordAttendanceAction,
  resolveAttendanceIdentityAction,
  type RecordAttendanceResult,
} from "@/app/actions/attendance"

type CheckInView = "idle" | "camera" | "code"
type CameraState = "off" | "starting" | "on" | "denied" | "camera-error"

type AttendanceCheckInProps = {
  defaultType?: AttendanceType
}

/**
 * Daily attendance interface used by Admin (and Super Admin).
 *
 * Optimized for fast repeated scanning at the church entrance:
 * scan QR → record → success → automatically back to scanner.
 * A manual 6-digit code path covers camera denial / no-camera devices.
 */
export function AttendanceCheckIn({ defaultType = "CHURCH" }: AttendanceCheckInProps) {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const readerRef = useRef<BrowserQRCodeReader | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const autoReturnRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [type, setType] = useState<AttendanceType>(defaultType)
  const [view, setView] = useState<CheckInView>("idle")
  const [cameraState, setCameraState] = useState<CameraState>("off")
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState("")
  const [preview, setPreview] = useState<RecordAttendanceResult["person"] | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [result, setResult] = useState<RecordAttendanceResult | null>(null)
  const [lastHandledToken, setLastHandledToken] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  const typeRef = useRef(type)
  const busyRef = useRef(busy)
  useEffect(() => {
    typeRef.current = type
  }, [type])
  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop()
    controlsRef.current = null
    readerRef.current = null
    setCameraState("off")
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  const returnToScanner = useCallback(() => {
    setResult(null)
    setPreview(null)
    setPreviewError(null)
    setCode("")
    setLastHandledToken(null)
    setView("idle")
  }, [])

  const finishWithResult = useCallback(
    (res: RecordAttendanceResult) => {
      setResult(res)
      setBusy(false)
      router.refresh()

      if (res.status === "success" || res.status === "duplicate") {
        if (autoReturnRef.current) clearTimeout(autoReturnRef.current)
        autoReturnRef.current = setTimeout(() => {
          returnToScanner()
        }, 3200)
      }
    },
    [router, returnToScanner]
  )

  const handleScannedToken = useCallback(
    async (token: string) => {
      if (lastHandledToken === token) return
      setLastHandledToken(token)
      setBusy(true)
      controlsRef.current?.stop()
      setCameraState("off")
      const res = await recordAttendanceAction("QR", token, typeRef.current)
      finishWithResult(res)
    },
    [lastHandledToken, finishWithResult]
  )

  const openScanner = useCallback(() => {
    setResult(null)
    setPreview(null)
    setPreviewError(null)
    setLastHandledToken(null)
    setCameraState("starting")
    setView("camera")
    setRetryNonce((n) => n + 1)
  }, [])

  // The camera only starts once the <video> element is mounted (effects run
  // after commit), so ZXing attaches the stream to our visible preview.
  useEffect(() => {
    if (view !== "camera") return
    let cancelled = false
    let controls: IScannerControls | undefined
    const reader = new BrowserQRCodeReader()
    readerRef.current = reader

    void reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        videoRef.current ?? undefined,
        (resolved) => {
          const token = resolved?.getText()
          if (token && !cancelled && !busyRef.current) {
            void handleScannedToken(token)
          }
        }
      )
      .then((c) => {
        if (cancelled) {
          c.stop()
          return
        }
        controls = c
        controlsRef.current = c
        setCameraState("on")
      })
      .catch(() => {
        if (!cancelled) setCameraState("denied")
      })

    return () => {
      cancelled = true
      controls?.stop()
    }
  }, [view, retryNonce, handleScannedToken])

  useEffect(() => {
    return () => {
      controlsRef.current?.stop()
      if (autoReturnRef.current) clearTimeout(autoReturnRef.current)
    }
  }, [])

  const switchType = (next: AttendanceType) => {
    setType(next)
    setResult(null)
    setPreview(null)
    setPreviewError(null)
    if (view === "camera") {
      // Restart scanning for the new type context.
      setCameraState("starting")
      stopCamera()
      setRetryNonce((n) => n + 1)
    }
  }

  const identifyByCode = async () => {
    if (!/^[0-9]{6}$/.test(code.trim())) {
      setPreviewError("الكود يجب أن يتكون من 6 أرقام")
      return
    }
    setPreviewError(null)
    setBusy(true)
    const res = await resolveAttendanceIdentityAction(code.trim(), type)
    setBusy(false)
    if (res.ok) {
      setPreview(res.person)
    } else {
      setPreviewError(res.message)
    }
  }

  const confirmCode = async () => {
    setBusy(true)
    const res = await recordAttendanceAction("CODE", code.trim(), type)
    finishWithResult(res)
  }

  const typeLabel = ATTENDANCE_TYPE_LABELS[type]

  return (
    <div className="space-y-4">
      {/* Attendance type selector (stored labels, not hardcoded logic) */}
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-secondary/60 p-1">
        {(Object.keys(ATTENDANCE_TYPE_LABELS) as AttendanceType[]).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={type === t}
            onClick={() => switchType(t)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition-colors",
              type === t
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {ATTENDANCE_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {result ? (
        result.status === "success" ? (
          <SuccessCard result={result} onNext={returnToScanner} />
        ) : result.status === "duplicate" ? (
          <DuplicateCard result={result} onNext={returnToScanner} />
        ) : (
          <ErrorCard message={result.message ?? "تعذر تسجيل الحضور"} onRetry={returnToScanner} />
        )
      ) : view === "code" ? (
        <CodeEntryPanel
          code={code}
          setCode={(v) => {
            setCode(v.replace(/\D/g, "").slice(0, 6))
            setPreviewError(null)
          }}
          preview={preview}
          previewError={previewError}
          busy={busy}
          typeLabel={typeLabel}
          onIdentify={identifyByCode}
          onConfirm={confirmCode}
          onBack={() => {
            setView("idle")
            setPreview(null)
            setPreviewError(null)
          }}
        />
      ) : view === "camera" ? (
        <CameraPanel
          videoRef={videoRef}
          cameraState={cameraState}
          onTryAgain={() => {
            setCameraState("starting")
            stopCamera()
            setRetryNonce((n) => n + 1)
          }}
          onBack={returnToScanner}
          onManual={() => {
            stopCamera()
            setView("code")
          }}
          typeLabel={typeLabel}
        />
      ) : (
        <IdlePanel
           onScan={openScanner}
           onManual={() => setView("code")}
         />
      )}
    </div>
  )
}

function IdlePanel({
  onScan,
  onManual,
}: {
  onScan: () => void
  onManual: () => void
}) {
  return (
    <div className="space-y-3">
      <button
        type="button"
        aria-label="فتح الكاميرا"
        onClick={onScan}
        className="group relative flex w-full flex-col items-center gap-4 overflow-hidden rounded-3xl bg-coptic-teal p-8 text-center text-primary-foreground shadow-md"
      >
        <div className="pointer-events-none absolute inset-0 coptic-lattice-gold opacity-60" />
        <div className="relative flex size-24 items-center justify-center rounded-3xl bg-white/15 text-white backdrop-blur transition-transform group-hover:scale-105">
          <Camera className="size-12" />
        </div>
        <div className="relative space-y-1">
          <p className="font-heading text-xl font-extrabold">تسجيل حضور</p>
          <p className="text-sm text-primary-foreground/85">اضغط لفتح الكاميرا ومسح الكود</p>
        </div>
      </button>

      <button
        type="button"
        onClick={onManual}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-card py-4 text-sm font-medium shadow-sm ring-1 ring-foreground/5 transition-colors hover:bg-secondary/50"
      >
        <Keyboard className="size-5 text-coptic-gold" />
        إدخال الكود يدويًا
      </button>
    </div>
  )
}

function CameraPanel({
  videoRef,
  cameraState,
  onTryAgain,
  onBack,
  onManual,
  typeLabel,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  cameraState: CameraState
  onTryAgain: () => void
  onBack: () => void
  onManual: () => void
  typeLabel: string
}) {
  if (cameraState === "denied" || cameraState === "camera-error") {
    return (
      <div className="space-y-3">
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-card px-6 py-10 text-center shadow-sm ring-1 ring-foreground/5">
          <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="size-7" />
          </div>
          <div className="space-y-1">
            <p className="font-heading font-bold">تعذر الوصول للكاميرا</p>
            <p className="text-sm text-muted-foreground">
              اسمح بالوصول للكاميرا من إعدادات المتصفح أو استخدم الكود اليدوي
            </p>
          </div>
          <button
            type="button"
            onClick={onManual}
            className="flex items-center gap-2 rounded-xl bg-coptic-teal px-4 py-2.5 text-sm font-medium text-primary-foreground"
          >
            <Keyboard className="size-4" />
            إدخال الكود يدويًا
          </button>
        </div>
        <button
          type="button"
          onClick={onTryAgain}
          className="w-full rounded-2xl bg-secondary py-3 text-sm font-medium text-secondary-foreground"
        >
          إعادة المحاولة
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-3xl bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className={cn(
            "aspect-video w-full object-cover",
            cameraState !== "on" && "opacity-0"
          )}
        />
        {cameraState !== "on" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
            <Loader2 className="size-8 animate-spin text-white/80" />
            <p className="text-sm text-white/80">جاري فتح الكاميرا…</p>
          </div>
        ) : (
          <>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="size-56 rounded-2xl border-2 border-coptic-gold/70" />
            </div>
            <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent p-3 text-center">
              <p className="text-sm font-medium text-white">
                وجّه الكاميرا نحو كود الـ QR — {typeLabel}
              </p>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-xl bg-secondary px-3.5 py-2.5 text-sm font-medium text-secondary-foreground"
        >
          <X className="size-4" />
          إلغاء
        </button>
        <button
          type="button"
          onClick={onManual}
          className="flex items-center gap-1.5 rounded-xl bg-card px-3.5 py-2.5 text-sm font-medium shadow-sm ring-1 ring-foreground/5"
        >
          <Keyboard className="size-4" />
          إدخال الكود
        </button>
      </div>
    </div>
  )
}

function CodeEntryPanel({
  code,
  setCode,
  preview,
  previewError,
  busy,
  typeLabel,
  onIdentify,
  onConfirm,
  onBack,
}: {
  code: string
  setCode: (value: string) => void
  preview: RecordAttendanceResult["person"] | null
  previewError: string | null
  busy: boolean
  typeLabel: string
  onIdentify: () => void
  onConfirm: () => void
  onBack: () => void
}) {
  if (preview) {
    return (
      <div className="space-y-3">
        <div className="relative overflow-hidden rounded-3xl bg-coptic-teal p-6 text-center text-primary-foreground shadow-md">
          <div className="pointer-events-none absolute inset-0 coptic-lattice-gold opacity-60" />
          <div className="relative space-y-3">
            <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-white/15 text-2xl font-heading font-extrabold backdrop-blur">
              {preview.fullName.trim().charAt(0)}
            </div>
            <div className="space-y-1">
              <p className="font-heading text-lg font-extrabold">{preview.fullName}</p>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold">
                <User className="size-3.5" />
                {ROLE_LABELS[preview.role as keyof typeof ROLE_LABELS]}
              </span>
            </div>
            <p className="text-sm text-primary-foreground/85">
              تسجيل حضور — {typeLabel}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl bg-secondary py-3 text-sm font-medium text-secondary-foreground"
          >
            تغيير الكود
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-coptic-teal py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            تأكيد التسجيل
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-3xl bg-card p-6 shadow-sm ring-1 ring-foreground/5">
        <p className="mb-1 font-heading font-bold">إدخال الكود</p>
        <p className="mb-4 text-sm text-muted-foreground">
          أدخل الكود الشخصي المكوّن من 6 أرقام — {typeLabel}
        </p>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="000000"
          dir="ltr"
          aria-label="الكود الشخصي"
          className="w-full rounded-2xl border border-input bg-transparent px-4 py-3 text-center font-heading text-2xl font-extrabold tracking-[0.5em] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
        />
        {previewError ? (
          <p role="alert" className="mt-2 flex items-center gap-1.5 text-sm text-destructive">
            <AlertCircle className="size-4" />
            {previewError}
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy || code.length !== 6}
          onClick={onIdentify}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-coptic-teal py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          تحديد الشخص
        </button>
      </div>

      <button
        type="button"
        onClick={onBack}
        className="w-full rounded-xl bg-secondary py-3 text-sm font-medium text-secondary-foreground"
      >
        رجوع
      </button>
    </div>
  )
}

function SuccessCard({
  result,
  onNext,
}: {
  result: Exclude<RecordAttendanceResult, { status: "error" }>
  onNext: () => void
}) {
  const person = result.person
  const isServant = person?.role === "SERVANT"

  return (
    <div
      role="status"
      className="relative overflow-hidden rounded-3xl bg-coptic-teal p-6 text-center text-primary-foreground shadow-md"
    >
      <div className="pointer-events-none absolute inset-0 coptic-lattice-gold opacity-60" />
      <div className="relative space-y-2">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-white text-coptic-teal">
          <Check className="size-9" strokeWidth={3} />
        </div>
        <p className="font-heading text-xl font-extrabold">تم تسجيل الحضور</p>
        <p className="font-heading text-2xl font-extrabold">{person?.fullName}</p>
        <p className="text-2xl font-bold tabular-nums">
          {formatCairoTime(result.attendedAt!)}
        </p>
        <p className="text-sm text-primary-foreground/85">
          {ATTENDANCE_TYPE_LABELS[result.type!]}
        </p>
        {isServant ? (
          <p className="inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-bold">
            خادم — تسجيل حضور بدون نقاط
          </p>
        ) : (result.points ?? 0) > 0 ? (
          <p className="font-heading text-xl font-extrabold text-coptic-gold">
            +{result.points} نقطة
          </p>
        ) : (
          <p className="text-xs text-primary-foreground/75">
            تم التسجيل خارج نطاق نقاط الحضور
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onNext}
        className="relative mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-white/15 py-3 text-sm font-bold backdrop-blur transition-colors hover:bg-white/25"
      >
        <RotateCcw className="size-4" />
        تسجيل شخص آخر
      </button>
    </div>
  )
}

function DuplicateCard({
  result,
  onNext,
}: {
  result: Exclude<RecordAttendanceResult, { status: "error" }>
  onNext: () => void
}) {
  const person = result.person
  return (
    <div
      role="status"
      className="relative overflow-hidden rounded-3xl bg-coptic-gold-soft/70 p-6 text-center shadow-sm ring-1 ring-coptic-gold/20"
    >
      <div className="pointer-events-none absolute inset-0 coptic-lattice-gold opacity-40" />
      <div className="relative space-y-2">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-coptic-gold text-white">
          <Check className="size-9" strokeWidth={3} />
        </div>
        <p className="font-heading text-xl font-extrabold">تم تسجيل الحضور بالفعل ✓</p>
        <p className="font-heading text-lg font-bold">{person?.fullName}</p>
        <div className="mx-auto w-fit space-y-0.5 rounded-2xl bg-white/60 px-4 py-2 text-sm">
          <p>{ATTENDANCE_TYPE_LABELS[result.type!]}</p>
          <p className="font-bold tabular-nums">
            وقت التسجيل الأصلي: {formatCairoTime(result.attendedAt!)}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onNext}
        className="relative mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-white/60 py-3 text-sm font-bold text-foreground transition-colors hover:bg-white/80"
      >
        <RotateCcw className="size-4" />
        تسجيل شخص آخر
      </button>
    </div>
  )
}

function ErrorCard({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="space-y-3">
<div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-3xl bg-card px-6 py-10 text-center shadow-sm ring-1 ring-foreground/5"
    >
      <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="size-7" />
      </div>
      <p className="font-heading font-bold">{message}</p>
    </div>
      <button
        type="button"
        onClick={onRetry}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-coptic-teal py-3 text-sm font-bold text-primary-foreground"
      >
        <ScanLine className="size-4" />
        تسجيل حضور آخر
      </button>
    </div>
  )
}