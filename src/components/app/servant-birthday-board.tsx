"use client"

import { Cake, HandHelping, Users } from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { BIRTHDAY_WINDOW_DAYS, type UpcomingBirthday } from "@/services/birthday-service"
import { formatArabicDate } from "@/lib/dates"
import { EmptyState } from "@/components/coptic/empty-state"

/**
 * Servant-facing upcoming-birthday board. Two independent, clearly separated
 * lists: servant birthdays and served-member birthdays, each filtered by the
 * server to ACTIVE profiles with a DOB within the next 30 Cairo calendar
 * days. Servants can only ever see name + birthday date/day — no phones,
 * auth IDs, QR tokens or addresses are exposed.
 */
export function ServantBirthdayBoard({
  servants,
  members,
}: {
  servants: UpcomingBirthday[]
  members: UpcomingBirthday[]
}) {
  return (
    <Tabs defaultValue="servants">
      <TabsList>
        <TabsTrigger value="servants">
          <HandHelping />
          الخدام
        </TabsTrigger>
        <TabsTrigger value="members">
          <Users />
          المخدومين
        </TabsTrigger>
      </TabsList>

      <TabsContent value="servants" className="mt-4">
        <section className="space-y-2">
          <h2 className="font-heading text-sm font-bold text-muted-foreground">
            خدام أعياد ميلادهم القادمة خلال {BIRTHDAY_WINDOW_DAYS} يومًا
          </h2>
          {servants.length === 0 ? (
            <EmptyState
              icon={<Cake className="size-7" />}
              title="لا توجد أعياد قريبة للخدام"
              description="أعياد ميلاد الخدام القادمة خلال 30 يوم هتظهر هنا"
            />
          ) : (
            <div className="space-y-2">
              {servants.map((r) => (
                <BirthdayRow key={r.id} row={r} />
              ))}
            </div>
          )}
        </section>
      </TabsContent>

      <TabsContent value="members" className="mt-4">
        <section className="space-y-2">
          <h2 className="font-heading text-sm font-bold text-muted-foreground">
            مخدومين أعياد ميلادهم القادمة خلال {BIRTHDAY_WINDOW_DAYS} يومًا
          </h2>
          {members.length === 0 ? (
            <EmptyState
              icon={<Cake className="size-7" />}
              title="لا توجد أعياد قريبة للمخدومين"
              description="أعياد ميلاد المخدومين القادمة خلال 30 يوم هتظهر هنا"
            />
          ) : (
            <div className="space-y-2">
              {members.map((r) => (
                <BirthdayRow key={r.id} row={r} />
              ))}
            </div>
          )}
        </section>
      </TabsContent>
    </Tabs>
  )
}

function BirthdayRow({ row }: { row: UpcomingBirthday }) {
  return (
    <div
      data-testid="birthday-row"
      className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-sm ring-1 ring-foreground/5"
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-coptic-gold-soft">
        <Cake className="size-5 text-coptic-gold" />
      </div>
      <div className="flex-1">
        <p className="font-medium">🎂 {row.name}</p>
        <p className="text-[11px] text-muted-foreground">
          {row.days === 0 ? "عيد ميلاده النهاردة 🎉" : `بعد ${row.days} يوم`} —{" "}
          {formatArabicDate(row.dateOfBirth)}
        </p>
      </div>
      {row.alreadySent ? (
        <span className="rounded-full bg-coptic-teal/10 px-2.5 py-1 text-[11px] font-semibold text-coptic-teal">
          ✓ تم إرسال التهنئة
        </span>
      ) : null}
    </div>
  )
}