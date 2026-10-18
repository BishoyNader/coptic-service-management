"use client"

/**
 * Chess board UI — plays against the computer (3 levels) or against another
 * online player. All rules run through the shared engine in
 * `@/lib/games/chess-engine`; multiplayer just mirrors every move over the
 * room channel.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Cpu, Flag, RotateCcw, Crown, User, LogOut, Loader2 } from "lucide-react"
import { cn } from "cn"
import {
  applyMove,
  chooseComputerMove,
  generateLegalMoves,
  getStatus,
  initialState,
  isInCheck,
  moveNotation,
  sqName,
  CHESS_LEVEL_LABELS,
  type ChessColor,
  type ChessLevel,
  type ChessMove,
  type ChessState,
  type ChessStatus,
} from "@/lib/games/chess-engine"
import { Button } from "@/components/ui/button"
import type { GameEvent } from "./use-multiplayer"

const GLYPHS: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
}

type Props =
  | {
      mode: "ai"
      level: ChessLevel
      onExit: () => void
    }
  | {
      mode: "online"
      myColor: ChessColor
      opponentName: string
      opponentLeft: boolean
      sendEvent: (ev: GameEvent) => Promise<void>
      registerSink: (fn: ((ev: GameEvent) => void) | null) => void
      onLeave: () => void
    }

/** Everything needed to render a finished game. */
type TerminalStatus = Extract<ChessStatus, { over: true }>
type GameOver = { status: TerminalStatus | null; outcome: "win" | "loss" | "draw" }

