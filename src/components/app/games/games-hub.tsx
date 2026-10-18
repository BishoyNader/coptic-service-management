"use client"

/**
 * Games hub shared by the servant and served-member dashboards.
 *
 *  1. Pick a game: Chess or Tic Tac Toe.
 *  2. Pick a mode: against the computer (3 levels) or against another user
 *     who is currently online.
 *  3. In online mode, challenge someone from the live presence list and the
 *     game starts as soon as they accept.
 */

import { useState } from "react"
import {
  Crown,
  Grid3x3,
  Cpu,
  Users,
  Swords,
  Wifi,
  WifiOff,
  UserPlus,
  Check,
  X,
  Hourglass,
  Loader2,
  ChevronLeft,
} from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { CHESS_LEVEL_LABELS, type ChessLevel } from "@/lib/games/chess-engine"
import { TTT_LEVEL_LABELS, type TttLevel } from "@/lib/games/tic-tac-toe"
import { useMultiplayer, type GameKind } from "./use-multiplayer"
import { ChessGame } from "./chess-game"
import { TttGame } from "./tic-tac-toe-game"

type GameTab = "chess" | "ttt"
type Mode = "ai" | "online"

const GAMES: Array<{
  id: GameTab
  label: string
  icon: React.ReactNode
  gradient: string
  blurb: string
}> = [
  {
    id: "chess",
    label: "الشطرنج",
    icon: <Crown className="size-7" />,
    gradient: "from-coptic-teal to-coptic-teal-deep",
    blurb: "العب ضد الكمبيوتر أو ضد صديق أونلاين",
  },
  {
    id: "ttt",
    label: "إكس أو",
    icon: <Grid3x3 className="size-7" />,
    gradient: "from-coptic-gold to-[#a37525]",
    blurb: "ثلاثة في صف — بسرعة!",
  },
]

