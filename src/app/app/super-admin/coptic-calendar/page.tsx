import { getCopticCalendarDay, getUpcomingFeasts } from "@/services/coptic-calendar-service"
import { CopticCalendarPage } from "@/components/coptic/coptic-calendar-page"
import { cairoDateString } from "@/lib/cairo"
import { notifyUpcomingFeasts } from "./notification"

export const metadata = {
  title: "التقويم القبطي",
}

export default async function CopticCalendarRoutePage() {
  // Use the project's canonical Cairo date utility — never trust arbitrary
  // local timezone or fragile toLocaleString/toISOString conversion.
  const isoToday = cairoDateString(new Date())

  const [todayResult, upcomingResult] = await Promise.all([
    getCopticCalendarDay(undefined, isoToday),
    getUpcomingFeasts(7),
  ])

  return (
    <CopticCalendarPage
      today={isoToday}
      result={todayResult}
      upcomingResult={upcomingResult}
      notifyAction={notifyUpcomingFeasts}
    />
  )
}
