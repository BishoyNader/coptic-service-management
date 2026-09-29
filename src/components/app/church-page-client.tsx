"use client"

import { useState } from "react"
import {
  Globe,
  CalendarDays,
  Users,
  HeartHandshake,
  Phone,
  Clock,
  Mail,
  MapPin,
  Edit,
  Save,
  X,
  Plus,
  Trash2,
} from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  updateChurchSettingsAction,
  type ChurchSettings,
  type ServiceTime,
} from "@/app/actions/church-settings"
import type { CopticCalendarResult, UpcomingFeastsResult } from "@/services/coptic-calendar-service"
import { NileDivider, CopticCross } from "@/components/coptic/brand"

type EditableSettings = {
  name: string
  tagline: string
  description: string
  phone: string
  email: string
  address: string
  service_times: ServiceTime[]
}

const DEFAULT_SERVICE_TIMES: ServiceTime[] = [
  { day: "كل جمعة", time: "بعد صلاة الجمعة", note: "حضور القداس والخدمة" },
  { day: "كل أحد", time: "مساءً", note: "الخدمة الصباحية والأنشطة" },
]

function ensureServiceTimes(times: unknown): ServiceTime[] {
  if (Array.isArray(times) && times.length > 0) {
    return times.map((t) => ({
      day: String(t?.day ?? ""),
      time: String(t?.time ?? ""),
      note: String(t?.note ?? ""),
    }))
  }
  return DEFAULT_SERVICE_TIMES
}

export function ChurchPageClient({
  settings,
  calendarResult,
  feastsResult,
  memberCount,
  servantCount,
  isAdmin,
}: {
  settings: ChurchSettings | null
  calendarResult: CopticCalendarResult
  feastsResult: UpcomingFeastsResult
  memberCount: number
  servantCount: number
  isAdmin: boolean
}) {
  const name = settings?.name ?? "خدمتي"
  const tagline = settings?.tagline ?? "كنيسة السيدة العذراء - وادي حوف"
  const description =
    settings?.description ??
    "نظام إدارة الخدمة للكنيسة، يدعم تسجيل الحضور، إدارة الدرجات، والأنشطة الكنسية بين أبناء الخدمة."
  const contactPhone = settings?.phone ?? null
  const contactEmail = settings?.email ?? null
  const contactAddress = settings?.address ?? null
  const serviceTimes = ensureServiceTimes(settings?.service_times)

  return (
    <RealChurchPage
      name={name}
      tagline={tagline}
      description={description}
      contactPhone={contactPhone}
      contactEmail={contactEmail}
      contactAddress={contactAddress}
      serviceTimes={serviceTimes}
      calendarResult={calendarResult}
      feastsResult={feastsResult}
      memberCount={memberCount}
      servantCount={servantCount}
      isAdmin={isAdmin}
    />
  )
}

