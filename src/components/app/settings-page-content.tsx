"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScoringRulesSettings } from "@/components/app/scoring-rules-settings"
import { ClassManagerSettings } from "@/components/app/class-manager-settings"
import type { ScoringRule } from "@/lib/types"
import type { ClassRecord } from "@/services/classes-service"

export function SettingsPageContent({
  rules,
  classes,
}: {
  rules: ScoringRule[]
  classes: ClassRecord[]
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-xl font-extrabold">الإعدادات</h1>
        <p className="text-sm text-muted-foreground">مسؤول عام فقط</p>
      </div>

      <Tabs defaultValue="rules">
        <TabsList variant="line">
          <TabsTrigger value="rules">قواعد الدرجات</TabsTrigger>
          <TabsTrigger value="classes">الأصناف</TabsTrigger>
        </TabsList>
        <TabsContent value="rules" className="mt-4">
          <ScoringRulesSettings rules={rules} />
        </TabsContent>
        <TabsContent value="classes" className="mt-4">
          <ClassManagerSettings classes={classes} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
