"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Camera, Loader2, Trash2, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  uploadProfileImage,
  deleteProfileImage,
} from "@/app/actions/profile-image"
import type { Profile } from "@/lib/types"

const MAX_BYTES = 3 * 1024 * 1024

type ProfileImageUploaderProps = {
  profile: Pick<Profile, "id" | "full_name" | "avatar_url">
  /** SUPER_ADMIN: optional target profile — otherwise the caller's own avatar. */
  targetProfileId?: string
}

/**
 * Member-facing profile image uploader. Picks a local file, shows a live
 * object-URL preview, then posts it through the server action (magic-byte
 * sniffing happens server-side); the signed URL stored on the profile is
 * re-read on router.refresh().
 */
export function ProfileImageUploader({
  profile,
  targetProfileId,
}: ProfileImageUploaderProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = useTransition()
  const [selected, setSelected] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const currentUrl = previewUrl ?? profile.avatar_url
  const initials = profile.full_name.trim().charAt(0) || "؟"

  const clearSelection = () => {
    setSelected(null)
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old)
      return null
    })
    if (inputRef.current) inputRef.current.value = ""
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    if (!file.type.startsWith("image/")) {
      setError("اختر ملف صورة (JPG / PNG / WEBP / AVIF)")
      return
    }
    if (file.size > MAX_BYTES) {
      setError("حجم الصورة يجب أن يكون أقل من 3 ميجابايت")
      return
    }
    setSelected(file)
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old)
      return URL.createObjectURL(file)
    })
  }

  const handleSave = () => {
    if (!selected) {
      inputRef.current?.click()
      return
    }
    const formData = new FormData()
    formData.append("avatar", selected)
    if (targetProfileId) formData.append("targetProfileId", targetProfileId)
    setError(null)
    startTransition(async () => {
      const result = await uploadProfileImage(formData)
      if (result.ok) {
        toast.success(result.message)
        clearSelection()
        router.refresh()
      } else {
        setError(result.message)
        toast.error(result.message)
      }
    })
  }

  const handleDelete = () => {
    const formData = new FormData()
    if (targetProfileId) formData.append("targetProfileId", targetProfileId)
    setError(null)
    clearSelection()
    startTransition(async () => {
      const result = await deleteProfileImage(formData)
      if (result.ok) {
        toast.success(result.message)
        router.refresh()
      } else {
        setError(result.message)
        toast.error(result.message)
      }
    })
  }

  return (
    <div className="rounded-2xl bg-card p-6 shadow-sm ring-1 ring-foreground/5">
      <div className="flex flex-col items-center gap-4">
        <div className="relative size-24">
          {currentUrl ? (
            <img
              src={currentUrl}
              alt={profile.full_name}
              className="size-24 rounded-full object-cover ring-2 ring-foreground/10"
            />
          ) : (
            <div className="flex size-24 items-center justify-center rounded-full bg-coptic-teal font-heading text-3xl font-extrabold text-primary-foreground">
              {initials}
            </div>
          )}
          {isPending && (
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="text-center">
          <p className="font-heading font-bold">صورة الملف الشخصي</p>
          <p className="mt-1 text-xs text-muted-foreground">
            يُسمح بصور JPG / PNG / WEBP / AVIF بحد أقصى 3 ميجابايت
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="hidden"
          data-testid="profile-image-input"
          onChange={handleFile}
        />

        {selected ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              onClick={handleSave}
              disabled={isPending}
              className="h-9 gap-1.5"
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              حفظ الصورة
            </Button>
            <Button
              variant="outline"
              onClick={clearSelection}
              disabled={isPending}
              className="h-9 gap-1.5"
            >
              <X className="size-4" />
              إلغاء
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              onClick={handleSave}
              disabled={isPending}
              className="h-9 gap-1.5"
            >
              <Camera className="size-4" />
              {profile.avatar_url ? "تغيير الصورة" : "إضافة صورة"}
            </Button>
            {profile.avatar_url && (
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isPending}
                className="h-9 gap-1.5"
              >
                <Trash2 className="size-4" />
                حذف الصورة
              </Button>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
