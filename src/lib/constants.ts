import type { AppRole } from "./roles"

export const APP_NAME = "خدمتي"
export const APP_TAGLINE = "كنيسة القديسين للخدمات"

/** App navigation configuration per role. */
export type NavItem = {
  href: string
  label: string
  icon: string
}

export const MEMBER_NAV: NavItem[] = [
  { href: "/app/member", label: "الرئيسية", icon: "home" },
  { href: "/app/member/qr", label: "QR", icon: "qr" },
  { href: "/app/member/scores", label: "الدرجات", icon: "star" },
  { href: "/app/member/notifications", label: "الإشعارات", icon: "bell" },
  { href: "/app/member/account", label: "حسابي", icon: "user" },
]

export const SERVANT_NAV: NavItem[] = [
  { href: "/app/servant", label: "الرئيسية", icon: "home" },
  { href: "/app/servant/qr", label: "QR", icon: "qr" },
  { href: "/app/servant/activities", label: "الأنشطة", icon: "clipboard" },
  { href: "/app/servant/notifications", label: "الإشعارات", icon: "bell" },
  { href: "/app/servant/account", label: "حسابي", icon: "user" },
]

export const ADMIN_NAV: NavItem[] = [
  { href: "/app/admin", label: "الرئيسية", icon: "home" },
  { href: "/app/admin/attendance", label: "تسجيل حضور", icon: "scan" },
  { href: "/app/admin/members", label: "المخدومين", icon: "users" },
  { href: "/app/admin/scores", label: "الدرجات", icon: "star" },
  { href: "/app/admin/notifications", label: "الإشعارات", icon: "bell" },
  { href: "/app/admin/birthdays", label: "أعياد الميلاد", icon: "cake" },
  { href: "/app/admin/account", label: "حسابي", icon: "user" },
]

export const SUPER_ADMIN_NAV: NavItem[] = [
  { href: "/app/super-admin", label: "الرئيسية", icon: "home" },
  { href: "/app/super-admin/members", label: "المخدومين", icon: "users" },
  { href: "/app/super-admin/servants", label: "الخدام", icon: "hand-helping" },
  { href: "/app/super-admin/attendance", label: "الحضور", icon: "scan" },
  { href: "/app/super-admin/scores", label: "الدرجات", icon: "star" },
  { href: "/app/super-admin/notifications", label: "الإشعارات", icon: "bell" },
  { href: "/app/super-admin/birthdays", label: "أعياد الميلاد", icon: "cake" },
  { href: "/app/super-admin/reports", label: "التقارير", icon: "chart" },
  { href: "/app/super-admin/users", label: "المستخدمين", icon: "shield" },
  { href: "/app/super-admin/audit-log", label: "سجل العمليات", icon: "history" },
  { href: "/app/super-admin/settings", label: "الإعدادات", icon: "settings" },
  { href: "/app/super-admin/account", label: "حسابي", icon: "user" },
]

export function navForRole(role: AppRole): NavItem[] {
  switch (role) {
    case "SERVED_MEMBER":
      return MEMBER_NAV
    case "SERVANT":
      return SERVANT_NAV
    case "ADMIN":
      return ADMIN_NAV
    case "SUPER_ADMIN":
      return SUPER_ADMIN_NAV
  }
}

/**
 * A served member uses every nav item as a bottom tab except this many
 * "overflow" items which move to a menu on small screens.
 */
export const MOBILE_TAB_LIMIT = 5

export const SCORING_CATEGORY_LABELS = {
  CHURCH_ATTENDANCE: "حضور القداس",
  SERVICE_ATTENDANCE: "حضور الخدمة",
  WEEKLY_COMMITMENT: "الالتزام",
  TUNIC: "لبس التونية",
  COMMUNION: "التناول",
  BONUS: "إضافي",
  MONTHLY_ACTIVITY: "نشاط",
  SERVICE_COMMITMENT: "التزام الخدمة",
} as const

export type ScoringCategory = keyof typeof SCORING_CATEGORY_LABELS

/**
 * Attendance contexts, mirroring the `attendance_type` enum values.
 * Adding a future attendance type = add it here + seed a scoring rule for the
 * new category; no component logic needs to change (labels only, the scoring
 * engine reads the active rules from the database).
 */
/** Audience groups an admin can broadcast a notification to. */
export const NOTIFICATION_AUDIENCE_LABELS = {
  SERVED_MEMBER: "المخدومين",
  SERVANT: "الخدام",
  ADMIN: "المسؤولين",
} as const

export const ATTENDANCE_TYPE_LABELS = {
  CHURCH: "حضور القداس",
  SERVICE: "حضور الخدمة",
} as const

/** How an attendance record was created. */
export const ATTENDANCE_SOURCE_LABELS = {
  QR: "QR",
  CODE: "كود يدوي",
  MANUAL: "تسجيل يدوي",
} as const