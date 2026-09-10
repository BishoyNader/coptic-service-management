"use client"

import { useEffect } from "react"
import { AlertTriangle } from "lucide-react"

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl bg-card px-6 py-12 text-center shadow-sm ring-1 ring-foreground/5">
      <div className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-7" />
      </div>
      <div className="space-y-1">
        <p className="font-heading text-lg font-extrabold">حدث خطأ غير متوقع</p>
        <p className="text-sm text-muted-foreground">
          حاول إعادة التحميل، وإن تكرر الخطأ تواصل مع الإدارة.
        </p>
      </div>
      <button
        type="button"
        onClick={reset}
        className="rounded-xl bg-coptic-teal px-4 py-2.5 text-sm font-bold text-primary-foreground"
      >
        إعادة التحميل
      </button>
    </div>
  )
}