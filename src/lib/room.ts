import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import { derived, writable, type Readable } from 'svelte/store'
import { clientState, createMatch, legalActions, toPublic } from '../engine'
import type { Action, Card, State } from '../engine'
import { db } from './firebase'
import type { HandDoc, Intent, IntentDoc, RoomDoc } from './net-types'

export const roomRef = (code: string) => doc(db, 'rooms', code)
export const handRef = (code: string, uid: string) => doc(db, 'rooms', code, 'hands', uid)
export const actionRef = (code: string, uid: string) => doc(db, 'rooms', code, 'actions', uid)
export const actionsCol = (code: string) => collection(db, 'rooms', code, 'actions')
export const engineRef = (code: string) => doc(db, 'rooms', code, 'engine', 'state')

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

export interface SessionView {
  room: RoomDoc | null
  /** Own cards; null while the dealer is blind during bidding. */
  hand: Card[] | null
  mySeat: number
  /** Engine-shaped state with only the own hand filled in. */
  state: State | null
  legal: Action[]
  hostStale: boolean
}

export class RoomSession {
  readonly room = writable<RoomDoc | null>(null)
  readonly handDoc = writable<HandDoc | null>(null)
  readonly hostStale = writable(false)
  readonly view: Readable<SessionView>
  private unsubs: Unsubscribe[] = []
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  /** Intents queue behind the action doc: the next one is only written after
   *  the host has processed (deleted) the previous one, so rapid actions can
   *  never overwrite or be deleted unseen. */
  private outbox: { intent: Intent; resolve: () => void; reject: (e: unknown) => void }[] = []
  private sending = false
  private actionDocGone = false
  private disposed = false

  constructor(
    readonly code: string,
    readonly uid: string,
  ) {
    this.unsubs.push(
      onSnapshot(roomRef(code), (snap) => {
        this.room.set(snap.exists() ? (snap.data() as RoomDoc) : null)
      }),
      onSnapshot(handRef(code, uid), (snap) => {
        this.handDoc.set(snap.exists() ? (snap.data() as HandDoc) : null)
      }),
      onSnapshot(
        actionRef(code, uid),
        (snap) => {
          this.actionDocGone = !snap.exists()
          void this.flush()
        },
        (err) => console.error('[room] action-doc listener error', err),
      ),
    )
    this.heartbeatTimer = setInterval(() => this.checkHeartbeat(), 5000)
    this.view = derived([this.room, this.handDoc, this.hostStale], ([room, hd, hostStale]) => {
      const mySeat = seatOf(room, uid)
      const hand = hd?.cards ?? null
      const state = room?.pub && mySeat >= 0 ? clientState(room.pub, mySeat, hand) : null
      const legal = state ? legalActions(state, mySeat) : []
      return { room, hand, mySeat, state, legal, hostStale }
    })
  }

  private checkHeartbeat(): void {
    const room = get0(this.room)
    if (!room) return
    this.hostStale.set(Date.now() - room.heartbeat > 15000)
  }

  send(intent: Intent): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.disposed) return reject(new Error('session-disposed'))
      this.outbox.push({ intent, resolve, reject })
      void this.flush()
    })
  }

  private async flush(): Promise<void> {
    if (this.sending) return
    while (!this.disposed && this.outbox.length > 0 && this.actionDocGone) {
      this.sending = true
      const item = this.outbox.shift()!
      // Mark the doc as present up front. The snapshot stream reports our own
      // write and then the host's delete in order, so it owns the flag again
      // from here — setting it after the await could clobber a delete that
      // already landed.
      this.actionDocGone = false
      try {
        await setDoc(actionRef(this.code, this.uid), {
          intent: item.intent,
          ts: Date.now(),
        } satisfies IntentDoc)
        item.resolve()
      } catch (e) {
        this.actionDocGone = true // nothing was written
        item.reject(e)
      }
      this.sending = false
    }
  }

  act(action: Action): Promise<void> {
    return this.send({ kind: 'act', action })
  }

  leave(): Promise<void> {
    return this.send({ kind: 'leave' })
  }

  dispose(): void {
    this.disposed = true
    for (const it of this.outbox) it.reject(new Error('session-disposed'))
    this.outbox = []
    for (const u of this.unsubs) u()
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
  }
}

function get0<T>(r: Readable<T>): T {
  let v!: T
  const u = r.subscribe((x) => (v = x))
  u()
  return v
}

/** Create a room and return a session. The caller becomes host seat 0. */
export async function createRoom(uid: string, name: string): Promise<RoomSession> {
  for (let tries = 0; tries < 10; tries++) {
    const code = makeCode()
    const ref = roomRef(code)
    const snap = await getDoc(ref)
    if (snap.exists()) continue
    const engine = createMatch((Math.random() * 2 ** 31) | 0)
    const room: RoomDoc = {
      code,
      hostUid: uid,
      seats: [{ uid, name, bot: false }, null, null, null],
      pub: toPublic(engine),
      version: 1,
      heartbeat: Date.now(),
    }
    await setDoc(ref, room)
    await setDoc(engineRef(code), { json: JSON.stringify(engine) })
    return new RoomSession(code, uid)
  }
  throw new Error('could not allocate a room code')
}

/** Join an existing room by code. */
export async function joinRoom(code: string, uid: string, name: string): Promise<RoomSession> {
  code = code.trim().toUpperCase()
  const snap = await getDoc(roomRef(code))
  if (!snap.exists()) throw new Error('room-not-found')
  const room = snap.data() as RoomDoc
  const session = new RoomSession(code, uid)
  if (seatOf(room, uid) >= 0) return session // rejoin
  if (room.pub && room.pub.phase !== 'LOBBY') throw new Error('room-started')
  if (room.seats.every((s) => s !== null)) throw new Error('room-full')
  await session.send({ kind: 'join', name })
  return session
}
