"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FridayAttendanceGrid } from "./friday-attendance-grid"
import { FridayMinistryView } from "./friday-ministry-view"
import type {
  FridayAttendanceGrid as FridayAttendanceGridData,
  FridayMinistryData,
} from "@/services/friday-service"

/**
 * The Friday-based review dashboard shown to servants and admins: a present /
 * absent attendance grid and the combined ministry view (attendance + served
 * member percentages + servant activities). Both work on ministry Fridays only.
 */
export function FridayDashboard({
  initialGrid,
  initialMinistry,
}: {
  initialGrid: FridayAttendanceGridData
  initialMinistry: FridayMinistryData
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h2 className="font-heading text-lg font-extrabold">متابعة الجمع</h2>
        <p className="text-sm text-muted-foreground">
          الحضور والدرجات وأنشطة الخدام — كلها على نظام الجمَعات
        </p>
      </div>

      <Tabs defaultValue="grid" className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="grid" className="flex-1">
            شبكة الحضور
          </TabsTrigger>
          <TabsTrigger value="ministry" className="flex-1">
            متابعة الخدمة
          </TabsTrigger>
        </TabsList>
        <TabsContent value="grid" className="mt-4">
          <FridayAttendanceGrid initialGrid={initialGrid} />
        </TabsContent>
        <TabsContent value="ministry" className="mt-4">
          <FridayMinistryView initial={initialMinistry} />
        </TabsContent>
      </Tabs>
    </div>
  )
}