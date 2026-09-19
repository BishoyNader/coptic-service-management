"use client"

import { ScoringRulesSettings } from "@/components/app/scoring-rules-settings"
import type { ScoringRule } from "@/lib/types"

export function SettingsPageContent({
  rules,
}: {
  rules: ScoringRule[]
}) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-xl font-extrabold">الإعدادات</h1>
        <p className="text-sm text-muted-foreground">مسؤول عام فقط</p>
      </div>

      <ScoringRulesSettings rules={rules} />
    </div>
  )
}
