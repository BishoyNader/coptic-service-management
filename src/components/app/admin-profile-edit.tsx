"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { Profile } from "@/lib/types"
import type { ProfileUpdatePayload } from "@/app/actions/profile"

export type AdminProfileSubmit = (
  id: string,
  payload: ProfileUpdatePayload & { status?: "ACTIVE" | "INACTIVE" }
) => Promise<{ ok: boolean; message: string }>

export function AdminProfileEdit({
  profile,
  onSubmit,
  onDone,
}: {
  profile: Profile
  onSubmit: AdminProfileSubmit
  onDone: () => void
}) {
  const [pending, setPending] = useState(false)
  const router = useRouter()
  const [fullName, setFullName] = useState(profile.full_name)
  const [phone, setPhone] = useState(profile.phone)
  const [dateOfBirth, setDateOfBirth] = useState(profile.date_of_birth ?? "")
  const [address, setAddress] = useState(profile.address ?? "")
  const [fatherPhone, setFatherPhone] = useState(profile.father_phone ?? "")
  const [motherPhone, setMotherPhone] = useState(profile.mother_phone ?? "")
  const [active, setActive] = useState(profile.status === "ACTIVE")

  const handleSave = async () => {
    if (!fullName.trim() || fullName.trim().length < 2) {
      toast.error("اكتب الاسم بالكامل")
      return
    }
    if (!phone.trim() || !/^\+?[0-9]{10,15}$/.test(phone.trim())) {
      toast.error("اكتب رقم موبايل صحيح")
      return
    }

    setPending(true)
    const result = await onSubmit(profile.id, {
      fullName: fullName.trim(),
      phone: phone.trim(),
      dateOfBirth,
      address: address || undefined,
      fatherPhone: fatherPhone || undefined,
      motherPhone: motherPhone || undefined,
      status: active ? "ACTIVE" : "INACTIVE",
    })
    setPending(false)

    if (result.ok) {
      toast.success(result.message)
      onDone()
      router.refresh()
    } else {
      toast.error(result.message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="fullName">الاسم بالكامل</Label>
        <Input
          id="fullName"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="h-11 text-base"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="phone">رقم الموبايل</Label>
        <Input
          id="phone"
          type="tel"
          dir="ltr"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="h-11 text-base text-start"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="dateOfBirth">تاريخ الميلاد</Label>
        <Input
          id="dateOfBirth"
          type="date"
          max={new Date().toISOString().split("T")[0]}
          value={dateOfBirth}
          onChange={(e) => setDateOfBirth(e.target.value)}
          className="h-11 text-base"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="address">العنوان</Label>
        <Input
          id="address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="h-11 text-base"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="fatherPhone">رقم الأب</Label>
          <Input
            id="fatherPhone"
            type="tel"
            dir="ltr"
            value={fatherPhone}
            onChange={(e) => setFatherPhone(e.target.value)}
            className="h-11 text-base text-start"
            placeholder="اختياري"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="motherPhone">رقم الأم</Label>
          <Input
            id="motherPhone"
            type="tel"
            dir="ltr"
            value={motherPhone}
            onChange={(e) => setMotherPhone(e.target.value)}
            className="h-11 text-base text-start"
            placeholder="اختياري"
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-2xl bg-card px-4 py-3 ring-1 ring-foreground/5">
        <div>
          <p className="text-sm font-medium">الحساب مفعّل</p>
          <p className="text-[11px] text-muted-foreground">
            اطفيه لو المفروض المخدوم يتعطل مؤقتًا
          </p>
        </div>
        <Switch checked={active} onCheckedChange={setActive} />
      </div>

      <div className="flex gap-2 pt-2">
        <Button
          variant="ghost"
          className="h-11 flex-1"
          onClick={onDone}
          disabled={pending}
        >
          إلغاء
        </Button>
        <Button className="h-11 flex-1" onClick={handleSave} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {pending ? "جاري الحفظ..." : "حفظ"}
        </Button>
      </div>
    </div>
  )
}