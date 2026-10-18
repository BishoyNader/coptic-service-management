"use client"

/**
 * Multiplayer plumbing for the games tab, built on Supabase Realtime:
 *
 *  - A shared "lobby" presence channel lists who is currently online.
 *  - Every user has a personal "inbox" broadcast channel used to receive
 *    game challenges and their responses.
 *  - Once a challenge is accepted both players join a per-game "room"
 *    channel and exchange moves, resignations and restarts.
 *
 * Game rules stay on the clients: each side applies every received move
 * through the same local engine, so both boards always agree.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { createClient } from "@/lib/supabase/client"

export type GameKind = "chess" | "ttt"

export type OnlineUser = { id: string; name: string }

export type IncomingChallenge = {
  from: OnlineUser
  game: GameKind
  roomId: string
}

export type OutgoingChallenge = {
  to: OnlineUser
  game: GameKind
  roomId: string
}

/** Events exchanged between the two players inside a game room. */
export type GameEvent =
  | { type: "move"; data: unknown }
  | { type: "resign" }
  | { type: "restart" }

export type ActiveRoom = {
  roomId: string
  game: GameKind
  opponent: OnlineUser
  /** True when this client issued the challenge (plays White / X). */
  isChallenger: boolean
}

const CHALLENGE_TIMEOUT_MS = 30_000

function inboxChannelName(userId: string) {
  return `games-inbox-${userId}`
}
function roomChannelName(roomId: string) {
  return `games-room-${roomId}`
}

/** Join a channel and resolve once it is subscribed (never block forever). */
function join(channel: { state: string; subscribe: (cb: (s: string) => void) => unknown }) {
  return new Promise<void>((resolve) => {
    if (channel.state === "joined") return resolve()
    const timer = setTimeout(resolve, 5_000)
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer)
        resolve()
      }
    })
  })
}

