import { cn } from "cn"
import { Star, CalendarDays, History, Bell } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { NileDivider } from "@/components/coptic/brand"

type StatCardProps = {
  icon: LucideIcon
  label: string
  value: string | number
  hint?: string
  className?: string
  iconClass?: string
}

export function StatCard({ icon: Icon, label, value, hint, className, iconClass }: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-card p-4 shadow-sm ring-1 ring-foreground/5",
        className
      )}
    >
      <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
        <span className={cn("flex size-6 items-center justify-center rounded-lg", iconClass)}>
          <Icon className="size-3.5" />
        </span>
        {label}
      </div>
      <p className="mt-2 font-heading text-2xl font-extrabold text-foreground">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function HomeScoresPreview({ week, month }: { week: number; month: number }) {
  return (
    <section className="space-y-3">
      <NileDivider />
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={Star}
          label="درجات الأسبوع"
          value={week}
          iconClass="bg-coptic-gold-soft text-coptic-gold"
        />
        <StatCard
          icon={CalendarDays}
          label="درجات الشهر"
          value={month}
          iconClass="bg-coptic-teal/10 text-coptic-teal"
        />
        <StatCard
          icon={History}
          label="آخر حضور"
          value="—"
          hint="لم يُسجّل حضور بعد"
          iconClass="bg-secondary text-muted-foreground"
        />
        <StatCard
          icon={Bell}
          label="إشعارات"
          value="0"
          hint="لا توجد إشعارات"
          iconClass="bg-secondary text-muted-foreground"
        />
      </div>
    </section>
  )
}