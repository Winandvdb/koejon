import { getDoc, setDoc } from 'firebase/firestore'
import { derived, writable, type Readable } from 'svelte/store'
import { clientState, createMatch, legalActions, toPublic } from '../engine'
import type { Action, Card, State } from '../engine'
import type { HandDoc, Intent, RoomDoc } from './net-types'
import { DEFAULT_ROOM_OPTS } from './net-types'
import { FirestoreGuestLink, roomRef } from './link-firestore'
import { P2P_ENABLED, P2PGuestLink, P2PHostLink } from './link-p2p'
import type { GuestLink, HostLink } from './transport'

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function makeCode(len = 5): string {
  const buf = new Uint8Array(len)
  crypto.getRandomValues(buf)
  return [...buf].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
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
  readonly room = writable<RoomDoc | null>(null)
  readonly handDoc = writable<HandDoc | null>(null)
  readonly hostStale = writable(false)
  readonly connLost = writable(false)
  readonly view: Readable<SessionView>

  constructor(
    readonly code: string,
    readonly uid: string,
    private link: GuestLink,
    /** Set when this tab is the host: `link` is then fed in-tab by it. */
    readonly hostLink?: HostLink,
  ) {
    link.start({
      room: (r) => this.room.set(r),
      hand: (h) => this.handDoc.set(h),
      lost: () => this.connLost.set(true),
      hostStale: (s) => this.hostStale.set(s),
    })
    this.view = derived(
      [this.room, this.handDoc, this.hostStale, this.connLost],
      ([room, hd, hostStale, connLost]) => {
        const mySeat = seatOf(room, uid)
        const hand = hd?.cards ?? null
        const state = room?.pub && mySeat >= 0 ? clientState(room.pub, mySeat, hand) : null
        const legal = state ? legalActions(state, mySeat) : []
        return { room, hand, mySeat, state, legal, hostStale, offline: connLost }
      },
    )
  }

  send(intent: Intent): Promise<void> {
    return this.link.send(intent)
  }

  act(action: Action): Promise<void> {
    return this.send({ kind: 'act', action })
  }

  leave(): Promise<void> {
    return this.send({ kind: 'leave' })
  }

  dispose(): void {
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
