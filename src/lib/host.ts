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
import { botAction, BOT_LEVELS } from '../bots/bot'
import type { BotLevel } from '../bots/bot'
import { db } from './firebase'
import { actionsCol, engineRef, handRef, roomRef } from './room'
import type { HostHandsDoc, IntentDoc, RoomDoc, RoomOpts, SeatInfo } from './net-types'
import { BOT_UID_PREFIX, DEFAULT_ROOM_OPTS } from './net-types'

const BOT_NAMES = [
  'Klaas',
  'Grietje',
  'Piet',
  'Truus',
  'Henk',
  'Ans',
  'Jef',
  'Jos',
  'Julia',
  'Marie',
  'Gust',
  'Lea',
]

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
  private opts: RoomOpts = { ...DEFAULT_ROOM_OPTS }
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
    h.opts = room.opts ?? { ...DEFAULT_ROOM_OPTS }
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

  addBot(seat: number, level: BotLevel = 'normal'): void {
    this.enqueue(async () => {
      if (this.state.phase !== 'LOBBY' || this.seats[seat] !== null) return
      const taken = new Set(this.seats.map((s) => s?.name))
      const free = BOT_NAMES.filter((n) => !taken.has(n))
      const name = free[Math.floor(Math.random() * free.length)] ?? `Bot ${seat + 1}`
      this.seats[seat] = { uid: `${BOT_UID_PREFIX}${seat}:${Math.random().toString(36).slice(2, 8)}`, name, bot: true, botLevel: level }
      await this.commit()
    })
  }

  /** Rotate a bot's difficulty: easy → normal → hard. */
  cycleBotLevel(seat: number): void {
    this.enqueue(async () => {
      if (this.state.phase !== 'LOBBY') return
      const s = this.seats[seat]
      if (!s?.bot) return
      const cur = s.botLevel ?? 'normal'
      s.botLevel = BOT_LEVELS[(BOT_LEVELS.indexOf(cur) + 1) % BOT_LEVELS.length]
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

  /** Host toggles a shared display option; guests follow the room value. */
  setOption(key: keyof RoomOpts, value: boolean): void {
    this.enqueue(async () => {
      this.opts = { ...this.opts, [key]: value }
      await this.commit()
    })
  }

  /** Swap two seats — or move into an empty one. */
  swapSeats(a: number, b: number): void {
    this.enqueue(async () => {
      if (this.state.phase !== 'LOBBY' || a === b) return
      ;[this.seats[a], this.seats[b]] = [this.seats[b], this.seats[a]]
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

  /** Drop a stuck human seat: cleared in the lobby, a bot takes over mid-game. */
  kickSeat(seat: number): void {
    this.enqueue(async () => {
      const s = this.seats[seat]
      if (!s || s.bot || s.uid === this.uid) return
      if (this.state.phase === 'LOBBY') {
        this.seats[seat] = null
      } else {
        this.seats[seat] = { uid: `${BOT_UID_PREFIX}${seat}`, name: s.name, bot: true }
        await deleteDoc(handRef(this.code, s.uid)).catch(() => {})
      }
      await this.commit()
    })
  }

  /** Delete the room tree and stop. Called when the host leaves for good. */
  async destroyRoom(): Promise<void> {
    this.dispose()
    await this.busy.catch(() => {})
    const batch = writeBatch(db)
    for (const s of this.seats) {
      if (s && !s.bot) batch.delete(handRef(this.code, s.uid))
    }
    batch.delete(handRef(this.code, 'host'))
    batch.delete(engineRef(this.code))
    batch.delete(roomRef(this.code))
    await batch.commit()
  }

  // ---- intents from players ----

  private async processIntent(uid: string, data: IntentDoc, ref: DocumentReference): Promise<void> {
    try {
      const intent = data.intent
      if (intent.kind === 'join') {
        // Reclaim: the seat is still this uid's, held by a bot since they left.
        const ri = this.seats.findIndex((s) => s?.uid === uid && s.bot)
        if (ri >= 0) {
          this.seats[ri] = {
            uid,
            name: String(intent.name ?? '').slice(0, 20) || this.seats[ri]!.name,
            bot: false,
          }
          await this.commit()
        } else if (this.state.phase === 'LOBBY' && !this.seats.some((s) => s?.uid === uid)) {
          const i = this.seats.findIndex((s) => s === null)
          if (i >= 0) {
            this.seats[i] = {
              uid,
              name: String(intent.name ?? '').slice(0, 20) || 'Speler',
              bot: false,
            }
            await this.commit()
          }
        }
      } else if (intent.kind === 'leave') {
        const i = this.seats.findIndex((s) => s?.uid === uid)
        if (i >= 0) {
          if (this.state.phase === 'LOBBY') {
            this.seats[i] = null
          } else {
            // Mid-game leave: a bot holds the seat, but the uid stays so the
            // player can reclaim it by rejoining the room.
            this.seats[i] = { uid, name: this.seats[i]!.name, bot: true }
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
        // No commit when the action was dropped: a spammed or stale intent
        // must not turn into a full batch write.
        if (seat && seat.uid === uid && startOk && this.tryApply(a)) {
          await this.commit()
        }
      }
    } finally {
      await withTimeout(deleteDoc(ref)).catch(() => {})
    }
  }

  private tryApply(a: Action): boolean {
    try {
      this.state = apply(this.state, a)
      return true
    } catch (e) {
      // Illegal or stale intent: dropped.
      console.warn('[host] dropped action', a.type, 'seat', a.seat, (e as Error).message)
      return false
    }
  }

  // ---- persistence ----

  private async commit(): Promise<void> {
    const batch = writeBatch(db)
    const room: Partial<RoomDoc> = {
      seats: this.seats,
      pub: toPublic(this.state),
      version: this.version + 1,
      heartbeat: Date.now(),
      opts: this.opts,
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
    // The version only moves forward when the write lands: the rules reject a
    // version that is not exactly +1, so a failed commit stays retryable and a
    // second host instance stays fenced out instead of corrupting the room.
    await withTimeout(batch.commit())
    this.version++
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
    const seat = this.autoSeat()
    if (seat === undefined) return
    // The "seen it" pause exists for humans — bots confirm instantly.
    if (botAction(this.state, seat, Math.random, this.seats[seat]?.botLevel ?? 'normal').type === 'ack') {
      this.enqueue(async () => {
        const s = this.autoSeat()
        if (s !== undefined && this.tryApply(botAction(this.state, s, Math.random, this.seats[s]?.botLevel ?? 'normal'))) await this.commit()
      })
      return
    }
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
        const a = botAction(this.state, seat, Math.random, this.seats[seat]?.botLevel ?? 'normal')
        if (this.tryApply(a)) await this.commit()
      })
    }, wait)
  }
}