function RealChurchPage({
  name,
  tagline,
  description,
  contactPhone,
  contactEmail,
  contactAddress,
  serviceTimes: initialServiceTimes,
  calendarResult,
  feastsResult,
  memberCount,
  servantCount,
  isAdmin,
}: {
  name: string
  tagline: string
  description: string
  contactPhone: string | null
  contactEmail: string | null
  contactAddress: string | null
  serviceTimes: ServiceTime[]
  calendarResult: CopticCalendarResult
  feastsResult: UpcomingFeastsResult
  memberCount: number
  servantCount: number
  isAdmin: boolean
}) {
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)

  const [draft, setDraft] = useState<EditableSettings>({
    name,
    tagline,
    description,
    phone: contactPhone ?? "",
    email: contactEmail ?? "",
    address: contactAddress ?? "",
    service_times: initialServiceTimes,
  })

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await updateChurchSettingsAction({
        name: draft.name,
        tagline: draft.tagline,
        description: draft.description,
        phone: draft.phone,
        email: draft.email,
        address: draft.address,
        service_times: draft.service_times,
      })
      if (res.ok) {
        toast.success(res.message)
        setEditMode(false)
      } else {
        toast.error(res.message)
      }
    } catch {
      toast.error("تعذر حفظ الإعدادات")
    } finally {
      setSaving(false)
    }
  }

  const addServiceTime = () => {
    setDraft((d) => ({
      ...d,
      service_times: [...d.service_times, { day: "", time: "", note: "" }],
    }))
  }

  const updateServiceTime = (idx: number, field: "day" | "time" | "note", value: string) => {
    setDraft((d) => ({
      ...d,
      service_times: d.service_times.map((s, i) =>
        i === idx ? { ...s, [field]: value } : s
      ),
    }))
  }

  const removeServiceTime = (idx: number) => {
    setDraft((d) => ({
      ...d,
      service_times: d.service_times.filter((_, i) => i !== idx),
    }))
  }

  const displayPhone = editMode ? (
    <Input
      value={draft.phone}
      onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
      placeholder="رقم الهاتف"
      dir="ltr"
      className="text-left"
    />
  ) : (
    <span className="flex items-center gap-2 text-sm">
      <Phone className="size-4 text-coptic-teal" />
      {contactPhone ?? "غير محدد"}
    </span>
  )

  const displayEmail = editMode ? (
    <Input
      value={draft.email}
      onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
      placeholder="البريد الإلكتروني"
      type="email"
      dir="ltr"
      className="text-left"
    />
  ) : (
    <span className="flex items-center gap-2 text-sm">
      <Mail className="size-4 text-coptic-teal" />
      {contactEmail ?? "غير محدد"}
    </span>
  )

  const displayAddress = editMode ? (
    <Textarea
      value={draft.address}
      onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))}
      placeholder="العنوان"
      rows={2}
    />
  ) : (
    <span className="flex items-start gap-2 text-sm">
      <MapPin className="size-4 shrink-0 text-coptic-teal" />
      {contactAddress ?? "غير محدد"}
    </span>
  )

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-coptic-teal/10 text-coptic-teal">
            <Globe className="size-6" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-extrabold">عن الخدمة</h1>
            <p className="text-sm text-muted-foreground">{name} — {tagline}</p>
          </div>
                </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (editMode ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditMode(false)}
                data-testid="church-cancel-edit"
              >
                <X className="size-4" />
                إلغاء
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving}
                data-testid="church-save-btn"
              >
                <Save className="size-4" />
                {saving ? "جاري الحفظ..." : "حفظ"}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditMode(true)}
              data-testid="church-edit-btn"
            >
              <Edit className="size-4" />
              تعديل الإعدادات
            </Button>
          ))}
        </div>
      </div>

      {/* Church identity card */}
      <div className="card-hover rounded-2xl border bg-card p-4 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-4">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-coptic-gold-soft text-coptic-gold">
            <CopticCross className="size-9" />
          </div>
          <div className="flex-1 space-y-2">
            {editMode ? (
              <>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="اسم الكنيسة"
                  className="font-heading text-xl font-bold"
                  data-testid="church-name-input"
                />
                <Input
                  value={draft.tagline}
                  onChange={(e) => setDraft((d) => ({ ...d, tagline: e.target.value }))}
                  placeholder="الشعار"
                  className="text-sm text-muted-foreground"
                  data-testid="church-tagline-input"
                />
                <Textarea
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  placeholder="وصف الخدمة"
                  rows={3}
                  data-testid="church-description-input"
                />
              </>
            ) : (
              <>
                <h2 className="font-heading text-xl font-bold">{name}</h2>
                <p className="text-sm text-muted-foreground">{tagline}</p>
                <p className="text-sm">{description}</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Service times */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold">مواعيد الخدمة</h2>
          {editMode && (
            <Button
              variant="outline"
              size="sm"
              onClick={addServiceTime}
              data-testid="add-service-time"
            >
              <Plus className="size-4" />
              إضافة
            </Button>
          )}
        </div>
        {draft.service_times.length === 0 && editMode ? (
          <p className="text-center text-sm text-muted-foreground py-4">
                        اضغط &#8220;إضافة&#8221; لإضافة مواعيد خدمة
          </p>
        ) : null}
        {draft.service_times.map((s, idx) => (
          <div
            key={idx}
            className="flex flex-col gap-2 rounded-xl border bg-card p-4 sm:flex-row sm:items-end"
          >
            {editMode ? (
              <>
                <div className="flex-1">
                  <Label className="text-xs">اليوم</Label>
                  <Input
                    value={s.day}
                    onChange={(e) => updateServiceTime(idx, "day", e.target.value)}
                    placeholder="مثال: كل جمعة"
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs">الوقت</Label>
                  <Input
                    value={s.time}
                    onChange={(e) => updateServiceTime(idx, "time", e.target.value)}
                    placeholder="مثال: بعد صلاة الجمعة"
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs">ملاحظة</Label>
                  <Input
                    value={s.note}
                    onChange={(e) => updateServiceTime(idx, "note", e.target.value)}
                    placeholder="تفاصيل إضافية"
                  />
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => removeServiceTime(idx)}
                  data-testid={`remove-service-time-${idx}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </>
            ) : (
              <>
                <Clock className="mt-0.5 size-5 text-coptic-teal" />
                <div>
                  <p className="font-semibold">{s.day}</p>
                  <p className="text-sm text-muted-foreground">{s.time}</p>
                  <p className="text-xs text-muted-foreground">{s.note}</p>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Contact */}
      <div className="space-y-3">
        <h2 className="font-heading text-lg font-bold">بيانات الاتاصال</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border bg-card p-4">{displayPhone}</div>
          <div className="rounded-xl border bg-card p-4">{displayEmail}</div>
          <div className="sm:col-span-2 rounded-xl border bg-card p-4">{displayAddress}</div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card-hover flex items-center gap-3 rounded-xl border bg-card p-4">
          <div className="flex size-10 items-center justify-center rounded-xl bg-coptic-teal/10 text-coptic-teal">
            <Users className="size-5" />
          </div>
          <div>
            <p className="font-heading text-xl font-extrabold">{memberCount}</p>
            <p className="text-xs text-muted-foreground">مخدوم نشط</p>
          </div>
        </div>
        <div className="card-hover flex items-center gap-3 rounded-xl border bg-card p-4">
          <div className="flex size-10 items-center justify-center rounded-xl bg-coptic-gold-soft text-coptic-gold">
            <HeartHandshake className="size-5" />
          </div>
          <div>
            <p className="font-heading text-xl font-extrabold">{servantCount}</p>
            <p className="text-xs text-muted-foreground">خادم نشط</p>
          </div>
        </div>
      </div>

      <NileDivider />

      {/* Coptic calendar */}
      <div className="space-y-3">
        <h2 className="flex items-center gap-2 font-heading text-lg font-bold">
          <CalendarDays className="size-5 text-coptic-teal" />
          التقويم القبطي اليوم
        </h2>

        {calendarResult.ok ? (
          <div className="card-hover rounded-2xl border bg-card p-5">
            <h3 className="font-heading text-xl font-bold text-coptic-teal">
              {calendarResult.day.copticDate.monthString}{" "}
              {calendarResult.day.copticDate.day}،{" "}
              {calendarResult.day.copticDate.year}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {calendarResult.day.copticDate.dateString}
            </p>

            {calendarResult.day.celebrations.length > 0 ? (
              <div className="mt-3 space-y-1">
                {calendarResult.day.celebrations.map((c) => (
                  <p key={c.englishName} className="text-sm">
                    • {c.name}
                  </p>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                لا توجد احتفالات اليوم
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{calendarResult.message}</p>
        )}

        {feastsResult.ok && feastsResult.days.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-muted-foreground">
              الأعياد القادمة (١٤ يوم)
            </h3>
            {feastsResult.days.map((day) => (
              <div
                key={day.date}
                className="card-hover flex items-center justify-between rounded-xl border bg-card px-4 py-3"
              >
                <div>
                  <p className="font-medium">{day.celebrations[0]?.name ?? "عيد"}</p>
                  <p className="text-xs text-muted-foreground">
                    {day.copticDate.monthString} {day.copticDate.day}
                  </p>
                </div>
                <Link href="/app/super-admin/coptic-calendar">
                  <Button variant="link" size="sm" className="text-xs">
                    التقويم الكامل
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="pt-4 text-center">
        <p className="text-xs text-muted-foreground">
          يحيا المسيح 🕊️ — {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
