import {
  deleteDoc,
  getDoc,
  onSnapshot,
  updateDoc,
  writeBatch,
  type DocumentReference,
  type Unsubscribe,
} from 'firebase/firestore'
import { apply, createMatch, pendingSeats, toPublic, visibleHand } from '../engine'
import type { Action, Card, State } from '../engine'
import { botAction } from '../bots/bot'
import { db } from './firebase'
import { actionRef, actionsCol, engineRef, handRef, roomRef } from './room'
import type { HostHandsDoc, IntentDoc, RoomDoc, SeatInfo } from './net-types'
import { BOT_UID_PREFIX } from './net-types'

const BOT_NAMES = ['Klaas', 'Grietje', 'Piet', 'Truus', 'Henk', 'Ans']

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A Firestore write that hangs would freeze the serialized queue forever. */
const withTimeout = <T>(p: Promise<T>, ms = 10_000): Promise<T> =>
  Promise.race([
    p,
    delay(ms).then(() => {
      throw new Error('firestore-write-timeout')
    }),
  ])

export interface HostOptions {
  /** Delay before a bot acts. Default ~0.5–1 s. */
  botDelay?: () => number
  heartbeatMs?: number
  /** Min. pause after the dealer draw completes, so the drawn cards and the
   *  draw winner stay visible before dealing. Default 3 s. */
  drawLingerMs?: number
  /** Min. pause after a bid ("Ik ga"/"Pas"/dealer choice) before the next
   *  automatic action, so the announcement is readable. Default 2 s. */
  bidLingerMs?: number
}

/**
 * The room creator's client runs this. It owns the engine state,
 * executes bot turns, applies player intents, and writes all state.
 */
export class HostGame {
  private state!: State
  private seats: (SeatInfo | null)[] = [null, null, null, null]
  private version = 0
  private busy: Promise<void> = Promise.resolve()
  private unsubs: Unsubscribe[] = []
  private botTimer: ReturnType<typeof setTimeout> | null = null
  private hbTimer: ReturnType<typeof setInterval> | null = null
  private botDelay: () => number
  private heartbeatMs: number
  private drawLingerMs: number
  private bidLingerMs: number

  private constructor(
    private code: string,
    private uid: string,
    opts: HostOptions = {},
  ) {
    this.botDelay = opts.botDelay ?? (() => 500 + Math.random() * 500)
    this.heartbeatMs = opts.heartbeatMs ?? 5000
    this.drawLingerMs = opts.drawLingerMs ?? 3000
    this.bidLingerMs = opts.bidLingerMs ?? 2000
  }

  /** Load persisted engine state and room seats, then start listening. */
  static async attach(code: string, uid: string, opts?: HostOptions): Promise<HostGame> {
    const h = new HostGame(code, uid, opts)
    const roomSnap = await getDoc(roomRef(code))
    if (!roomSnap.exists()) throw new Error('room-not-found')
    const room = roomSnap.data() as RoomDoc
    if (room.hostUid !== uid) throw new Error('not-host')
    h.seats = room.seats
    h.version = room.version
    const engSnap = await getDoc(engineRef(code))
    h.state = engSnap.exists()
      ? (JSON.parse((engSnap.data() as { json: string }).json) as State)
      : createMatch((Math.random() * 2 ** 31) | 0)

    h.unsubs.push(
      onSnapshot(
        actionsCol(code),
        (snap) => {
          for (const ch of snap.docChanges()) {
            if (ch.type === 'added' || ch.type === 'modified') {
              const ref = ch.doc.ref
              const data = ch.doc.data() as IntentDoc
              h.enqueue(() => h.processIntent(ch.doc.id, data, ref))
            }
          }
        },
        (err) => console.error('[host] actions listener error', err),
      ),
    )
    h.hbTimer = setInterval(() => {
      updateDoc(roomRef(code), { heartbeat: Date.now() }).catch(() => {})
      // Watchdog: re-arm bot scheduling in case a wakeup was ever missed.
      h.scheduleBots()
    }, h.heartbeatMs)
    h.scheduleBots()
    return h
  }

