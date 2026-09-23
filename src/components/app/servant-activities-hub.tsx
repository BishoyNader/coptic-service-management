"use client"

import { useCallback, useState } from "react"
import { Loader2, Users } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ServantMyDay } from "@/components/app/servant-my-day"
import { ServantScoringBoard } from "@/components/app/servant-scoring-board"
import { getServantDayDataAction } from "@/app/actions/servant-activities"
import type { ServantDayData } from "@/services/servant-day-service"
import type { ScoringBoardData } from "@/services/member-scoring-service"

export type HubServant = { id: string; fullName: string }

/**
 * Servant "الأنشطة" hub — the single 2-tab desk for a servant's own day and
 * for the served-members scoring board.
 *
 *  - "نشاطي" (servants) / "الخدام" (super-admin): the subject servant's own
 *    attendance + activity panel. A super admin picks an active servant and
 *    records attendance and activities on their behalf.
 *  - "المخدومين": the embedded unified scoring board for served members.
 *
 * All day-desk writes go through servant/super-admin-gated server actions; the
 * hub only re-fetches the subject's desk from the server after a mutation.
 */
export function ServantActivitiesHub({
  currentUserId,
  isSuperAdmin,
  cairoToday,
  fridays,
  servants,
  initialServantId,
  initialDay,
  initialBoard,
}: {
  currentUserId: string
  isSuperAdmin: boolean
  cairoToday: string
  /** Selectable past ministry Fridays (newest-first) for servant activities. */
  fridays: string[]
  servants: HubServant[]
  initialServantId: string | null
  initialDay: ServantDayData | null
  initialBoard: ScoringBoardData
}) {
  const [tab, setTab] = useState<"own" | "members">("own")

  const [subjectId, setSubjectId] = useState<string | null>(initialServantId)
  const [day, setDay] = useState<ServantDayData | null>(initialDay)
  const [loadingDay, setLoadingDay] = useState(false)

  const reloadDay = useCallback(
    async (servantId: string) => {
      setLoadingDay(true)
      const res = await getServantDayDataAction(servantId)
      setLoadingDay(false)
      if (res.ok) {
        setDay(res.data)
        setSubjectId(res.data.servantId)
      } else {
        setDay(null)
      }
    },
    []
  )

  const handleServantChange = (servantId: string) => {
    if (!servantId) return
    void reloadDay(servantId)
  }

  const handleChanged = () => {
    if (subjectId) void reloadDay(subjectId)
  }

  const ownTabLabel = isSuperAdmin ? "الخدام" : "نشاطي"

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as "own" | "members")} className="w-full">
      <TabsList className="w-full">
        <TabsTrigger value="own" data-testid="hub-tab-own" className="flex-1">
          {ownTabLabel}
        </TabsTrigger>
        <TabsTrigger value="members" data-testid="hub-tab-members" className="flex-1">
          المخدومين
        </TabsTrigger>
      </TabsList>

      <TabsContent value="own" className="mt-4 space-y-4">
        {isSuperAdmin && servants.length > 0 && (
          <label className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium text-muted-foreground">سجّل لخادم:</span>
            <select
              data-testid="servant-picker"
              value={subjectId ?? ""}
              onChange={(e) => handleServantChange(e.target.value)}
              disabled={loadingDay}
              className="rounded-lg border bg-card px-3 py-2 text-sm"
            >
              {servants.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </select>
          </label>
        )}

        {loadingDay ? (
          <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            جاري تحميل سجل الخادم…
          </div>
        ) : day && subjectId ? (
          <ServantMyDay
            profileId={subjectId}
            servantId={subjectId}
            cairoToday={cairoToday}
            fridays={fridays}
            todayAttendance={day.todayAttendance}
            recentAttendance={day.recentAttendance}
            activities={day.activities}
            history={day.history}
            embedded
            showAttendance={!isSuperAdmin}
            readOnly={!isSuperAdmin}
            onChanged={handleChanged}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-10 text-center text-sm text-muted-foreground">
            <Users className="size-6" />
            لا يوجد خادم نشط للعرض
          </div>
        )}
      </TabsContent>

      <TabsContent value="members" className="mt-4">
        <ServantScoringBoard
          currentUserId={currentUserId}
          cairoToday={cairoToday}
          initialBoard={initialBoard}
          embedded
          allowRemoveAny={isSuperAdmin}
        />
      </TabsContent>
    </Tabs>
  )
}