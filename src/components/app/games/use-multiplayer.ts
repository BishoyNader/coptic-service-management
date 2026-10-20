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
 *
 * Robustness notes (these all bit real players before):
 *  - `channel.track()` throws synchronously while the channel is still
 *    joining, and a join can time out on a flaky link — so entering a room
 *    must never gate the UI on the network handshake. The board appears
 *    immediately; joining/tracking happens in the background and presence
 *    is re-asserted on every (re)join plus a periodic heartbeat.
 *  - The challenger waits strictly longer than any challenge dialog can
 *    stay open, so an "accept" can never arrive after it was forgotten.
 *    A late accept still gets a "cancel" reply so the acceptor is never
 *    stranded in a ghost room, and the acceptor re-sends "accept" until
 *    the challenger actually shows up in the room.
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

/**
 * How long the challenger keeps waiting for a reply. MUST stay larger than
 * INCOMING_EXPIRY_MS: an accept can only be sent while the challenge dialog
 * is still open, so the challenger is guaranteed to still be listening.
 */
const CHALLENGE_TIMEOUT_MS = 60_000
/** Challenge dialogs auto-decline after this long (the challenger gave up,
 *  closed the tab, …). */
const INCOMING_EXPIRY_MS = 45_000
/** If the opponent has not appeared in the room this long after joining,
 *  stop waiting — the other player never made it into the game. */
const ROOM_START_TIMEOUT_MS = 15_000
/** The acceptor keeps re-sending "accept" until the challenger shows up. */
const ACCEPT_RETRY_INTERVAL_MS = 2_500
const ACCEPT_RETRY_MAX = 6
/** Presence leases silently expire after network blips (sleep/wake, mobile
 *  handoffs); re-asserting presence keeps me visible to friends. */
const LOBBY_HEARTBEAT_MS = 20_000

type AnyChannel = {
  state: string
  subscribe: (cb: (status: string) => void) => unknown
}

type TrackableChannel = {
  track: (payload: Record<string, unknown>) => Promise<unknown>
}

function inboxChannelName(userId: string) {
  return `games-inbox-${userId}`
}
function roomChannelName(roomId: string) {
  return `games-room-${roomId}`
}

/**
 * Subscribe to a channel and resolve once it is usable — on the first
 * SUBSCRIBED, on a terminal state, or after a short grace period. Never
 * rejects and never blocks for more than a few seconds. `onSubscribed`
 * runs on every (re)join so presence can be re-asserted after reconnects.
 */
function join(channel: AnyChannel, onSubscribed?: () => void) {
  return new Promise<void>((resolve) => {
    if (channel.state === "joined") {
      onSubscribed?.()
      resolve()
      return
    }
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, 5_000)
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        onSubscribed?.()
        finish()
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        finish()
      }
    })
  })
}

/** `track()` throws while the channel is not joined yet — never let that
 *  bubble up; the next (re)join re-tracks. */
function safeTrack(channel: TrackableChannel, payload: Record<string, unknown>) {
  try {
    void channel.track(payload).catch(() => {})
  } catch {
    /* not joined yet — retried by the (re)join hook or the heartbeat */
  }
}

