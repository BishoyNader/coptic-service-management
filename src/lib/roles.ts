/**
 * Ordered set of application roles.
 * Public registration can only ever create SERVED_MEMBER or SERVANT.
 * SERVANT is the staff/administrative role (it absorbed the former ADMIN
 * role); SUPER_ADMIN is the only privileged role above it and can only be
 * granted by another SUPER_ADMIN.
 */
export const ROLES = {
  SERVED_MEMBER: "SERVED_MEMBER",
  SERVANT: "SERVANT",
  SUPER_ADMIN: "SUPER_ADMIN",
} as const

export type AppRole = (typeof ROLES)[keyof typeof ROLES]

export const ROLE_LABELS: Record<AppRole, string> = {
  SERVED_MEMBER: "مخدوم",
  SERVANT: "خادم",
  SUPER_ADMIN: "مسؤول عام",
}

export const PUBLIC_REGISTRATION_ROLES: readonly AppRole[] = [
  ROLES.SERVED_MEMBER,
  ROLES.SERVANT,
]

/**
 * Staff roles that carry administrative access. Servants are the operational
 * staff; super-admins are the privileged staff above them.
 */
export const STAFF_ROLES: readonly AppRole[] = [ROLES.SERVANT, ROLES.SUPER_ADMIN]

export function isStaffRole(role: AppRole | null | undefined): boolean {
  return role === ROLES.SERVANT || role === ROLES.SUPER_ADMIN
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