  dispose(): void {
    for (const u of this.unsubs) u()
    if (this.botTimer) clearTimeout(this.botTimer)
    if (this.hbTimer) clearInterval(this.hbTimer)
  }

  private enqueue(fn: () => Promise<void>): void {
    this.busy = this.busy.then(fn).catch((e) => {
      console.error('[host]', e)
      this.onError?.(e)
    })
  }

  /** Surface queue failures in tests; keeps running otherwise. */
  onError?: (e: unknown) => void

  // ---- lobby operations (host UI calls these directly) ----

  addBot(seat: number): void {
    this.enqueue(async () => {
      if (this.state.phase !== 'LOBBY' || this.seats[seat] !== null) return
      const taken = new Set(this.seats.map((s) => s?.name))
      const name = BOT_NAMES.find((n) => !taken.has(n)) ?? `Bot ${seat + 1}`
      this.seats[seat] = { uid: `${BOT_UID_PREFIX}${seat}:${Math.random().toString(36).slice(2, 8)}`, name, bot: true }
      await this.commit()
    })
  }

  removeBot(seat: number): void {
    this.enqueue(async () => {
      if (this.state.phase !== 'LOBBY') return
      const s = this.seats[seat]
      if (!s?.bot) return
      this.seats[seat] = null
      await this.commit()
    })
  }

  shuffleSeats(): void {
    this.enqueue(async () => {
      if (this.state.phase !== 'LOBBY') return
      for (let i = 3; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[this.seats[i], this.seats[j]] = [this.seats[j], this.seats[i]]
      }
      await this.commit()
    })
  }

  startGame(): void {
    this.enqueue(async () => {
      if (this.state.phase !== 'LOBBY') return
      if (this.seats.some((s) => s === null)) return
      // Prefer a human seat as each team's drawing player.
      const humans = this.seats.map((s, i) => ({ s, i })).filter((x) => x.s && !x.s.bot)
      const drawerA = humans.find((x) => x.i % 2 === 0)?.i ?? 0
      const drawerB = humans.find((x) => x.i % 2 === 1)?.i ?? 1
      this.state.dealerDraw = { drawer: [drawerA, drawerB], draws: [], packetA: null, pending: 0, winnerSeat: null }
      const hostSeat = this.seats.findIndex((s) => s?.uid === this.uid)
      this.state = apply(this.state, { type: 'start', seat: Math.max(0, hostSeat) })
      await this.commit()
    })
  }

  /** After GAME_OVER: reset to a fresh match and go straight to the draw. */
  newMatch(): void {
    this.enqueue(async () => {
      if (this.state.phase !== 'GAME_OVER') return
      const seed = (Math.random() * 2 ** 31) | 0
      const humans = this.seats.map((s, i) => ({ s, i })).filter((x) => x.s && !x.s.bot)
      const drawerA = humans.find((x) => x.i % 2 === 0)?.i ?? 0
      const drawerB = humans.find((x) => x.i % 2 === 1)?.i ?? 1
      this.state = createMatch(seed, [drawerA, drawerB])
      const hostSeat = Math.max(0, this.seats.findIndex((s) => s?.uid === this.uid))
      this.state = apply(this.state, { type: 'start', seat: hostSeat })
      await this.commit()
    })
  }

  /** Host's own game action (host is also a seated player). */
  act(action: Action): void {
    this.enqueue(async () => {
      const seat = this.seats[action.seat]
      if (!seat || seat.uid !== this.uid) return
      this.tryApply(action)
      await this.commit()
    })
  }

  // ---- intents from players ----

