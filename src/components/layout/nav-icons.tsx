import {
  Home,
  QrCode,
  Star,
  Bell,
  User,
  ScanLine,
  Users,
  Cake,
  BarChart3,
  Shield,
  History,
  Settings,
  HeartHandshake,
  Menu,
  type LucideIcon,
} from "lucide-react"

export const NAV_ICONS: Record<string, LucideIcon> = {
  home: Home,
  qr: QrCode,
  star: Star,
  bell: Bell,
  user: User,
  scan: ScanLine,
  users: Users,
  "hand-helping": HeartHandshake,
  cake: Cake,
  chart: BarChart3,
  shield: Shield,
  history: History,
  settings: Settings,
  menu: Menu,
}

export function navIcon(name: string): LucideIcon {
  return NAV_ICONS[name] ?? Bell
}