export function GamesHub({ me }: { me: { id: string; name: string } }) {
  const [game, setGame] = useState<GameTab | null>(null)
  const [mode, setMode] = useState<Mode | null>(null)
  const [aiStarted, setAiStarted] = useState(false)
  const [chessLevel, setChessLevel] = useState<ChessLevel>("intermediate")
  const [tttLevel, setTttLevel] = useState<TttLevel>("intermediate")

  const mp = useMultiplayer(me)

  const inGame = Boolean(mp.room)

  const backToLobby = () => {
    mp.leaveRoom()
    setMode(null)
    setGame(null)
    setAiStarted(false)
  }

  const kind: GameKind | null = game === "chess" ? "chess" : game === "ttt" ? "ttt" : null

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-bl from-coptic-teal via-coptic-teal to-coptic-teal-deep p-5 text-primary-foreground">
        <div className="pointer-events-none absolute inset-0 coptic-lattice-gold opacity-50" />
        <div className="relative flex items-center justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-extrabold">الألعاب 🎮</h1>
            <p className="text-sm text-primary-foreground/85">
              العب شطرنج أو إكس أو مع أصحابك
            </p>
          </div>
          <Swords className="size-10 shrink-0 opacity-80" />
        </div>
      </div>

      {/* ================= Active online game ================= */}
      {inGame && mp.room ? (
        <div className="rounded-3xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
          {mp.room.game === "chess" ? (
            <ChessGame
              mode="online"
              myColor={mp.room.isChallenger ? "w" : "b"}
              opponentName={mp.room.opponent.name}
              opponentLeft={mp.opponentLeft}
              sendEvent={mp.sendGameEvent}
              registerSink={mp.registerEventSink}
              onLeave={backToLobby}
            />
          ) : (
            <TttGame
              mode="online"
              myMark={mp.room.isChallenger ? "X" : "O"}
              opponentName={mp.room.opponent.name}
              opponentLeft={mp.opponentLeft}
              sendEvent={mp.sendGameEvent}
              registerSink={mp.registerEventSink}
              onLeave={backToLobby}
            />
          )}
        </div>
      ) : (
        <>
          {/* ================= Game picker ================= */}
          {!game ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {GAMES.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGame(g.id)}
                  className={cn(
                    "group relative overflow-hidden rounded-3xl bg-gradient-to-br p-5 text-start text-primary-foreground shadow-md transition-transform hover:scale-[1.02] active:scale-[0.98]",
                    g.gradient
                  )}
                >
                  <div className="pointer-events-none absolute inset-0 coptic-lattice-gold opacity-40" />
                  <div className="relative flex items-center gap-3">
                    <span className="flex size-14 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
                      {g.icon}
                    </span>
                    <span>
                      <span className="block font-heading text-xl font-extrabold">{g.label}</span>
                      <span className="block text-xs text-primary-foreground/85">{g.blurb}</span>
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          {/* ================= Mode picker / lobby ================= */}
          {game && kind ? (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setGame(null)}
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="size-4 rotate-180" />
                تغيير اللعبة
              </button>

              {!mode ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <ModeCard
                    icon={<Cpu className="size-7" />}
                    title="ضد الكمبيوتر"
                    blurb="اختار المستوى واعرف"
                    onClick={() => {
                      setMode("ai")
                    }}
                    testid="mode-ai"
                  />
                  <ModeCard
                    icon={<Users className="size-7" />}
                    title="ضد صديق"
                    blurb="تحدّي حد أونلاين دلوقتي"
                    onClick={() => setMode("online")}
                    testid="mode-online"
                  />
                </div>
              ) : null}

              {/* ================= AI mode ================= */}
              {mode === "ai" && !aiStarted ? (
                <AiSetup
                  kind={kind}
                  chessLevel={chessLevel}
                  tttLevel={tttLevel}
                  onChessLevel={setChessLevel}
                  onTttLevel={setTttLevel}
                  onStart={() => setAiStarted(true)}
                  onBack={() => setMode(null)}
                />
              ) : null}

              {/* ================= Online lobby ================= */}
              {mode === "online" ? (
                <OnlineLobby mp={mp} game={kind} onBack={() => setMode(null)} />
              ) : null}
            </div>
          ) : null}

          {/* ================= AI game board ================= */}
          {mode === "ai" && aiStarted && game ? (
            <div className="rounded-3xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
              {game === "chess" ? (
                <ChessGame
                  mode="ai"
                  level={chessLevel}
                  onExit={() => {
                    setAiStarted(false)
                    setMode(null)
                  }}
                />
              ) : (
                <TttGame
                  mode="ai"
                  level={tttLevel}
                  onExit={() => {
                    setAiStarted(false)
                    setMode(null)
                  }}
                />
              )}
            </div>
          ) : null}
        </>
      )}

      {/* ================= Incoming challenge dialog ================= */}
      <Dialog
        open={Boolean(mp.incoming)}
        onOpenChange={(open) => {
          if (!open) void mp.respondToChallenge(false)
        }}
      >
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="size-5 text-coptic-teal" />
              تحدٍّ جديد!
            </DialogTitle>
            <DialogDescription>
              {mp.incoming?.from.name} بيدعوتك تلعب{" "}
              {mp.incoming?.game === "chess" ? "شطرنج" : "إكس أو"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => void mp.respondToChallenge(false)}>
              <X className="size-4" />
              رفض
            </Button>
            <Button onClick={() => void mp.respondToChallenge(true)}>
              <Check className="size-4" />
              قبول
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function ModeCard({
  icon,
  title,
  blurb,
  onClick,
  testid,
}: {
  icon: React.ReactNode
  title: string
  blurb: string
  onClick: () => void
  testid: string
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      className="flex items-center gap-3 rounded-3xl bg-card p-5 text-start shadow-sm ring-1 ring-foreground/5 transition-all hover:bg-secondary/50 hover:shadow-md active:scale-[0.98]"
    >
      <span className="flex size-14 items-center justify-center rounded-2xl bg-coptic-teal/10 text-coptic-teal">
        {icon}
      </span>
      <span>
        <span className="block font-heading text-lg font-bold">{title}</span>
        <span className="block text-xs text-muted-foreground">{blurb}</span>
      </span>
    </button>
  )
}

function AiSetup({
  kind,
  chessLevel,
  tttLevel,
  onChessLevel,
  onTttLevel,
  onStart,
  onBack,
}: {
  kind: GameKind
  chessLevel: ChessLevel
  tttLevel: TttLevel
  onChessLevel: (l: ChessLevel) => void
  onTttLevel: (l: TttLevel) => void
  onStart: () => void
  onBack: () => void
}) {
  const level = kind === "chess" ? chessLevel : tttLevel
  const setLevel = kind === "chess" ? onChessLevel : onTttLevel
  const labels = kind === "chess" ? CHESS_LEVEL_LABELS : TTT_LEVEL_LABELS
  const options = Object.keys(labels) as Array<ChessLevel & TttLevel>

  const blurbs: Record<ChessLevel, string> = {
    beginner: "الكمبيوتر بيلعب عشوائي — مناسب للبداية",
    intermediate: "بيفكّر نقلتين لقدام — تحدٍّ متوسط",
    professional: "بيفكّر بعمق ومش سهل تكسبه!",
  }

  return (
    <div className="space-y-4">
      <div className="rounded-3xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
        <p className="mb-3 font-heading font-bold">اختار المستوى</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setLevel(opt)}
              className={cn(
                "rounded-2xl border-2 p-3 text-center transition-all",
                level === opt
                  ? "border-coptic-teal bg-coptic-teal/10 text-coptic-teal shadow-sm"
                  : "border-transparent bg-secondary/60 text-muted-foreground hover:bg-secondary"
              )}
            >
              <span className="block font-heading font-bold">{labels[opt]}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">{blurbs[level]}</p>
      </div>

      <div className="flex gap-2">
        <Button className="flex-1" onClick={onStart}>
          <Swords className="size-4" />
          ابدأ اللعب
        </Button>
        <Button variant="outline" onClick={onBack}>
          رجوع
        </Button>
      </div>
    </div>
  )
}