export function useMultiplayer(me: { id: string; name: string }) {
  const [supabase] = useState(() => createClient())

  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [connected, setConnected] = useState(false)
  const [incoming, setIncoming] = useState<IncomingChallenge | null>(null)
  const [outgoing, setOutgoing] = useState<OutgoingChallenge | null>(null)
  const [room, setRoom] = useState<ActiveRoom | null>(null)
  const [opponentLeft, setOpponentLeft] = useState(false)

  // Bumped by refreshLobby() when the lobby channel is dead, forcing the
  // lobby effect to tear down and resubscribe from scratch.
  const [lobbyEpoch, setLobbyEpoch] = useState(0)

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
  /** The room we are currently in — makes retried accepts idempotent. */
  const activeRoomIdRef = useRef<string | null>(null)
  const seenRoomPresenceRef = useRef(false)
  const challengeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const roomStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const acceptRetryRef = useRef<ReturnType<typeof setInterval> | null>(null)
  /** Keeps re-asserting room presence so a stalled socket still reads as online. */
  const roomHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearChallengeTimer = useCallback(() => {
    if (challengeTimerRef.current) {
      clearTimeout(challengeTimerRef.current)
      challengeTimerRef.current = null
    }
  }, [])

  const clearAcceptRetry = useCallback(() => {
    if (acceptRetryRef.current) {
      clearInterval(acceptRetryRef.current)
      acceptRetryRef.current = null
    }
  }, [])

  const clearRoomTimers = useCallback(() => {
    if (roomStartTimerRef.current) {
      clearTimeout(roomStartTimerRef.current)
      roomStartTimerRef.current = null
    }
    if (roomHeartbeatRef.current) {
      clearInterval(roomHeartbeatRef.current)
      roomHeartbeatRef.current = null
    }
    clearAcceptRetry()
  }, [clearAcceptRetry])

  const leaveRoom = useCallback(() => {
    clearChallengeTimer()
    clearRoomTimers()
    activeRoomIdRef.current = null
    if (roomRef.current) {
      void supabase.removeChannel(roomRef.current)
      roomRef.current = null
    }
    seenRoomPresenceRef.current = false
    eventSinkRef.current = null
    setRoom(null)
    setOpponentLeft(false)
  }, [supabase, clearChallengeTimer, clearRoomTimers])

  /** Best-effort inbox message; resolves false only on hard failures. */
  const sendInbox = useCallback(
    async (userId: string, event: string, payload: Record<string, unknown>): Promise<boolean> => {
      // Broadcasting to another user's inbox requires being subscribed to it.
      // (If the websocket is down, realtime-js transparently falls back to
      // the HTTP broadcast endpoint, so delivery still succeeds.)
      const ch = supabase.channel(inboxChannelName(userId))
      try {
        await join(ch)
        const status = await ch.send({ type: "broadcast", event, payload })
        return status === "ok"
      } catch {
        return false
      } finally {
        void supabase.removeChannel(ch)
      }
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
      activeRoomIdRef.current = roomId
      const roomCh = supabase.channel(roomChannelName(roomId), {
        config: { presence: { key: me.id } },
      })
      roomRef.current = roomCh
      seenRoomPresenceRef.current = false

      const trackPresence = () => safeTrack(roomCh, { name: me.name })

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
            clearRoomTimers()
            setOpponentLeft(false)
          } else if (seenRoomPresenceRef.current && !present.includes(opponent.id)) {
            setOpponentLeft(true)
            // Treat a vanished opponent as a resignation.
            eventSinkRef.current?.({ type: "resign" })
          }
        })

      // Show the board immediately: the network handshake below must never
      // gate (or break) the UI — track() throws while joining and join()
      // can time out on a slow link.
      setRoom({ roomId, game, opponent, isChallenger })
      setOpponentLeft(false)

      await join(roomCh, trackPresence)
      roomHeartbeatRef.current = setInterval(trackPresence, LOBBY_HEARTBEAT_MS)

      // The player may have backed out while the handshake was in flight —
      // never arm room timers for a room we already left.
      if (activeRoomIdRef.current !== roomId) {
        clearRoomTimers()
        return
      }

      // Nobody should wait forever on a room the other player never reached.
      roomStartTimerRef.current = setTimeout(() => {
        if (!seenRoomPresenceRef.current) {
          setOpponentLeft(true)
          eventSinkRef.current?.({ type: "resign" })
        }
      }, ROOM_START_TIMEOUT_MS)

      // Keep re-sending the accept until the challenger actually appears,
      // so a single lost broadcast can never strand us in a ghost room.
      if (!isChallenger) {
        let attempts = 0
        acceptRetryRef.current = setInterval(() => {
          if (seenRoomPresenceRef.current || attempts >= ACCEPT_RETRY_MAX) {
            clearAcceptRetry()
            return
          }
          attempts += 1
          void sendInbox(opponent.id, "accept", {
            roomId,
            by: { id: me.id, name: me.name },
          })
        }, ACCEPT_RETRY_INTERVAL_MS)
      }
    },
    [supabase, me.id, me.name, leaveRoom, sendInbox, clearRoomTimers, clearAcceptRetry]
  )

  /* ------------------------------------------------------------------ */
  /* Lobby presence                                                      */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    const lobby = supabase.channel(`games-lobby`, {
      config: { presence: { key: me.id } },
    })
    lobbyRef.current = lobby

    const trackPresence = () => safeTrack(lobby, { name: me.name })

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
      if (status === "SUBSCRIBED") trackPresence()
    })

    // After a socket reconnect the client re-joins the channel server-side
    // but nobody re-tracks presence — without this heartbeat a user silently
    // disappears from every friend's list until a page reload.
    const heartbeat = setInterval(trackPresence, LOBBY_HEARTBEAT_MS)

    return () => {
      clearInterval(heartbeat)
      void supabase.removeChannel(lobby)
      lobbyRef.current = null
    }
  }, [supabase, me.id, me.name, lobbyEpoch])

  /** Re-assert my presence now; resubscribe the lobby if it is dead. */
  const refreshLobby = useCallback(() => {
    const lobby = lobbyRef.current
    if (lobby && lobby.state === "joined") {
      safeTrack(lobby, { name: me.name })
      return
    }
    setLobbyEpoch((n) => n + 1)
  }, [me.name])

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
        if (!by?.id || !roomId) return
        // Accepts are re-sent until answered — ignore the duplicates that
        // arrive after the game has already started.
        if (activeRoomIdRef.current === roomId) return
        const pending = outgoingRef.current
        if (pending && pending.roomId === roomId) {
          clearChallengeTimer()
          setOutgoing(null)
          // Join the room as the challenger (White / X).
          void enterRoom(roomId, pending.game, by, true)
          return
        }
        // The challenge expired or was cancelled before they accepted —
        // tell them so they are not left waiting in an empty room.
        void sendInbox(by.id, "cancel", { roomId })
      })
      .on("broadcast", { event: "decline" }, ({ payload }) => {
        const roomId = payload.roomId as string
        const pending = outgoingRef.current
        if (!pending || pending.roomId !== roomId) return
        clearChallengeTimer()
        setOutgoing(null)
      })
      .on("broadcast", { event: "cancel" }, ({ payload }) => {
        const roomId = payload.roomId as string
        // The challenger called the whole thing off (late accept, manual
        // cancel) — leave the room we may have just entered.
        if (activeRoomIdRef.current === roomId) leaveRoom()
      })

    void inbox.subscribe()
    return () => {
      void supabase.removeChannel(inbox)
      myInboxRef.current = null
    }
  }, [supabase, me.id, sendInbox, enterRoom, leaveRoom, clearChallengeTimer])

  // Stale challenge dialogs auto-decline so the sender is never left
  // waiting on someone who walked away from the screen.
  useEffect(() => {
    if (!incoming) return
    const timer = setTimeout(() => {
      setIncoming(null)
      void sendInbox(incoming.from.id, "decline", { roomId: incoming.roomId })
    }, INCOMING_EXPIRY_MS)
    return () => clearTimeout(timer)
  }, [incoming, sendInbox])

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  const challenge = useCallback(
    async (target: OnlineUser, game: GameKind): Promise<boolean> => {
      if (busyRef.current) return false
      const roomId = crypto.randomUUID()
      setOutgoing({ to: target, game, roomId })
      const sent = await sendInbox(target.id, "challenge", {
        from: { id: me.id, name: me.name },
        game,
        roomId,
      })
      if (!sent) {
        // The message never left — do not make the sender wait for a reply
        // that cannot arrive.
        setOutgoing((cur) => (cur?.roomId === roomId ? null : cur))
        return false
      }
      clearChallengeTimer()
      challengeTimerRef.current = setTimeout(() => {
        setOutgoing((cur) => (cur?.roomId === roomId ? null : cur))
      }, CHALLENGE_TIMEOUT_MS)
      return true
    },
    [sendInbox, me.id, me.name, clearChallengeTimer]
  )

  const cancelChallenge = useCallback(async () => {
    const pending = outgoingRef.current
    if (!pending) return
    clearChallengeTimer()
    setOutgoing(null)
    await sendInbox(pending.to.id, "decline", { roomId: pending.roomId })
  }, [sendInbox, clearChallengeTimer])

  const respondToChallenge = useCallback(
    async (accept: boolean) => {
      const cur = incoming
      if (!cur) return
      setIncoming(null)
      if (accept) {
        // Best-effort; enterRoom() keeps re-sending the accept until the
        // challenger shows up, so a lost message cannot strand us here.
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
    try {
      await ch.send({ type: "broadcast", event: "game-event", payload: ev })
    } catch {
      /* best-effort: realtime-js falls back to HTTP when the socket is down */
    }
  }, [])

  // Leave every channel (and its presence) when the component unmounts.
  useEffect(() => {
    const supa = supabase
    return () => {
      clearChallengeTimer()
      clearRoomTimers()
      if (roomRef.current) void supa.removeChannel(roomRef.current)
      if (myInboxRef.current) void supa.removeChannel(myInboxRef.current)
      if (lobbyRef.current) void supa.removeChannel(lobbyRef.current)
    }
  }, [supabase, clearChallengeTimer, clearRoomTimers])

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
    refreshLobby,
    leaveRoom,
    sendGameEvent,
    registerEventSink,
  }
}
