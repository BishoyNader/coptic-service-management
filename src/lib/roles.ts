/**
 * Ordered set of application roles.
 * Public registration can only ever create SERVED_MEMBER or SERVANT.
 * ADMIN / SUPER_ADMIN accounts are created by authorized administrators.
 */
export const ROLES = {
  SERVED_MEMBER: "SERVED_MEMBER",
  SERVANT: "SERVANT",
  ADMIN: "ADMIN",
  SUPER_ADMIN: "SUPER_ADMIN",
} as const

export type AppRole = (typeof ROLES)[keyof typeof ROLES]

export const ROLE_LABELS: Record<AppRole, string> = {
  SERVED_MEMBER: "مخدوم",
  SERVANT: "خادم",
  ADMIN: "مسؤول خدمة",
  SUPER_ADMIN: "مسؤول عام",
}

export const PUBLIC_REGISTRATION_ROLES: readonly AppRole[] = [
  ROLES.SERVED_MEMBER,
  ROLES.SERVANT,
]

export const ADMIN_ROLES: readonly AppRole[] = [ROLES.ADMIN, ROLES.SUPER_ADMIN]

export function isAdminRole(role: AppRole | null | undefined): boolean {
  return role === ROLES.ADMIN || role === ROLES.SUPER_ADMIN
}

export function hasRole(
  role: AppRole | null | undefined,
  required: AppRole
): boolean {
  if (!role) return false
  if (role === ROLES.SUPER_ADMIN) return true
  return role === required
}

/** Derive the app home path for a role. */
export function roleHomePath(role: AppRole): string {
  switch (role) {
    case ROLES.SERVED_MEMBER:
      return "/app/member"
    case ROLES.SERVANT:
      return "/app/servant"
    case ROLES.ADMIN:
      return "/app/admin"
    case ROLES.SUPER_ADMIN:
      return "/app/super-admin"
  }
}

const codeAlphabetDigits = "0123456789"

/**
 * Generates a short numeric personal code.
 * The caller is responsible for checking uniqueness against the DB.
 */
export function generatePersonalCode(): string {
  const length = 6
  let code = ""
  for (let i = 0; i < length; i++) {
    code += codeAlphabetDigits[Math.floor(Math.random() * 10)]
  }
  return code
}

/**
 * Generates a cryptographically secure QR token. The token itself carries
 * no personal information — it is only a random capability identifier.
 */
export function generateQrToken(): string {
  return crypto.randomUUID()
}