export function useMultiplayer(me: { id: string; name: string }) {
  const [supabase] = useState(() => createClient())

  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [connected, setConnected] = useState(false)
  const [incoming, setIncoming] = useState<IncomingChallenge | null>(null)
  const [outgoing, setOutgoing] = useState<OutgoingChallenge | null>(null)
  const [room, setRoom] = useState<ActiveRoom | null>(null)
  const [opponentLeft, setOpponentLeft] = useState(false)

  // Latest sink for room events, registered by whichever game is mounted.
  const eventSinkRef = useRef<((ev: GameEvent) => void) | null>(null)
  const registerEventSink = useCallback((fn: ((ev: GameEvent) => void) | null) => {
    eventSinkRef.current = fn
  }, [])

  // Busy = already in a challenge exchange or a game; extra challenges are
  // declined automatically. Mirrored into a ref from an effect so the
  // broadcast handlers (registered once) always see the current value.
  const busyRef = useRef(false)
  useEffect(() => {
    busyRef.current = Boolean(incoming || outgoing || room)
  }, [incoming, outgoing, room])

  // The pending outgoing challenge, readable from long-lived handlers.
  const outgoingRef = useRef<OutgoingChallenge | null>(null)
  useEffect(() => {
    outgoingRef.current = outgoing
  }, [outgoing])

  const lobbyRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const myInboxRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const roomRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const seenRoomPresenceRef = useRef(false)
  const challengeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearChallengeTimer = () => {
    if (challengeTimerRef.current) {
      clearTimeout(challengeTimerRef.current)
      challengeTimerRef.current = null
    }
  }

  const leaveRoom = useCallback(() => {
    clearChallengeTimer()
    if (roomRef.current) {
      void supabase.removeChannel(roomRef.current)
      roomRef.current = null
    }
    seenRoomPresenceRef.current = false
    eventSinkRef.current = null
    setRoom(null)
    setOpponentLeft(false)
  }, [supabase])

  const sendInbox = useCallback(
    async (userId: string, event: string, payload: Record<string, unknown>) => {
      // Broadcasting to another user's inbox requires being subscribed to it.
      const ch = supabase.channel(inboxChannelName(userId))
      await join(ch)
      await ch.send({ type: "broadcast", event, payload })
      await supabase.removeChannel(ch)
    },
    [supabase]
  )

  const enterRoom = useCallback(
    async (
      roomId: string,
      game: GameKind,
      opponent: OnlineUser,
      isChallenger: boolean
    ) => {
      leaveRoom()
      const roomCh = supabase.channel(roomChannelName(roomId), {
        config: { presence: { key: me.id } },
      })
      roomRef.current = roomCh
      seenRoomPresenceRef.current = false

      roomCh
        .on("broadcast", { event: "game-event" }, ({ payload }) => {
          eventSinkRef.current?.(payload as GameEvent)
        })
        .on("presence", { event: "sync" }, () => {
          const state = roomCh.presenceState()
          const present = Object.keys(state)
          // Wait until we have seen both players before judging an absence.
          if (present.length >= 2) {
            seenRoomPresenceRef.current = true
            setOpponentLeft(false)
          } else if (seenRoomPresenceRef.current && !present.includes(opponent.id)) {
            setOpponentLeft(true)
            // Treat a vanished opponent as a resignation.
            eventSinkRef.current?.({ type: "resign" })
          }
        })

      await join(roomCh)
      await roomCh.track({ name: me.name })
      setRoom({ roomId, game, opponent, isChallenger })
      setOpponentLeft(false)
    },
    [supabase, me.id, me.name, leaveRoom]
  )

  /* ------------------------------------------------------------------ */
  /* Lobby presence                                                      */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    const lobby = supabase.channel("games-lobby", {
      config: { presence: { key: me.id } },
    })
    lobbyRef.current = lobby

    lobby.on("presence", { event: "sync" }, () => {
      const state = lobby.presenceState<{ name: string }>()
      const users: OnlineUser[] = []
      for (const [id, metas] of Object.entries(state)) {
        if (id === me.id || metas.length === 0) continue
        users.push({ id, name: metas[0].name })
      }
      users.sort((a, b) => a.name.localeCompare(b.name, "ar"))
      setOnlineUsers(users)
    })

    void lobby.subscribe((status) => {
      setConnected(status === "SUBSCRIBED")
      if (status === "SUBSCRIBED") {
        void lobby.track({ name: me.name })
      }
    })

    return () => {
      void supabase.removeChannel(lobby)
      lobbyRef.current = null
    }
  }, [supabase, me.id, me.name])

  /* ------------------------------------------------------------------ */
  /* My inbox (challenges addressed to me)                               */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    const inbox = supabase.channel(inboxChannelName(me.id))
    myInboxRef.current = inbox

    inbox
      .on("broadcast", { event: "challenge" }, ({ payload }) => {
        const from = payload.from as OnlineUser
        const game = payload.game as GameKind
        const roomId = payload.roomId as string
        if (!from?.id) return
        if (busyRef.current) {
          // Auto-decline when already busy.
          void sendInbox(from.id, "decline", { roomId })
          return
        }
        setIncoming({ from, game, roomId })
      })
      .on("broadcast", { event: "accept" }, ({ payload }) => {
        const roomId = payload.roomId as string
        const by = payload.by as OnlineUser
        const pending = outgoingRef.current
        if (!by?.id || !pending || pending.roomId !== roomId) return
        clearChallengeTimer()
        setOutgoing(null)
        // Join the room as the challenger (White / X).
        void enterRoom(roomId, pending.game, by, true)
      })
      .on("broadcast", { event: "decline" }, ({ payload }) => {
        const roomId = payload.roomId as string
        const pending = outgoingRef.current
        if (!pending || pending.roomId !== roomId) return
        clearChallengeTimer()
        setOutgoing(null)
      })

    void inbox.subscribe()
    return () => {
      void supabase.removeChannel(inbox)
      myInboxRef.current = null
    }
  }, [supabase, me.id, sendInbox, enterRoom])

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  const challenge = useCallback(
    async (target: OnlineUser, game: GameKind) => {
      if (busyRef.current) return
      const roomId = crypto.randomUUID()
      setOutgoing({ to: target, game, roomId })
      await sendInbox(target.id, "challenge", {
        from: { id: me.id, name: me.name },
        game,
        roomId,
      })
      clearChallengeTimer()
      challengeTimerRef.current = setTimeout(() => {
        setOutgoing((cur) => (cur?.roomId === roomId ? null : cur))
      }, CHALLENGE_TIMEOUT_MS)
    },
    [sendInbox, me.id, me.name]
  )

  const cancelChallenge = useCallback(async () => {
    const pending = outgoingRef.current
    if (!pending) return
    clearChallengeTimer()
    setOutgoing(null)
    await sendInbox(pending.to.id, "decline", { roomId: pending.roomId })
  }, [sendInbox])

  const respondToChallenge = useCallback(
    async (accept: boolean) => {
      const cur = incoming
      if (!cur) return
      setIncoming(null)
      if (accept) {
        await sendInbox(cur.from.id, "accept", {
          roomId: cur.roomId,
          by: { id: me.id, name: me.name },
        })
        await enterRoom(cur.roomId, cur.game, cur.from, false)
      } else {
        await sendInbox(cur.from.id, "decline", { roomId: cur.roomId })
      }
    },
    [incoming, sendInbox, enterRoom, me.id, me.name]
  )

  const sendGameEvent = useCallback(async (ev: GameEvent) => {
    const ch = roomRef.current
    if (!ch) return
    await ch.send({ type: "broadcast", event: "game-event", payload: ev })
  }, [])

  // Leave every channel (and its presence) when the component unmounts.
  useEffect(() => {
    const supa = supabase
    return () => {
      clearChallengeTimer()
      if (roomRef.current) void supa.removeChannel(roomRef.current)
      if (myInboxRef.current) void supa.removeChannel(myInboxRef.current)
      if (lobbyRef.current) void supa.removeChannel(lobbyRef.current)
    }
  }, [supabase])

  return {
    connected,
    onlineUsers,
    incoming,
    outgoing,
    room,
    opponentLeft,
    challenge,
    cancelChallenge,
    respondToChallenge,
    leaveRoom,
    sendGameEvent,
    registerEventSink,
  }
}
