"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Pencil, X, QrCode, Star, MapPin, Phone, Calendar, User, Power, Archive, Loader2 } from "lucide-react"
import { cn } from "cn"
import { QRCodeSVG } from "qrcode.react"
import { toast } from "sonner"
import { formatArabicDate, formatArabicDateTime } from "@/lib/dates"
import { SCORING_CATEGORY_LABELS, type ScoringCategory } from "@/lib/constants"
import type { Profile, UserStatus } from "@/lib/types"
import { AdminProfileEdit, type AdminProfileSubmit } from "./admin-profile-edit"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type AdminMemberViewProps = {
  profile: Profile
  personalCode?: string
  qrToken?: string
  attendance: { id: string; attended_at: string }[]
  scores: { id: string; category: string; points: number; session_date: string; note: string | null }[]
  onSubmit: AdminProfileSubmit
  onChangeStatus?: (id: string, status: UserStatus) => Promise<{ ok: boolean; message: string }>
}

const STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: "نشط",
  INACTIVE: "موقوف",
  ARCHIVED: "مؤرشف",
}

export function AdminMemberView({
  profile,
  personalCode,
  qrToken,
  attendance,
  scores,
  onSubmit,
  onChangeStatus,
}: AdminMemberViewProps) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useState<"profile" | "attendance" | "scores">("profile")
  const [confirm, setConfirm] = useState<"INACTIVE" | "ARCHIVED" | "ACTIVE" | null>(null)
  const [pending, setPending] = useState(false)

  const handleStatus = async (status: UserStatus) => {
    if (!onChangeStatus) return
    setPending(true)
    const result = await onChangeStatus(profile.id, status)
    setPending(false)
    setConfirm(null)
    if (result.ok) {
      toast.success(STATUS_LABELS[status] === "مؤرشف" ? "تم أرشفة الحساب" : "تم تحديث الحالة")
      router.refresh()
    } else {
      toast.error(result.message)
    }
  }

  const confirmDialog =
    confirm === "ARCHIVED" ? (
      {
        title: "أرشفة الحساب؟",
        desc: "سيتم أرشفة هذا الحساب ولن يظهر في قوائم الحضور، لكن ما زالت بياناته محفوظة.",
        action: "أرشفة الحساب",
        destructive: true,
        status: "ARCHIVED" as const,
      }
    ) : confirm === "INACTIVE" ? (
      {
        title: "إيقاف الحساب؟",
        desc: "يمكن لهذا المستخدم تفعيل حسابك لاحقًا. لن يتمكن من تسجيل الحضور وهو موقوف.",
        action: "إيقاف الحساب",
        destructive: false,
        status: "INACTIVE" as const,
      }
    ) : confirm === "ACTIVE" ? (
      {
        title: "تفعيل الحساب؟",
        desc: "سيتمكن هذا المستخدم من تسجيل الحضور والدخول إلى حسابه.",
        action: "تفعيل الحساب",
        destructive: false,
        status: "ACTIVE" as const,
      }
    ) : null

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="relative overflow-hidden rounded-3xl bg-coptic-teal p-5 text-primary-foreground shadow-md">
        <div className="pointer-events-none absolute inset-0 coptic-lattice-gold opacity-60" />
        <div className="relative flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-white/15 font-heading text-2xl font-extrabold backdrop-blur">
            {profile.full_name.trim().charAt(0)}
          </div>
          <div className="flex-1">
            <p className="font-heading text-lg font-extrabold">{profile.full_name}</p>
            <p className="text-sm text-primary-foreground/85" dir="ltr">{profile.phone}</p>
          </div>
          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-sm font-medium backdrop-blur transition-colors hover:bg-white/25"
            >
              <Pencil className="size-4" />
              تعديل البيانات
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-sm font-medium backdrop-blur"
            >
              <X className="size-4" />
              إغلاق
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
          <AdminProfileEdit profile={profile} onSubmit={onSubmit} onDone={() => setEditing(false)} />
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="grid grid-cols-3 gap-1 rounded-2xl bg-secondary/60 p-1">
            {(
              [
                { key: "profile", label: "البيانات", icon: <User className="size-4" /> },
                { key: "attendance", label: "الحضور", icon: <QrCode className="size-4" /> },
                { key: "scores", label: "الدرجات", icon: <Star className="size-4" /> },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition-colors",
                  tab === t.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === "profile" ? (
            <div className="rounded-2xl bg-card shadow-sm ring-1 ring-foreground/5">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <p className="font-heading font-bold">بيانات العضو</p>
              </div>

              <InfoRow icon={<User className="size-4" />} label="الاسم بالكامل" value={profile.full_name} />
              <InfoRow icon={<Phone className="size-4" />} label="رقم الموبايل" value={profile.phone} dir="ltr" />
              <InfoRow
                icon={<Calendar className="size-4" />}
                label="تاريخ الميلاد"
                value={profile.date_of_birth ? formatArabicDate(profile.date_of_birth) : "—"}
              />
              <InfoRow icon={<Phone className="size-4" />} label="رقم الأب" value={profile.father_phone ?? "—"} dir="ltr" />
              <InfoRow icon={<Phone className="size-4" />} label="رقم الأم" value={profile.mother_phone ?? "—"} dir="ltr" />
              <InfoRow icon={<MapPin className="size-4" />} label="العنوان" value={profile.address ?? "—"} />

              {/* QR + personal code */}
                  <div className="border-t border-border px-4 py-4">
                    <p className="mb-3 text-sm font-medium text-muted-foreground">الكود الشخصي</p>
                    {qrToken ? (
                      <div className="flex items-center gap-4">
                        <div className="rounded-2xl bg-white p-3 ring-1 ring-border">
                          <QRCodeSVG value={qrToken} size={96} level="M" marginSize={1} />
                        </div>
                        <div>
                          <p className="font-heading text-3xl font-bold tracking-widest text-coptic-gold">
                            {personalCode ?? "—"}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            يُقرأ من الجهاز الخاص بالمخدوم
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">لم يتم إنشاء الكود بعد</p>
                    )}
                  </div>

                  {/* Status */}
                  {onChangeStatus ? (
                    <div className="border-t border-border px-4 py-4">
                      <p className="mb-3 text-sm font-medium text-muted-foreground">حالة الحساب</p>
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold",
                              profile.status === "ACTIVE" && "bg-coptic-teal/10 text-coptic-teal",
                              profile.status === "INACTIVE" && "bg-destructive/10 text-destructive",
                              profile.status === "ARCHIVED" && "bg-muted text-muted-foreground"
                            )}
                          >
                            <span
                              className={cn(
                                "size-1.5 rounded-full",
                                profile.status === "ACTIVE" && "bg-coptic-teal",
                                profile.status === "INACTIVE" && "bg-destructive",
                                profile.status === "ARCHIVED" && "bg-muted-foreground"
                              )}
                            />
                            {STATUS_LABELS[profile.status]}
                          </span>
                        </div>

                        {profile.status !== "ARCHIVED" && (
                          <div className="flex flex-wrap gap-2">
                            {profile.status !== "INACTIVE" && (
                              <button
                                type="button"
                                onClick={() => setConfirm("INACTIVE")}
                                className="flex items-center gap-1.5 rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20"
                              >
                                <Power className="size-4" />
                                إيقاف الحساب
                              </button>
                            )}
                            {profile.status !== "ACTIVE" && (
                              <button
                                type="button"
                                onClick={() => setConfirm("ACTIVE")}
                                className="flex items-center gap-1.5 rounded-xl bg-coptic-gold-soft px-3 py-2 text-sm font-medium text-coptic-gold transition-colors hover:bg-coptic-gold-soft/70"
                              >
                                <Power className="size-4" />
                                تفعيل الحساب
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setConfirm("ARCHIVED")}
                              className="flex items-center gap-1.5 rounded-xl bg-muted px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/70"
                            >
                              <Archive className="size-4" />
                              أرشفة الحساب
                            </button>
                          </div>
                        )}

                        {profile.status === "ARCHIVED" && (
                          <button
                            type="button"
                            onClick={() => setConfirm("ACTIVE")}
                            className="flex items-center gap-1.5 rounded-xl bg-coptic-gold-soft px-3 py-2 text-sm font-medium text-coptic-gold transition-colors hover:bg-coptic-gold-soft/70"
                          >
                            <Power className="size-4" />
                            إلغاء الأرشفة
                          </button>
                        )}
                      </div>
                    </div>
                  ) : null}
            </div>
          ) : null}

          {tab === "attendance" ? (
            <div className="rounded-2xl bg-card shadow-sm ring-1 ring-foreground/5">
              <div className="border-b border-border px-4 py-3">
                <p className="font-heading font-bold">سجل الحضور</p>
              </div>
              {attendance.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  لسه مفيش حضور مسجل
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {attendance.map((a) => (
                    <div key={a.id} className="flex items-center justify-between px-4 py-3 text-sm">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <QrCode className="size-4" />
                        حضور
                      </span>
                      <span className="font-medium">{formatArabicDateTime(a.attended_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {tab === "scores" ? (
            <div className="rounded-2xl bg-card shadow-sm ring-1 ring-foreground/5">
              <div className="border-b border-border px-4 py-3">
                <p className="font-heading font-bold">الدرجات</p>
              </div>
              {scores.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  لسه مفيش درجات مسجلة
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {scores.map((s) => (
                    <div key={s.id} className="flex items-center justify-between px-4 py-3 text-sm">
                      <div>
                        <p className="font-medium">
                          {SCORING_CATEGORY_LABELS[s.category as ScoringCategory] ?? s.category}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatArabicDate(s.session_date)}
                        </p>
                      </div>
                      <span className="rounded-full bg-coptic-gold-soft px-3 py-1 font-bold text-coptic-gold">
                        +{s.points}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </>
      )}

      {confirmDialog ? (
        <AlertDialog open onOpenChange={() => setConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia
                className={
                  confirmDialog.destructive
                    ? "bg-destructive/10 text-destructive"
                    : "bg-coptic-gold-soft text-coptic-gold"
                }
              >
                {confirmDialog.destructive ? (
                  <Archive className="size-6" />
                ) : (
                  <Power className="size-6" />
                )}
              </AlertDialogMedia>
              <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
              <AlertDialogDescription>{confirmDialog.desc}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>إلغاء</AlertDialogCancel>
              <AlertDialogAction
                variant={confirmDialog.destructive ? "destructive" : "default"}
                disabled={pending}
                onClick={() => handleStatus(confirmDialog.status)}
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {confirmDialog.action}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  )
}

function InfoRow({
  icon,
  label,
  value,
  dir,
}: {
  icon: React.ReactNode
  label: string
  value: string
  dir?: "ltr"
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 text-sm last:border-0">
      <span className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-medium" dir={dir}>
        {value}
      </span>
    </div>
  )
}