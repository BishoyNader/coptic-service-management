import type { AppRole } from "./roles"
import type { ScoringCategory } from "./constants"

export type UserStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED"
export type AttendanceType = "CHURCH" | "SERVICE"
export type AttendanceSource = "QR" | "CODE" | "MANUAL"
export type AttendanceStatus = "PRESENT" | "LATE" | "ARCHIVED"

export type Profile = {
  id: string
  role: AppRole
  full_name: string
  phone: string
  auth_email: string | null
  date_of_birth: string | null
  address: string | null
  father_phone: string | null
  mother_phone: string | null
  avatar_url: string | null
  status: UserStatus
  created_at: string
  updated_at: string
}

export type ServedMember = {
  profile_id: string
  notes: string | null
  created_at: string
  updated_at: string
}

export type Servant = {
  profile_id: string
  service_name: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type AdminProfile = {
  profile_id: string
  permissions: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type PersonalCode = {
  id: string
  profile_id: string
  code: string
  qr_token: string
  created_at: string
}

export type AttendanceSession = {
  id: string
  type: AttendanceType
  title: string
  session_date: string
  opened_at: string | null
  closed_at: string | null
  created_by: string | null
  created_at: string
}

export type AttendanceRecord = {
  id: string
  session_id: string | null
  profile_id: string
  attended_at: string
  points: number
  recorded_by: string | null
  source: AttendanceSource
  status: AttendanceStatus
  created_at: string
}

export type ScoringRule = {
  id: string
  category: ScoringCategory
  name: string
  point_value: number
  applicable_role: AppRole[]
  start_time: string | null
  end_time: string | null
  requires_min_days: number | null
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type ScoreRecord = {
  id: string
  profile_id: string
  category: ScoringCategory
  points: number
  rule_id: string | null
  attendance_record_id: string | null
  session_date: string
  note: string | null
  recorded_by: string | null
  created_at: string
}

export type Activity = {
  id: string
  code: string
  name: string
  icon: string | null
  for_role: AppRole
  is_active: boolean
  sort_order: number
  created_at: string
}

export type ServantActivityRecord = {
  id: string
  servant_id: string
  activity_id: string
  recorded_on: string
  recorded_by: string | null
  created_at: string
}

export type Notification = {
  id: string
  title: string
  body: string | null
  audience: AppRole[]
  sender_id: string | null
  created_at: string
}

export type NotificationRecipient = {
  id: string
  notification_id: string
  profile_id: string
  read_at: string | null
  created_at: string
}

export type BirthdayReminder = {
  id: string
  profile_id: string
  reminder_for: string
  created_at: string
}

export type AuditLog = {
  id: string
  actor_id: string | null
  action: string
  entity: string
  entity_id: string | null
  previous: Record<string, unknown> | null
  new: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export type AuthSession =
  | {
      user: {
        id: string
        phone: string
        email?: string | null
      }
    }
  | null
  | undefined

export type RegistrationPayload = {
  role: Extract<AppRole, "SERVED_MEMBER" | "SERVANT">
  fullName: string
  phone: string
  password: string
  dateOfBirth?: string
  address?: string
  fatherPhone?: string
  motherPhone?: string
}