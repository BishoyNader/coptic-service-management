"use client"

import { BarChart3, CalendarCheck2, Star } from "lucide-react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { AttendanceReportPanel } from "./attendance-report"
import { ScoresReportPanel } from "./scores-report"
import { ActivitiesReportPanel } from "./activities-report"

/**
 * Super Admin reports hub — attendance / scores / servant activities.
 * Each panel loads only when its tab becomes active and is super-admin gated
 * by the server page and by every report server action.
 */
export function ReportsView() {
  return (
    <Tabs defaultValue="attendance">
      <TabsList>
        <TabsTrigger value="attendance">
          <BarChart3 />
          الحضور
        </TabsTrigger>
        <TabsTrigger value="scores">
          <Star />
          الدرجات
        </TabsTrigger>
        <TabsTrigger value="activities">
          <CalendarCheck2 />
          الأنشطة
        </TabsTrigger>
      </TabsList>
      <TabsContent value="attendance">
        <AttendanceReportPanel />
      </TabsContent>
      <TabsContent value="scores">
        <ScoresReportPanel />
      </TabsContent>
      <TabsContent value="activities">
        <ActivitiesReportPanel />
      </TabsContent>
    </Tabs>
  )
}
