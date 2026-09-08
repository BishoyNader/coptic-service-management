import { Church, HeartHandshake, History } from "lucide-react"
import { cn } from "cn"
import { ATTENDANCE_TYPE_LABELS } from "@/lib/constants"
import { formatCairoDateTime } from "@/lib/cairo"
import type { AttendanceType } from "@/lib/types"

export type MemberAttendanceItem = {
  id: string
  attended_at: string
  points: number
  type: AttendanceType
}

type MemberAttendanceListProps = {
  records: MemberAttendanceItem[]
}

/**
 * Mobile-friendly attended history timeline for a served member.
 * Shows type, date/time and earned points. Empty state when nothing recorded.
 */
export function MemberAttendanceList({ records }: MemberAttendanceListProps) {
  if (records.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/60 px-6 py-8 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-coptic-gold-soft text-coptic-gold">
          <History className="size-6" />
        </div>
        <p className="mt-2 font-heading font-semibold text-foreground">لسه مفيش حضور مسجل</p>
        <p className="mt-1 text-sm text-muted-foreground">
          اعرض كود الحضور عند باب الكنيسة وهم يسجلون حضورك على طول
        </p>
      </div>
    )
  }

  return (
    <div className="relative space-y-3">
      <span className="pointer-events-none absolute bottom-4 start-[19px] top-4 w-px bg-border" aria-hidden />
      {records.map((r) => {
        const isChurch = r.type === "CHURCH"
        return (
          <div key={r.id} className="relative flex items-start gap-3">
            <div
              className={cn(
                "relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full ring-4 ring-background",
                isChurch ? "bg-coptic-teal/10 text-coptic-teal" : "bg-coptic-gold-soft text-coptic-gold"
              )}
            >
              {isChurch ? <Church className="size-5" /> : <HeartHandshake className="size-5" />}
            </div>
            <div className="flex flex-1 items-center justify-between gap-2 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5">
              <div className="min-w-0">
                <p className="text-sm font-bold">{ATTENDANCE_TYPE_LABELS[r.type]}</p>
                <p className="text-[11px] text-muted-foreground">
                  {formatCairoDateTime(r.attended_at)}
                </p>
              </div>
              {r.points > 0 ? (
                <span className="shrink-0 rounded-full bg-coptic-gold-soft px-3 py-1 text-xs font-bold text-coptic-gold">
                  +{r.points} نقطة
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                  بدون نقاط
                </span>
              )}
            </div>
          </div>
        )
      })}
      {records.length >= 10 ? (
        <p className="ps-[52px] text-xs text-muted-foreground">
          يعرض أحدث {records.length} مرة حضور
        </p>
      ) : null}
    </div>
  )
}