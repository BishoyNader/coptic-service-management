"use client"

import { Camera } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ProfileImageUploader } from "@/components/app/profile-image-uploader"
import type { Profile } from "@/lib/types"

type Props = {
  profile: Pick<Profile, "id" | "full_name" | "avatar_url">
}

/**
 * Blocking gate for served members who still have no profile photo. Shown
 * right after login (the app layout renders it whenever `avatar_url` is
 * null) and cannot be dismissed — uploading the photo closes it, because
 * the uploader's `router.refresh()` re-renders the layout with the new
 * avatar URL.
 */
export function AvatarGate({ profile }: Props) {
  if (profile.avatar_url) return null

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="size-5 text-coptic-teal" />
            صورة الملف الشخصي مطلوبة
          </DialogTitle>
          <DialogDescription>
            قبل ما تكمّل، أضف صورتك الشخصية — عشان يقدر أصحابك ومخدوميك يعرفوك بسهولة.
          </DialogDescription>
        </DialogHeader>
        <ProfileImageUploader profile={profile} />
      </DialogContent>
    </Dialog>
  )
}
