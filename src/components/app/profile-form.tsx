"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Pencil, Check, Loader2, Calendar, Phone, MapPin, User } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { formatArabicDate } from "@/lib/dates"
import type { Profile } from "@/lib/types"
import type { ProfileUpdatePayload } from "@/app/actions/profile"

type ProfileFormProps = {
  profile: Profile
  role: "member" | "servant" | "admin"
  personalCode?: string
  onSubmit: (payload: ProfileUpdatePayload) => Promise<{ ok: boolean; message: string }>
}

export function ProfileForm({ profile, role, personalCode, onSubmit }: ProfileFormProps) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [fullName, setFullName] = useState(profile.full_name)
  const [phone, setPhone] = useState(profile.phone)
  const [dateOfBirth, setDateOfBirth] = useState(profile.date_of_birth ?? "")
  const [address, setAddress] = useState(profile.address ?? "")
  const [fatherPhone, setFatherPhone] = useState(profile.father_phone ?? "")
  const [motherPhone, setMotherPhone] = useState(profile.mother_phone ?? "")

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
    const result = await onSubmit({
      fullName: fullName.trim(),
      phone: phone.trim(),
      dateOfBirth,
      address: role === "member" ? address : undefined,
      fatherPhone: role === "member" ? fatherPhone : undefined,
      motherPhone: role === "member" ? motherPhone : undefined,
    })
    setPending(false)

    if (result.ok) {
      toast.success(result.message)
      setEditing(false)
      router.refresh()
    } else {
      toast.error(result.message)
    }
  }

  const handleCancel = () => {
    setFullName(profile.full_name)
    setPhone(profile.phone)
    setDateOfBirth(profile.date_of_birth ?? "")
    setAddress(profile.address ?? "")
    setFatherPhone(profile.father_phone ?? "")
    setMotherPhone(profile.mother_phone ?? "")
    setEditing(false)
  }

  return (
    <div className="space-y-4">
      {/* Profile header card */}
      <div className="flex flex-col items-center gap-3 rounded-3xl bg-card p-6 text-center shadow-sm ring-1 ring-foreground/5">
        <div className="flex size-16 items-center justify-center rounded-full bg-coptic-teal font-heading text-2xl font-extrabold text-primary-foreground">
          {profile.full_name.trim().charAt(0)}
        </div>
        <div>
          <p className="font-heading text-lg font-extrabold">{profile.full_name}</p>
          <p className="mt-1 text-sm text-muted-foreground">{profile.phone}</p>
        </div>
      </div>

      {/* Edit toggle */}
      <div className="flex justify-end">
        {editing ? (
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleCancel} disabled={pending} className="h-10 px-4">
              إلغاء
            </Button>
            <Button onClick={handleSave} disabled={pending} className="h-10 gap-1.5">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {pending ? "جاري الحفظ..." : "حفظ"}
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setEditing(true)} className="h-10 gap-1.5">
            <Pencil className="size-4" />
            تعديل البيانات
          </Button>
        )}
      </div>

      {/* Profile fields */}
      <div className="rounded-2xl bg-card shadow-sm ring-1 ring-foreground/5">
        <FieldRow id="pf-full-name" icon={<User className="size-4" />} label="الاسم بالكامل">
          {editing ? (
            <Input
              id="pf-full-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="h-9 text-sm text-start"
            />
          ) : (
            <span className="font-medium">{fullName}</span>
          )}
        </FieldRow>

        <FieldRow id="pf-phone" icon={<Phone className="size-4" />} label="رقم الموبايل" dir="ltr">
          {editing ? (
            <Input
              id="pf-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              dir="ltr"
              className="h-9 w-40 text-sm text-start"
            />
          ) : (
            <span className="font-medium" dir="ltr">{phone}</span>
          )}
        </FieldRow>

        <FieldRow id="pf-dob" icon={<Calendar className="size-4" />} label="تاريخ الميلاد">
          {editing ? (
            <Input
              id="pf-dob"
              type="date"
              max={new Date().toISOString().split("T")[0]}
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="h-9 w-40 text-sm text-start"
            />
          ) : (
            <span className="font-medium">
              {dateOfBirth ? formatArabicDate(dateOfBirth) : "—"}
            </span>
          )}
        </FieldRow>

        {role === "member" && (
          <>
            <FieldRow id="pf-father" icon={<Phone className="size-4" />} label="رقم الأب" dir="ltr">
              {editing ? (
                <Input
                  id="pf-father"
                  value={fatherPhone}
                  onChange={(e) => setFatherPhone(e.target.value)}
                  dir="ltr"
                  className="h-9 w-40 text-sm text-start"
                  placeholder="اختياري"
                />
              ) : (
                <span className="font-medium" dir="ltr">{fatherPhone || "—"}</span>
              )}
            </FieldRow>

            <FieldRow id="pf-mother" icon={<Phone className="size-4" />} label="رقم الأم" dir="ltr">
              {editing ? (
                <Input
                  id="pf-mother"
                  value={motherPhone}
                  onChange={(e) => setMotherPhone(e.target.value)}
                  dir="ltr"
                  className="h-9 w-40 text-sm text-start"
                  placeholder="اختياري"
                />
              ) : (
                <span className="font-medium" dir="ltr">{motherPhone || "—"}</span>
              )}
            </FieldRow>

            <FieldRow id="pf-address" icon={<MapPin className="size-4" />} label="العنوان">
              {editing ? (
                <Input
                  id="pf-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="h-9 text-sm text-start"
                  placeholder="اختياري"
                />
              ) : (
                <span className="font-medium">{address || "—"}</span>
              )}
            </FieldRow>
          </>
        )}

        {personalCode && (
          <FieldRow icon={<span className="text-xs font-bold">ID</span>} label="الكود الشخصي">
            <span className="font-heading text-lg font-bold tracking-widest">{personalCode}</span>
          </FieldRow>
        )}
      </div>
    </div>
  )
}

function FieldRow({
  id,
  icon,
  label,
  children,
  dir,
}: {
  id?: string
  icon: React.ReactNode
  label: string
  children: React.ReactNode
  dir?: "ltr" | "rtl"
}) {
  return (
    <div className={cn("flex items-center justify-between border-b border-border px-4 py-3 last:border-0", dir === "ltr" && "flex-row-reverse")}>
      <label
        htmlFor={id}
        className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
      >
        {icon}
        {label}
      </label>
      <div className="text-sm">{children}</div>
    </div>
  )
}