export function ChessGame(props: Props) {
  const aiLevel = props.mode === "ai" ? props.level : null
  const myColor: ChessColor = props.mode === "ai" ? "w" : props.myColor
  const opponentName =
    props.mode === "ai" ? `الكمبيوتر — ${CHESS_LEVEL_LABELS[aiLevel!]}` : props.opponentName

  const [state, setState] = useState<ChessState>(() => initialState())
  const [selected, setSelected] = useState<number | null>(null)
  const [promotion, setPromotion] = useState<ChessMove[] | null>(null)
  const [over, setOver] = useState<GameOver | null>(null)
  const [lastMove, setLastMove] = useState<ChessMove | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [tally, setTally] = useState({ wins: 0, draws: 0, losses: 0 })

  // Mirror of `over` readable from long-lived handlers (event sinks).
  const overRef = useRef<GameOver | null>(null)
  useEffect(() => {
    overRef.current = over
  }, [over])

  const legal = useMemo(() => generateLegalMoves(state), [state])
  const checked = useMemo(() => isInCheck(state, state.turn), [state])
  const finished = over !== null
  const myTurn = !finished && state.turn === myColor
  // In AI mode "thinking" is simply "it is the computer's turn".
  const thinking = props.mode === "ai" && !finished && state.turn !== myColor

  const countResult = useCallback((outcome: "win" | "loss" | "draw") => {
    setTally((t) => ({
      wins: t.wins + (outcome === "win" ? 1 : 0),
      draws: t.draws + (outcome === "draw" ? 1 : 0),
      losses: t.losses + (outcome === "loss" ? 1 : 0),
    }))
  }, [])

  /** Apply a move made by this client (click or AI). */
  const commit = useCallback(
    (m: ChessMove) => {
      const st = getStatus(state)
      if (st.over || state.turn !== myColor) return
      const note = moveNotation(state, m)
      const next = applyMove(state, m)
      const nextStatus = getStatus(next)
      if (nextStatus.over) {
        const result = outcomeFrom(nextStatus, myColor)
        setOver({ status: nextStatus, outcome: result })
        countResult(result)
      }
      setHistory((h) => [...h, note])
      setLastMove(m)
      setState(next)
      setSelected(null)
      setPromotion(null)
      if (props.mode === "online") void props.sendEvent({ type: "move", data: m })
    },
    [state, props, myColor, countResult]
  )

  /** Apply a move received from the opponent. */
  const applyRemote = useCallback(
    (m: ChessMove) => {
      const st = getStatus(state)
      if (st.over || state.turn === myColor) return
      const note = moveNotation(state, m)
      const next = applyMove(state, m)
      const nextStatus = getStatus(next)
      if (nextStatus.over) {
        const result = outcomeFrom(nextStatus, myColor)
        setOver({ status: nextStatus, outcome: result })
        countResult(result)
      }
      setHistory((h) => [...h, note])
      setLastMove(m)
      setState(next)
    },
    [state, myColor, countResult]
  )

  /* ---------------- AI opponent ---------------- */
  useEffect(() => {
    if (props.mode !== "ai" || !aiLevel || finished) return
    if (state.turn === myColor) return
    // Yield a frame so the "thinking" indicator paints before the blocking
    // engine search runs.
    const timer = setTimeout(() => {
      const m = chooseComputerMove(state, aiLevel)
      if (m) commit(m)
    }, 120)
    return () => clearTimeout(timer)
  }, [state, finished, myColor, aiLevel, props.mode, commit])

  /* ---------------- Online event sink ---------------- */
  useEffect(() => {
    if (props.mode !== "online") return
    const sink = (ev: GameEvent) => {
      if (ev.type === "move") {
        applyRemote(ev.data as ChessMove)
      } else if (ev.type === "restart") {
        setState(initialState())
        setHistory([])
        setLastMove(null)
        setSelected(null)
        setOver(null)
      } else if (ev.type === "resign") {
        // The opponent resigned (or vanished from the room) — I win.
        if (!overRef.current) {
          overRef.current = { status: null, outcome: "win" }
          setOver(overRef.current)
          countResult("win")
        }
      }
    }
    props.registerSink(sink)
    return () => props.registerSink(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode, applyRemote, countResult])

  const restart = useCallback(() => {
    setState(initialState())
    setHistory([])
    setLastMove(null)
    setSelected(null)
    setOver(null)
    if (props.mode === "online") void props.sendEvent({ type: "restart" })
  }, [props])

  const resign = useCallback(() => {
    if (over) return
    const result = myColor === "w" ? "loss" : "win"
    setOver({ status: null, outcome: result })
    countResult(result)
    if (props.mode === "online") void props.sendEvent({ type: "resign" })
  }, [over, myColor, props, countResult])

  const onSquareClick = (sq: number) => {
    if (finished || !myTurn) return
    const piece = state.board[sq]
    if (selected !== null) {
      const candidates = legal.filter((m) => m.from === selected && m.to === sq)
      if (candidates.length > 1) {
        setPromotion(candidates) // pick the piece
        return
      }
      if (candidates.length === 1) {
        commit(candidates[0])
        return
      }
    }
    if (piece && pieceColorOf(piece) === myColor) {
      setSelected(sq)
    } else {
      setSelected(null)
    }
  }

  const destSquares = useMemo(() => {
    if (selected === null) return new Set<number>()
    return new Set(legal.filter((m) => m.from === selected).map((m) => m.to))
  }, [selected, legal])

  const flipped = myColor === "b"
  const order = useMemo(
    () => Array.from({ length: 64 }, (_, i) => (flipped ? 63 - i : i)),
    [flipped]
  )

  const overlayTitle = over ? resultTitle(over) : null

  return (
    <div className="space-y-3" dir="ltr">
      {/* Opponent bar */}
      <div className="flex items-center justify-between gap-2">
        <PlayerChip
          icon={props.mode === "ai" ? <Cpu className="size-4" /> : <User className="size-4" />}
          name={opponentName}
          active={!finished && state.turn !== myColor}
        />
        <span className="rounded-xl bg-secondary px-2.5 py-1 text-xs font-bold tabular-nums text-muted-foreground">
          {history.length} نقلة
        </span>
      </div>

      {/* Board */}
      <div className="relative mx-auto aspect-square w-full max-w-[min(92vw,30rem)] overflow-hidden rounded-2xl shadow-lg ring-1 ring-foreground/10">
        <div className="grid h-full w-full grid-cols-8 grid-rows-8">
          {order.map((sq) => {
            const light = ((sq % 8) + Math.floor(sq / 8)) % 2 === 0
            const piece = state.board[sq]
            const isSel = selected === sq
            const isDest = destSquares.has(sq)
            const isLast = lastMove && (lastMove.from === sq || lastMove.to === sq)
            const kingInDanger =
              checked && piece === (state.turn === "w" ? "K" : "k")
            return (
              <button
                key={sq}
                type="button"
                onClick={() => onSquareClick(sq)}
                aria-label={sqName(sq)}
                className={cn(
                  "relative flex items-center justify-center text-[clamp(1.4rem,7vw,2.5rem)] leading-none",
                  light ? "bg-[#f0d9b5]" : "bg-[#b58863]",
                  isSel && "ring-4 ring-coptic-teal/70 ring-inset",
                  isLast && !isSel && "shadow-[inset_0_0_0_9999px_rgba(205,165,58,0.30)]",
                  kingInDanger && "shadow-[inset_0_0_0_9999px_rgba(220,60,60,0.45)]"
                )}
              >
                {piece ? (
                  <span
                    className={cn(
                      "select-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]",
                      piece === piece.toUpperCase()
                        ? "text-white [text-shadow:0_0_2px_#000,0_0_2px_#000]"
                        : "text-[#1f1b16]"
                    )}
                  >
                    {GLYPHS[piece]}
                  </span>
                ) : null}
                {isDest && !piece ? (
                  <span className="absolute size-1/4 rounded-full bg-foreground/30" />
                ) : null}
                {isDest && piece ? (
                  <span className="absolute inset-0 ring-[3px] ring-coptic-teal/70 ring-inset" />
                ) : null}
              </button>
            )
          })}
        </div>

        {/* Promotion picker */}
        {promotion ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/45 backdrop-blur-[2px]">
            <div className="flex gap-2 rounded-2xl bg-card p-3 shadow-xl ring-1 ring-foreground/10">
              {promotion.map((m) => (
                <button
                  key={m.promo}
                  type="button"
                  onClick={() => commit(m)}
                  className="flex size-14 items-center justify-center rounded-xl bg-secondary text-3xl transition-transform hover:scale-110"
                >
                  <span
                    className={
                      myColor === "w"
                        ? "text-white [text-shadow:0_0_2px_#000,0_0_2px_#000]"
                        : "text-[#1f1b16]"
                    }
                  >
                    {GLYPHS[myColor === "w" ? m.promo!.toUpperCase() : m.promo!]}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Thinking veil */}
        {thinking ? (
          <div className="absolute bottom-2 start-2 z-10 flex items-center gap-2 rounded-xl bg-card/90 px-3 py-1.5 text-xs font-semibold shadow ring-1 ring-foreground/10">
            <Loader2 className="size-3.5 animate-spin" />
            الخصم بيفكّر…
          </div>
        ) : null}

        {/* Game over overlay */}
        {finished ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 backdrop-blur-[2px]">
            <div className="mx-6 rounded-2xl bg-card p-5 text-center shadow-xl ring-1 ring-foreground/10" dir="rtl">
              <Crown className="mx-auto mb-2 size-8 text-coptic-gold" />
              <p className="font-heading text-lg font-extrabold">{overlayTitle}</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button size="sm" onClick={restart}>
                  <RotateCcw className="size-4" />
                  لعبة جديدة
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={props.mode === "online" ? props.onLeave : props.onExit}
                >
                  <LogOut className="size-4" />
                  خروج
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Player bar + actions */}
      <div className="flex items-center justify-between gap-2">
        <PlayerChip icon={<User className="size-4" />} name="أنت" active={!finished && state.turn === myColor} />
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 text-xs font-bold tabular-nums">
            <span className="rounded-xl bg-coptic-teal/15 px-2 py-1 text-coptic-teal">{tally.wins}</span>
            <span className="rounded-xl bg-secondary px-2 py-1 text-muted-foreground">{tally.draws}</span>
            <span className="rounded-xl bg-coptic-gold-soft px-2 py-1 text-coptic-gold">{tally.losses}</span>
          </div>
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
          <Button
            size="sm"
            variant="ghost"
            onClick={props.mode === "online" ? props.onLeave : props.onExit}
          >
            <LogOut className="size-4" />
            خروج
          </Button>
        </div>
      </div>

      {/* Move list */}
      {history.length > 0 ? (
        <div
          className="max-h-32 space-y-1 overflow-y-auto rounded-2xl bg-secondary/60 p-3 text-xs text-muted-foreground"
          dir="ltr"
        >
          {Array.from({ length: Math.ceil(history.length / 2) }, (_, row) => (
            <div key={row} className="flex gap-2 font-mono">
              <span className="w-6 shrink-0 text-right opacity-60">{row + 1}.</span>
              <span className="w-20">{history[row * 2]}</span>
              <span className="w-20">{history[row * 2 + 1] ?? ""}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function pieceColorOf(p: string): ChessColor {
  return p === p.toUpperCase() ? "w" : "b"
}

function outcomeFrom(status: TerminalStatus, myColor: ChessColor): "win" | "loss" | "draw" {
  if (status.result === "checkmate") return status.winner === myColor ? "win" : "loss"
  return "draw"
}

function resultTitle(over: GameOver): string {
  if (over.outcome === "win")
    return over.status?.result === "checkmate" ? "كش مات — كسبت! 🎉" : "الخصم استسلم — كسبت! 🎉"
  if (over.outcome === "loss")
    return over.status?.result === "checkmate" ? "كش مات — الخصم كسب 💪" : "استسلمت — الخصم كسب 💪"
  if (over.status?.result === "stalemate") return "تعادل (Pat) 🤝"
  if (over.status?.result === "draw") return "تعادل 🤝"
  return "انتهت اللعبة"
}

function PlayerChip({ icon, name, active }: { icon: ReactNode; name: string; active: boolean }) {
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
    </div>
  )
}
