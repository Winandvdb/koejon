import { getDoc, setDoc } from 'firebase/firestore'
import { derived, get, writable, type Readable } from 'svelte/store'
import { clientState, createMatch, legalActions, toPublic } from '../engine'
import type { Action, Card, State } from '../engine'
import type { HandDoc, Intent, RoomDoc } from './net-types'
import { DEFAULT_ROOM_OPTS } from './net-types'
import { FirestoreGuestLink, roomRef } from './link-firestore'
import { P2P_ENABLED, P2PGuestLink, P2PHostLink } from './link-p2p'
import { addHistory } from './history'
import type { KeyValueStore } from './link-local'
import { safeStorage } from './storage'
import type { GuestLink, HostLink } from './transport'

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** How long a sent action may wait for the host's next state. The host
 *  commits on receipt, so this covers only the network round trip. */
export const ACT_ACK_MS = 8000

export const CODE_LENGTH = 5

export function makeCode(len = CODE_LENGTH): string {
  const buf = new Uint8Array(len)
  crypto.getRandomValues(buf)
  return [...buf].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

/** Same action, whatever the key order of the objects, at any depth. */
export const actionKey = (a: Action) => JSON.stringify(sortKeys(a))

function sortKeys(v: unknown): unknown {
  if (typeof v !== 'object' || v === null) return v
  if (Array.isArray(v)) return v.map(sortKeys)
  const o = v as Record<string, unknown>
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]))
}

export function seatOf(room: RoomDoc | null, uid: string): number {
  if (!room) return -1
  return room.seats.findIndex((s) => s?.uid === uid)
}

/** A fresh lobby with the creator in seat 0. The host builds its own engine on attach. */
export function newRoomDoc(code: string, uid: string, name: string): RoomDoc {
  return {
    code,
    hostUid: uid,
    seats: [{ uid, name, bot: false }, null, null, null],
    pub: toPublic(createMatch(0)),
    version: 1,
    seq: 0,
    heartbeat: Date.now(),
    opts: { ...DEFAULT_ROOM_OPTS },
  }
}

export interface SessionView {
  room: RoomDoc | null
  /** Own cards; null while the dealer is blind during bidding. */
  hand: Card[] | null
  mySeat: number
  /** Engine-shaped state with only the own hand filled in. */
  state: State | null
  legal: Action[]
  hostStale: boolean
  /** A Firestore listener died (offline or quota) — updates stopped. */
  offline: boolean
}

export class RoomSession {
  /** One store, so a link can set room and hand without a view in between. */
  private readonly latest = writable<{ room: RoomDoc | null; hand: HandDoc | null }>({ room: null, hand: null })
  readonly room = derived(this.latest, (l) => l.room)
  readonly handDoc = derived(this.latest, (l) => l.hand)
  readonly hostStale = writable(false)
  readonly connLost = writable(false)
  readonly view: Readable<SessionView>
  private unsubHistory: () => void
  private savedKjn: string | null = null

  constructor(
    readonly code: string,
    readonly uid: string,
    private link: GuestLink,
    /** Set when this tab is the host: `link` is then fed in-tab by it. */
    readonly hostLink?: HostLink,
    private history: KeyValueStore = safeStorage,
  ) {
    link.start({
      room: (r) => this.latest.update((l) => ({ ...l, room: r })),
      hand: (h) => this.latest.update((l) => ({ ...l, hand: h })),
      state: (r, h) => this.latest.set({ room: r, hand: h }),
      lost: () => this.connLost.set(true),
      hostStale: (s) => this.hostStale.set(s),
    })
    this.view = derived(
      [this.latest, this.hostStale, this.connLost],
      ([{ room, hand: hd }, hostStale, connLost]) => {
        const mySeat = seatOf(room, uid)
        const hand = hd?.cards ?? null
        const state = room?.pub && mySeat >= 0 ? clientState(room.pub, mySeat, hand) : null
        const legal = state ? legalActions(state, mySeat) : []
        return { room, hand, mySeat, state, legal, hostStale, offline: connLost }
      },
    )
    this.unsubHistory = this.room.subscribe((r) => {
      this.keepRecord(r)
      this.reclaim(r)
    })
  }