  private async processIntent(uid: string, data: IntentDoc, ref: DocumentReference): Promise<void> {
    try {
      const intent = data.intent
      if (intent.kind === 'join') {
        if (this.state.phase === 'LOBBY' && !this.seats.some((s) => s?.uid === uid)) {
          const i = this.seats.findIndex((s) => s === null)
          if (i >= 0) {
            this.seats[i] = { uid, name: intent.name.slice(0, 20) || 'Speler', bot: false }
            await this.commit()
          }
        }
      } else if (intent.kind === 'leave') {
        const i = this.seats.findIndex((s) => s?.uid === uid)
        if (i >= 0) {
          if (this.state.phase === 'LOBBY') {
            this.seats[i] = null
          } else {
            // Mid-game leave: a bot takes over the seat so the match can finish.
            this.seats[i] = { uid: `${BOT_UID_PREFIX}${i}`, name: this.seats[i]!.name, bot: true }
            await deleteDoc(handRef(this.code, uid))
          }
          await this.commit()
        }
      } else if (intent.kind === 'act') {
        const a = intent.action
        const seat = this.seats[a.seat]
        const startOk =
          a.type !== 'start' ||
          (uid === this.uid && this.state.phase === 'LOBBY' && this.seats.every(Boolean))
        if (seat && seat.uid === uid && startOk) {
          this.tryApply(a)
          await this.commit()
        }
      }
    } finally {
      await withTimeout(deleteDoc(ref)).catch(() => {})
    }
  }

  private tryApply(a: Action): void {
    try {
      this.state = apply(this.state, a)
    } catch (e) {
      // Illegal or stale intent: dropped.
      console.warn('[host] dropped action', a.type, 'seat', a.seat, (e as Error).message)
    }
  }

  // ---- persistence ----

  private async commit(): Promise<void> {
    this.version++
    const batch = writeBatch(db)
    const room: Partial<RoomDoc> = {
      seats: this.seats,
      pub: toPublic(this.state),
      version: this.version,
      heartbeat: Date.now(),
    }
    batch.update(roomRef(this.code), room)
    const botHands: Record<number, Card[]> = {}
    for (let i = 0; i < 4; i++) {
      const seat = this.seats[i]
      if (!seat) continue
      if (seat.bot) {
        botHands[i] = this.state.hands[i]
      } else {
        batch.set(handRef(this.code, seat.uid), { cards: visibleHand(this.state, i) })
      }
    }
    batch.set(handRef(this.code, 'host'), { botHands } satisfies HostHandsDoc)
    batch.set(engineRef(this.code), { json: JSON.stringify(this.state) })
    await withTimeout(batch.commit())
    this.scheduleBots()
  }

  // ---- bots ----

  /** Seat the host should act for: any bot, plus automatic steps for anyone —
   *  the packet draws and the deal itself. Picking the dealer stays a real choice,
   *  and a scored hand stays up until a human clicks "next hand". */
  private autoSeat(): number | undefined {
    if (this.state.phase === 'SCORED') return undefined
    const pend = pendingSeats(this.state)
    const bot = pend.find((i) => this.seats[i]?.bot)
    if (bot !== undefined) return bot
    if (this.state.phase === 'DEALER_DRAW' && this.state.dealerDraw?.pending !== 2) return pend[0]
    if (this.state.phase === 'DEALING') return pend[0]
    return undefined
  }

  private scheduleBots(): void {
    if (this.botTimer) return
    if (this.state.phase === 'LOBBY' || this.state.phase === 'GAME_OVER') return
    if (this.autoSeat() === undefined) return
    // Announce the dealer for a moment before the cards go out.
    const drawLinger = this.state.phase === 'DEALING'
    // A bid just got announced ("Ik ga"/"Pas"/dealer choice/second card):
    // pause before the next automatic action so the bubble is readable.
    const lastEv = this.state.log[this.state.log.length - 1]?.t
    const bidLinger =
      lastEv === 'pass' ||
      lastEv === 'play-call' ||
      lastEv === 'dealer-pass' ||
      lastEv === 'second-card'
    const wait = Math.max(
      this.botDelay(),
      drawLinger ? this.drawLingerMs : 0,
      bidLinger ? this.bidLingerMs : 0,
    )
    this.botTimer = setTimeout(() => {
      this.botTimer = null
      this.enqueue(async () => {
        const seat = this.autoSeat()
        if (seat === undefined) return
        const a = botAction(this.state, seat)
        this.tryApply(a)
        await this.commit()
      })
    }, wait)
  }
}

/** Small helper for the e2e script: run a hosted match until done. */
export { delay }
