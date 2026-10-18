"use client"

/**
 * Tic Tac Toe UI — plays against the computer (3 levels) or against another
 * online player. Logic lives in `@/lib/games/tic-tac-toe`; multiplayer just
 * mirrors every move over the room channel.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Cpu, Flag, RotateCcw, Trophy, User, LogOut, X, Circle } from "lucide-react"
import { cn } from "cn"
import {
  chooseTttMove,
  emptyBoard,
  isFull,
  winnerOf,
  TTT_LEVEL_LABELS,
  type TttBoard,
  type TttLevel,
  type TttMark,
} from "@/lib/games/tic-tac-toe"
import { Button } from "@/components/ui/button"
import type { GameEvent } from "./use-multiplayer"

type Props =
  | {
      mode: "ai"
      level: TttLevel
      onExit: () => void
    }
  | {
      mode: "online"
      myMark: TttMark
      opponentName: string
      opponentLeft: boolean
      sendEvent: (ev: GameEvent) => Promise<void>
      registerSink: (fn: ((ev: GameEvent) => void) | null) => void
      onLeave: () => void
    }

type Outcome = "win" | "loss" | "draw"

const WIN_ANIM = "animate-[pulse_1.2s_ease-in-out_infinite]"

export function TttGame(props: Props) {
  const aiLevel = props.mode === "ai" ? props.level : null
  const myMark: TttMark = props.mode === "ai" ? "X" : props.myMark
  const opponentName =
    props.mode === "ai" ? `الكمبيوتر — ${TTT_LEVEL_LABELS[aiLevel!]}` : props.opponentName

  const [board, setBoard] = useState<TttBoard>(() => emptyBoard())
  const [forfeit, setForfeit] = useState<Outcome | null>(null) // resignation / disconnect
  const [tally, setTally] = useState({ wins: 0, draws: 0, losses: 0 })

  // Non-null only in online mode; stable identity, unlike the `props` object.
  const sendEvent = props.mode === "online" ? props.sendEvent : null

  // Mirror of `forfeit` readable from long-lived handlers (event sinks).
  const forfeitRef = useRef<Outcome | null>(null)
  useEffect(() => {
    forfeitRef.current = forfeit
  }, [forfeit])

  const win = useMemo(() => winnerOf(board), [board])
  const full = isFull(board)

  // The outcome is derived, never stored, so it can never double-count.
  const outcome: Outcome | null = win
    ? win.mark === myMark
      ? "win"
      : "loss"
    : full
      ? "draw"
      : forfeit
  const finished = outcome !== null
  const myTurn = !finished && turnOf(board) === myMark

  const countResult = useCallback((result: Outcome) => {
    setTally((t) => ({
      wins: t.wins + (result === "win" ? 1 : 0),
      draws: t.draws + (result === "draw" ? 1 : 0),
      losses: t.losses + (result === "loss" ? 1 : 0),
    }))
  }, [])

  /** Count a terminal position exactly once, as it becomes terminal. */
  const settle = useCallback(
    (b: TttBoard) => {
      const w = winnerOf(b)
      if (w) countResult(w.mark === myMark ? "win" : "loss")
      else if (isFull(b)) countResult("draw")
    },
    [myMark, countResult]
  )

  const place = useCallback(
    (idx: number, mark: TttMark, mirror: boolean) => {
      if (board[idx] || finished) return
      const next = board.slice()
      next[idx] = mark
      setBoard(next)
      settle(next)
      if (sendEvent && !mirror) {
        void sendEvent({ type: "move", data: { idx, mark } })
      }
    },
    [board, finished, sendEvent, settle]
  )

  /* ---------------- AI opponent ---------------- */
  useEffect(() => {
    if (props.mode !== "ai" || !aiLevel || finished) return
    if (turnOf(board) === myMark) return
    // Small delay so the move feels deliberate (and the UI can paint).
    const timer = setTimeout(() => {
      const idx = chooseTttMove(board.slice(), "O", aiLevel)
      if (idx >= 0) place(idx, "O", true)
    }, 300)
    return () => clearTimeout(timer)
  }, [board, finished, myMark, aiLevel, props.mode, place])

  /* ---------------- Online event sink ---------------- */
  useEffect(() => {
    if (props.mode !== "online") return
    const sink = (ev: GameEvent) => {
      if (ev.type === "move") {
        const { idx, mark } = ev.data as { idx: number; mark: TttMark }
        place(idx, mark, true)
      } else if (ev.type === "restart") {
        setBoard(emptyBoard())
        setForfeit(null)
      } else if (ev.type === "resign") {
        // The opponent resigned (or vanished from the room) — I win.
        if (forfeitRef.current === null) {
          forfeitRef.current = "win"
          setForfeit("win")
          countResult("win")
        }
      }
    }
    props.registerSink(sink)
    return () => props.registerSink(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode, place, countResult])

  const restart = useCallback(() => {
    setBoard(emptyBoard())
    setForfeit(null)
    if (sendEvent) void sendEvent({ type: "restart" })
  }, [sendEvent])

  const resign = useCallback(() => {
    if (forfeitRef.current !== null || finished) return
    const result: Outcome = myMark === "X" ? "loss" : "win"
    forfeitRef.current = result
    setForfeit(result)
    countResult(result)
    if (sendEvent) void sendEvent({ type: "resign" })
  }, [myMark, sendEvent, countResult, finished])

  return (
    <div className="space-y-4">
      {/* Opponent */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PlayerChip
          icon={props.mode === "ai" ? <Cpu className="size-4" /> : <User className="size-4" />}
          name={opponentName}
          mark={props.mode === "ai" ? "O" : myMark === "X" ? "O" : "X"}
          active={!finished && turnOf(board) !== myMark}
        />
        <Tally tally={tally} />
      </div>

      {/* Board */}
      <div className="relative mx-auto grid aspect-square w-full max-w-[min(80vw,22rem)] grid-cols-3 grid-rows-3 gap-2.5 rounded-3xl bg-gradient-to-br from-coptic-teal/15 to-coptic-gold-soft/40 p-2.5 shadow-lg ring-1 ring-foreground/10">
        {board.map((cell, idx) => {
          const isWinCell = win?.line.includes(idx)
          return (
            <button
              key={idx}
              type="button"
              disabled={finished || !myTurn || Boolean(cell)}
              onClick={() => place(idx, myMark, false)}
              aria-label={`خانة ${idx + 1}`}
              className={cn(
                "flex items-center justify-center rounded-2xl bg-card shadow-sm ring-1 ring-foreground/5 transition-all",
                !cell && !finished && myTurn
                  ? "cursor-pointer hover:scale-105 hover:bg-secondary/70 hover:shadow-md active:scale-95"
                  : "cursor-default",
                isWinCell && "bg-coptic-gold-soft ring-2 ring-coptic-gold",
                isWinCell && WIN_ANIM
              )}
            >
              {cell === "X" ? (
                <X className="size-3/5 stroke-[3] text-coptic-teal drop-shadow-sm" />
              ) : cell === "O" ? (
                <Circle className="size-3/5 stroke-[3] text-coptic-gold drop-shadow-sm" />
              ) : null}
            </button>
          )
        })}

        {/* Game over overlay */}
        {finished ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-3xl bg-black/45 backdrop-blur-[2px]">
            <div className="mx-5 rounded-2xl bg-card p-5 text-center shadow-xl ring-1 ring-foreground/10" dir="rtl">
              <Trophy className="mx-auto mb-2 size-8 text-coptic-gold" />
              <p className="font-heading text-lg font-extrabold">{title(outcome, forfeit)}</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button size="sm" onClick={restart}>
                  <RotateCcw className="size-4" />
                  لعبة جديدة
                </Button>
                <Button size="sm" variant="outline" onClick={props.mode === "online" ? props.onLeave : props.onExit}>
                  <LogOut className="size-4" />
                  خروج
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Player + actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PlayerChip icon={<User className="size-4" />} name="أنت" mark={myMark} active={!finished && turnOf(board) === myMark} />
        <div className="ms-auto flex gap-1.5">
          {!finished ? (
            <Button size="sm" variant="outline" onClick={resign}>
              <Flag className="size-4" />
              استسلام
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={restart}>
              <RotateCcw className="size-4" />
              إعادة
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={props.mode === "online" ? props.onLeave : props.onExit}>
            <LogOut className="size-4" />
            خروج
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Whose turn is it: whoever placed the fewest marks (X starts). */
function turnOf(board: TttBoard): TttMark {
  const xs = board.filter((c) => c === "X").length
  const os = board.filter((c) => c === "O").length
  return xs <= os ? "X" : "O"
}

function title(outcome: Outcome | null, forfeit: Outcome | null): string {
  if (forfeit === "loss") return "استسلمت — الخصم كسب 💪"
  if (forfeit === "win") return "الخصم استسلم — كسبت! 🎉"
  if (outcome === "win") return "كسبت! 🎉"
  if (outcome === "loss") return "الخصم كسب 💪"
  if (outcome === "draw") return "تعادل 🤝"
  return "انتهت اللعبة"
}

function MarkGlyph({ mark }: { mark: TttMark }) {
  return mark === "X" ? (
    <X className="size-4 stroke-[3] text-coptic-teal" />
  ) : (
    <Circle className="size-4 stroke-[3] text-coptic-gold" />
  )
}

function PlayerChip({
  icon,
  name,
  mark,
  active,
}: {
  icon: ReactNode
  name: string
  mark: TttMark
  active: boolean
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-2xl px-3 py-2 text-sm font-semibold transition-colors",
        active ? "bg-coptic-teal/15 text-coptic-teal" : "bg-secondary text-muted-foreground"
      )}
    >
      {active ? (
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-coptic-teal opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-coptic-teal" />
        </span>
      ) : null}
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{name}</span>
      <MarkGlyph mark={mark} />
    </div>
  )
}

function Tally({ tally }: { tally: { wins: number; draws: number; losses: number } }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-bold tabular-nums">
      <span className="rounded-xl bg-coptic-teal/15 px-2 py-1 text-coptic-teal">{tally.wins}</span>
      <span className="rounded-xl bg-secondary px-2 py-1 text-muted-foreground">{tally.draws}</span>
      <span className="rounded-xl bg-coptic-gold-soft px-2 py-1 text-coptic-gold">{tally.losses}</span>
    </div>
  )
}
