import { apply, createMatch, pendingSeats, toPublic, visibleHand } from '../engine'
import type { Action, State } from '../engine'
import { botAction, BOT_LEVELS } from '../bots/bot'
import type { BotLevel } from '../bots/bot'
import { HEARTBEAT_MS } from './link-firestore'
import type { KeyValueStore } from './link-local'
import type { HandDoc, Intent, RoomOpts, SeatInfo } from './net-types'
import { BOT_UID_PREFIX, DEFAULT_ROOM_OPTS } from './net-types'
import type { HostLink } from './transport'

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
  /** Where the full engine state is kept for reload recovery. Only this
   *  browser (same anonymous uid) can be host, so it never leaves the device.
   *  Default: localStorage when present; none in plain Node. */
  storage?: KeyValueStore
  /** Test hook: called after every landed commit. */
  onCommit?: () => void
}

const engineKey = (code: string) => `koejon-engine-${code}`

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
  private botTimer: ReturnType<typeof setTimeout> | null = null
  private hbTimer: ReturnType<typeof setInterval> | null = null
  private releaseLock: (() => void) | null = null
  private botDelay: () => number
  private heartbeatMs: number
  private drawLingerMs: number
  private bidLingerMs: number
  private storage: HostOptions['storage']
  private onCommit: HostOptions['onCommit']

  private constructor(
    private code: string,
    private uid: string,
    private link: HostLink,
    opts: HostOptions = {},
  ) {
    this.heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS
    this.botDelay = opts.botDelay ?? (() => 500 + Math.random() * 500)
    this.drawLingerMs = opts.drawLingerMs ?? 3000
    this.bidLingerMs = opts.bidLingerMs ?? 2000
    this.storage = opts.storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage)
    this.onCommit = opts.onCommit
  }

  /** Load persisted engine state and room seats, then start listening. */
  static async attach(code: string, uid: string, link: HostLink, opts?: HostOptions): Promise<HostGame> {
    const h = new HostGame(code, uid, link, opts)
    await h.lockTab()
    try {
      await h.load()
    } catch (e) {
      // The link stays usable: the caller may retry attach on it.
      h.releaseLock?.()
      throw e
    }
    h.link.onIntent(
      (uid, intent) =>
        new Promise((resolve) => h.enqueue(() => h.processIntent(uid, intent).finally(resolve))),
    )
    h.hbTimer = setInterval(() => {
      h.link.heartbeat()
      // Watchdog: re-arm bot scheduling in case a wakeup was ever missed.
      h.scheduleBots()
    }, h.heartbeatMs)
    // After a reload: one publish gives this tab and every guest the current
    // state (own hand included) without waiting for the next move.
    if (h.state.phase !== 'LOBBY') h.enqueue(() => h.commit())
    h.scheduleBots()
    return h
  }

  private async load(): Promise<void> {
    const room = await this.link.load()
    if (!room) throw new Error('room-not-found')
    if (room.hostUid !== this.uid) throw new Error('not-host')
    this.seats = room.seats
    this.version = room.version
    this.opts = room.opts ?? { ...DEFAULT_ROOM_OPTS }
    // A lobby has no engine state worth keeping (seats live in the room), and
    // a saved one may be left over from an earlier solo match.
    const inLobby = !room.pub || room.pub.phase === 'LOBBY'
    const saved = inLobby ? null : this.readEngine()
    if (saved) this.state = saved
    else if (inLobby) this.state = createMatch((Math.random() * 2 ** 31) | 0)
    else throw new Error('engine-lost')
  }

  /** One host tab per room: a second one would answer the same guests. */
  private async lockTab(): Promise<void> {
    const locks = (globalThis.navigator as Navigator | undefined)?.locks
    if (!locks) return
    // Wait a moment: a tab that just reloaded or left may still be releasing it.
    const got = await new Promise<boolean>((resolve) => {
      locks
        .request(`koejon-host-${this.code}`, { signal: AbortSignal.timeout(2000) }, () => {
          resolve(true)
          // Held until dispose.
          return new Promise<void>((release) => (this.releaseLock = release))
        })
        .catch(() => resolve(false))
    })
    if (!got) throw new Error('host-elsewhere')
  }

  dispose(): void {
    this.link.dispose()
    this.releaseLock?.()
    this.releaseLock = null
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

  /** The host's own intents: applied in place, no Firestore round trip. */
  submit(intent: Intent): void {
    // Plain-data copy, as the wire would make: UI values can be Svelte proxies,
    // which the engine's structuredClone cannot copy once they sit in the state.
    const plain = JSON.parse(JSON.stringify(intent)) as Intent
    this.enqueue(() => this.processIntent(this.uid, plain))
  }

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
      // The lobby state is an untouched createMatch(seed): keep its seed.
      await this.beginMatch(this.state.seed)
    })
  }

  /** After GAME_OVER: reset to a fresh match and go straight to the draw. */
  newMatch(): void {
    this.enqueue(async () => {
      if (this.state.phase !== 'GAME_OVER') return
      await this.beginMatch((Math.random() * 2 ** 31) | 0)
    })
  }

  /** A fresh match, started into the dealer draw. Each team's drawing player
   *  is a human seat when the team has one. */
  private async beginMatch(seed: number): Promise<void> {
    const humanSeat = (team: number) =>
      this.seats.findIndex((s, i) => i % 2 === team && s !== null && !s.bot)
    const drawerA = humanSeat(0)
    const drawerB = humanSeat(1)
    this.state = createMatch(seed, [drawerA >= 0 ? drawerA : 0, drawerB >= 0 ? drawerB : 1])
    const hostSeat = Math.max(0, this.seats.findIndex((s) => s?.uid === this.uid))
    this.state = apply(this.state, { type: 'start', seat: hostSeat })
    await this.commit()
  }

  /** Drop a stuck human seat: cleared in the lobby, a bot takes over mid-game. */
  kickSeat(seat: number): void {
    this.enqueue(async () => {
      const s = this.seats[seat]
      if (!s || s.bot || s.uid === this.uid) return
      if (this.state.phase === 'LOBBY') {
        this.seats[seat] = null
      } else {
        // Unlike a voluntary leave, the seat gets a bot uid: a kicked player
        // cannot reclaim it by rejoining. The next publish drops their hand.
        this.seats[seat] = { uid: `${BOT_UID_PREFIX}${seat}`, name: s.name, bot: true }
      }
      await this.commit()
    })
  }

  /** Delete the room tree and stop. Called when the host leaves for good. */
  async destroyRoom(): Promise<void> {
    this.dispose()
    await this.busy.catch(() => {})
    await this.link.destroy(this.seats.flatMap((s) => (s && !s.bot ? [s.uid] : [])))
    try {
      this.storage?.removeItem(engineKey(this.code))
    } catch {
      // Storage blocked: nothing to clean up.
    }
  }

  // ---- intents from players ----

  private async processIntent(uid: string, intent: Intent): Promise<void> {
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
          // player can reclaim it by rejoining the room. The next publish
          // drops their hand.
          this.seats[i] = { uid, name: this.seats[i]!.name, bot: true }
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

  private readEngine(): State | null {
    try {
      const json = this.storage?.getItem(engineKey(this.code))
      return json ? (JSON.parse(json) as State) : null
    } catch {
      return null
    }
  }

  private async commit(): Promise<void> {
    this.drainBotAcks()
    try {
      this.storage?.setItem(engineKey(this.code), JSON.stringify(this.state))
    } catch {
      // Storage full or blocked: the game goes on, only reload recovery is lost.
    }
    const hands = new Map<string, HandDoc>()
    this.seats.forEach((seat, i) => {
      if (seat && !seat.bot) hands.set(seat.uid, { cards: visibleHand(this.state, i) })
    })
    // The version only moves forward when the publish lands.
    await this.link.publish(
      { seats: this.seats, pub: toPublic(this.state), version: this.version + 1, opts: this.opts },
      hands,
    )
    this.version++
    this.onCommit?.()
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

  private botMove(seat: number): Action {
    return botAction(this.state, seat, Math.random, this.seats[seat]?.botLevel ?? 'normal')
  }

  /** The "seen it" pause exists for humans — bots confirm instantly, inside
   *  the commit that caused the pause instead of one commit per bot. */
  private drainBotAcks(): void {
    while (this.state.phase === 'PLAYING') {
      const seat = this.autoSeat()
      if (seat === undefined || !this.seats[seat]?.bot) return
      const a = this.botMove(seat)
      if (a.type !== 'ack' || !this.tryApply(a)) return
    }
  }

  private scheduleBots(): void {
    if (this.botTimer) return
    if (this.state.phase === 'LOBBY' || this.state.phase === 'GAME_OVER') return
    const seat = this.autoSeat()
    if (seat === undefined) return
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
        if (this.tryApply(this.botMove(seat))) await this.commit()
      })
    }, wait)
  }
}