function OnlineLobby({
  mp,
  game,
  onBack,
}: {
  mp: ReturnType<typeof useMultiplayer>
  game: GameKind
  onBack: () => void
}) {
  const [challengeFor, setChallengeFor] = useState<string | null>(null)
  const gameLabel = game === "chess" ? "الشطرنج" : "إكس أو"

  const pendingTarget = mp.outgoing?.to

  const send = async (userId: string, name: string) => {
    setChallengeFor(null)
    await mp.challenge({ id: userId, name }, game)
  }

  return (
    <div className="space-y-4">
      {/* Connection status */}
      <div
        className={cn(
          "flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium",
          mp.connected
            ? "bg-coptic-teal/10 text-coptic-teal"
            : "bg-destructive/10 text-destructive"
        )}
      >
        {mp.connected ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
        {mp.connected ? "متصل — دوّر على أصحابك اللي أونلاين" : "جارٍ الاتصال بالخادم…"}
        <span className="ms-auto rounded-full bg-background/60 px-2 py-0.5 text-xs font-bold tabular-nums">
          {mp.onlineUsers.length}
        </span>
      </div>

      {/* Pending challenge banner */}
      {pendingTarget ? (
        <div className="flex items-center gap-3 rounded-2xl bg-coptic-gold-soft p-4 text-sm">
          <Hourglass className="size-5 shrink-0 animate-pulse text-coptic-gold" />
          <span className="font-medium">
            بستنى رد {pendingTarget.name}…
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="ms-auto"
            onClick={() => void mp.cancelChallenge()}
          >
            إلغاء
          </Button>
        </div>
      ) : null}

      {/* Online users */}
      <div className="rounded-3xl bg-card p-4 shadow-sm ring-1 ring-foreground/5">
        <p className="mb-3 font-heading font-bold">الأونلاين دلوقتي</p>
        {mp.onlineUsers.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {mp.connected
              ? "مفيش حد أونلاين دلوقتي — جرّب بعدين!"
              : <span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> جارٍ التحميل…</span>}
          </div>
        ) : (
          <ul className="space-y-2">
            {mp.onlineUsers.map((u) => (
              <li
                key={u.id}
                className="flex items-center gap-3 rounded-2xl bg-secondary/50 p-3 transition-colors hover:bg-secondary"
              >
                <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-coptic-teal/15 font-heading font-bold text-coptic-teal">
                  {u.name.trim().charAt(0) || "؟"}
                  <span className="absolute -bottom-0.5 -end-0.5 size-3 rounded-full border-2 border-card bg-coptic-teal" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{u.name}</span>
                <Button
                  size="sm"
                  disabled={Boolean(mp.outgoing) && mp.outgoing?.to.id !== u.id}
                  onClick={() => setChallengeFor(u.id)}
                >
                  <Swords className="size-4" />
                  تحدَّ
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button variant="outline" onClick={onBack}>
        رجوع
      </Button>

      {/* Confirm challenge */}
      <Dialog
        open={Boolean(challengeFor)}
        onOpenChange={(open) => {
          if (!open) setChallengeFor(null)
        }}
      >
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>تحدّي {mp.onlineUsers.find((u) => u.id === challengeFor)?.name}؟</DialogTitle>
            <DialogDescription>هتبدأ لعبة {gameLabel} أول ما يوافق.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setChallengeFor(null)}>
              إلغاء
            </Button>
            <Button
              onClick={() => {
                const u = mp.onlineUsers.find((x) => x.id === challengeFor)
                if (u) void send(u.id, u.name)
              }}
            >
              <Swords className="size-4" />
              ابعت التحدي
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
