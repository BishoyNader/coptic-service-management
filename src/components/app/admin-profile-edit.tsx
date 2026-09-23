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
import { ROLES } from "@/lib/roles"
import type { ProfileUpdatePayload } from "@/app/actions/profile"

export type AdminProfileSubmit = (
  id: string,
  payload: ProfileUpdatePayload & {
    status?: "ACTIVE" | "INACTIVE"
    memberClassId?: string
  }
) => Promise<{ ok: boolean; field?: string; message: string }>

export function AdminProfileEdit({
  profile,
  onSubmit,
  onDone,
  classes = [],
  memberClassId,
}: {
  profile: Profile
  onSubmit: AdminProfileSubmit
  onDone: () => void
  /** Active classes for the served-member class selector (required). */
  classes?: { id: string; name: string }[]
  /** The member's current class id, if any. */
  memberClassId?: string | null
}) {
  const [pending, setPending] = useState(false)
  const router = useRouter()
  const [fullName, setFullName] = useState(profile.full_name)
  const [phone, setPhone] = useState(profile.phone)
  const [dateOfBirth, setDateOfBirth] = useState(profile.date_of_birth ?? "")
  const [address, setAddress] = useState(profile.address ?? "")
  const [fatherPhone, setFatherPhone] = useState(profile.father_phone ?? "")
  const [motherPhone, setMotherPhone] = useState(profile.mother_phone ?? "")
  const [selectedClassId, setSelectedClassId] = useState(memberClassId ?? "")
  const [active, setActive] = useState(profile.status === "ACTIVE")

  const isMember = profile.role === ROLES.SERVED_MEMBER

  const handleSave = async () => {
    if (!fullName.trim() || fullName.trim().length < 2) {
      toast.error("اكتب الاسم بالكامل")
      return
    }
    if (!phone.trim() || !/^\+?[0-9]{10,15}$/.test(phone.trim())) {
      toast.error("اكتب رقم موبايل صحيح")
      return
    }
    if (isMember && !selectedClassId) {
      toast.error("يجب اختيار الصف للمخدوم")
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
      memberClassId: isMember ? selectedClassId : undefined,
    })
    setPending(false)

    if (result.ok) {
      toast.success(result.message)
      onDone()
      router.refresh()
    } else {
      toast.error(result.field === "memberClass" ? "يجب اختيار الصف للمخدوم" : result.message)
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

      {isMember && (
        <div className="space-y-2">
          <Label htmlFor="memberClass" className="after:ms-1 after:text-destructive after:content-['*']">
            الصف
          </Label>
          {classes.length === 0 ? (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
              لا توجد صفوف بعد — أنشئ صفًا من صفحة الصفوف أولًا
            </p>
          ) : (
            <select
              id="memberClass"
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="flex h-11 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              <option value="">اختار الصف…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <p className="text-[11px] text-muted-foreground">
            المخدوم لازم يكون تابع لصف من الصفوف المتاحة
          </p>
        </div>
      )}

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
        <Switch aria-label="تفعيل الحساب" checked={active} onCheckedChange={setActive} />
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