  /** A seated human keeps the finished match on this device. */
  private keepRecord(room: RoomDoc | null): void {
    if (!room?.kjn || room.pub?.phase !== 'GAME_OVER') return
    if (room.kjn === this.savedKjn) return
    const seat = seatOf(room, this.uid)
    if (seat < 0 || room.seats[seat]!.bot) return
    addHistory({ seat, names: room.seats.map((s) => s?.name ?? ''), kjn: room.kjn }, this.history)
    this.savedKjn = room.kjn
  }

  /** Set once this player leaves on purpose: the bot in their seat stays. */
  private left = false
  /** A join for the current bot takeover is out. */
  private reclaiming = false

  /** A bot holds our seat under our uid while we are still here (the host
   *  took it over behind our back): ask for it back, as a rejoin would. Without
   *  this the table shows no hand and only a manual rejoin helps. */
  private reclaim(r: RoomDoc | null): void {
    const seat = r?.seats.find((s) => s?.uid === this.uid)
    if (!seat?.bot) {
      this.reclaiming = false
      return
    }
    // The host tab drives its own seat through the host: nobody takes it over.
    if (this.left || this.reclaiming || this.hostLink) return
    this.reclaiming = true
    console.warn('[room] own seat is held by a bot, reclaiming it')
    this.send({ kind: 'join', name: seat.name }).catch(() => (this.reclaiming = false))
  }

  send(intent: Intent): Promise<void> {
    return this.link.send(intent)
  }

  /** Resolves once the host shows a newer state in which this move is no
   *  longer open, so it landed. A message lost on a weak connection gives no
   *  error of its own, so no such state in time rejects. */
  async act(action: Action): Promise<void> {
    const before = get(this.room)?.seq ?? 0 // no room yet: any state is newer
    await this.send({ kind: 'act', action })
    const key = actionKey(action)
    await new Promise<void>((resolve, reject) => {
      let unsub = () => {}
      const timer = setTimeout(() => {
        unsub()
        reject(new Error('act-lost'))
      }, ACT_ACK_MS)
      unsub = this.view.subscribe((v) => {
        if ((v.room?.seq ?? 0) <= before) return
        // Another seat's move also makes a newer state.
        if (v.legal.some((a) => actionKey(a) === key)) return
        clearTimeout(timer)
        queueMicrotask(() => unsub())
        resolve()
      })
    })
  }

  leave(): Promise<void> {
    this.left = true
    return this.send({ kind: 'leave' })
  }

  dispose(): void {
    this.unsubHistory()
    this.link.dispose()
  }
}

function hostSession(code: string, uid: string): RoomSession {
  const link = new P2PHostLink(code, uid)
  return new RoomSession(code, uid, link.guest, link)
}

function guestSession(code: string, uid: string): RoomSession {
  const link = P2P_ENABLED ? new P2PGuestLink(code, uid) : new FirestoreGuestLink(code, uid)
  return new RoomSession(code, uid, link)
}

/** Create a room and return a session. The caller becomes host seat 0. */
export async function createRoom(uid: string, name: string): Promise<RoomSession> {
  for (let tries = 0; tries < 10; tries++) {
    const code = makeCode()
    const ref = roomRef(code)
    const snap = await getDoc(ref)
    if (snap.exists()) continue
    await setDoc(ref, newRoomDoc(code, uid, name))
    return hostSession(code, uid)
  }
  throw new Error('could not allocate a room code')
}

/** Join an existing room by code. */
export async function joinRoom(code: string, uid: string, name: string): Promise<RoomSession> {
  code = code.trim().toUpperCase()
  const snap = await getDoc(roomRef(code))
  if (!snap.exists()) throw new Error('room-not-found')
  const room = snap.data() as RoomDoc
  // Back to our own room (reload): this tab hosts it again.
  if (room.hostUid === uid) return hostSession(code, uid)
  const si = seatOf(room, uid)
  const reclaim = si >= 0 && !!room.seats[si]!.bot
  if (si >= 0 && !reclaim) return guestSession(code, uid) // rejoin
  if (!reclaim) {
    if (room.pub && room.pub.phase !== 'LOBBY') throw new Error('room-started')
    if (room.seats.every((s) => s !== null)) throw new Error('room-full')
  }
  const session = guestSession(code, uid)
  await session.send({ kind: 'join', name })
  return session
}
