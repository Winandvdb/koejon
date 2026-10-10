import { apply, createMatch, legalActions, pendingSeats, START_LINES, teamOf, toPublic, visibleHand } from '../engine'
import type { Action, State } from '../engine'
import { botAction, BOT_LEVELS } from '../bots/bot'
import type { BotLevel } from '../bots/bot'
import type { HandDoc, Intent, QuoteEvent, RoomOpts, SeatInfo } from './net-types'
import { gameDoc, newKjn, recordAction } from './kjn'
import type { GameDoc, KjnMatch, SeatKind } from './kjn'
import { QuoteBook } from './quotes'
import { readJson, safeStorage, type KeyValueStore } from './storage'
import { DEV_DEFAULTS, type DevSettings } from './devsettings'
import { DEAL_MS } from './deckstack'
import { BOT_UID_PREFIX, DEFAULT_ROOM_OPTS } from './net-types'
import { HEARTBEAT_MS, type HostLink } from './transport'

declare const __APP_VERSION__: string
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown'

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
  /** Min. pause after a bid ("Ik ga"/"Pas"/dealer choice) or dealer draw
   *  event before the next automatic action, so the announcement is readable.
   *  Default 2 s. */
  bidLingerMs?: number
  /** Min. pause after the deal before the next automatic action, so every
   *  table can deal the cards out per two first. Default: the deal animation. */
  dealLingerMs?: number
  /** Where the full engine state is kept for reload recovery. Only this
   *  browser (same anonymous uid) can be host, so it never leaves the device.
   *  Default: localStorage when present and not blocked; none in plain Node. */
  storage?: KeyValueStore
  /** Random source for quote rolls. Default Math.random. */
  quoteRand?: () => number
  /** Random source for the match seed, bot names and bot plays. Default
   *  Math.random; a seeded one makes a solo game repeat (`?seed=`, src/lib/seed.ts). */
  rand?: () => number
  /** How long one pending seat may stall before a hurry nag. Default 9 s. */
  hurryMs?: number
  /** Store a finished match as `games/{id}`; `id` stays the same on a retry.
   *  Absent: the host keeps no record (tests, bench). */
  saveGame?: (id: string, game: GameDoc) => Promise<void>
  /** Test hook: called after every landed commit. */
  onCommit?: () => void
  /** Dev build test shortcuts, read at each use so a change applies at once
   *  (tree length: from the next match). Default: none (DEV_DEFAULTS). */
  dev?: () => DevSettings
}

const engineKey = (code: string) => `koejon-engine-${code}`
const seqKey = (code: string) => `koejon-seq-${code}`
const quotesKey = (code: string) => `koejon-quotes-${code}`
const seatsKey = (code: string) => `koejon-seats-${code}`
const kjnKey = (code: string) => `koejon-kjn-${code}`
const finalKey = (code: string) => `koejon-kjn-final-${code}`
/** Every per-room key: destroyRoom removes them all. */
const ROOM_KEYS = [engineKey, seqKey, quotesKey, seatsKey, kjnKey, finalKey]
/** Finished records not uploaded yet, from any room: a new match never drops one. */
const PENDING_KEY = 'koejon-games-pending'
const PENDING_MAX = 20

/** A player name from the wire: text, at most 20 characters. */
const cleanName = (name: unknown): string => String(name ?? '').slice(0, 20)

interface PendingGame {
  /** Fixed doc id, reused on every retry. */
  id: string
  doc: GameDoc
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
  /** Moves on every commit, landed or not: guests may already show that state. */
  private seq = 0
  private busy: Promise<void> = Promise.resolve()
  private botTimer: ReturnType<typeof setTimeout> | null = null
  private hbTimer: ReturnType<typeof setInterval> | null = null
  private releaseLock: (() => void) | null = null
  private botDelay: () => number
  private heartbeatMs: number
  private drawLingerMs: number
  private bidLingerMs: number
  private dealLingerMs: number
  private storage: KeyValueStore
  private onCommit: HostOptions['onCommit']
  private saveGame: HostOptions['saveGame']
  private quoteRand: () => number
  private rand: () => number
  private hurryMs: number
  private dev: () => DevSettings
  private quoteBook = new QuoteBook()
  /** Quotes fired this match, newest last — published on every update. */
  private quoteLog: QuoteEvent[] = []
  /** The seat the table is waiting on, for the hurry nag; -1 = nobody. */
  private waitSeat = -1
  private waitTimer: ReturnType<typeof setTimeout> | null = null
  /** KJN record of the match in progress. Null when the host cannot upload,
   *  and for a match that started before this host recorded. */
  private kjn: KjnMatch | null = null
  /** KJN text of the finished match, sent to every client in GAME_OVER. */
  private finalKjn: string | null = null
  private uploading = false
  private disposed = false
  private onOnline = () => this.flushPending()

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
    // A little over the animation: a guest sees the deal a moment later.
    this.dealLingerMs = opts.dealLingerMs ?? DEAL_MS + 300
    this.storage = opts.storage ?? safeStorage
    this.onCommit = opts.onCommit
    this.saveGame = opts.saveGame
    this.quoteRand = opts.quoteRand ?? Math.random
    this.rand = opts.rand ?? Math.random
    this.hurryMs = opts.hurryMs ?? 9000
    this.dev = opts.dev ?? (() => DEV_DEFAULTS)
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
      h.armHurry()
    }, h.heartbeatMs)
    // After a reload: one publish gives this tab and every guest the current
    // state (own hand included) without waiting for the next move.
    if (h.state.phase !== 'LOBBY') h.enqueue(() => h.commit())
    h.scheduleBots()
    // Records left by an offline match or an earlier session.
    globalThis.addEventListener?.('online', h.onOnline)
    h.flushPending()
    return h
  }

  private async load(): Promise<void> {
    const room = await this.link.load()
    if (!room) throw new Error('room-not-found')
    if (room.hostUid !== this.uid) throw new Error('not-host')
    this.seats = room.seats
    this.version = room.version
    // The room doc can trail what guests saw over a data channel: the stored
    // counter keeps a reloaded host above it.
    this.seq = Math.max(room.seq ?? 0, this.readSeq())
    this.opts = room.opts ?? { ...DEFAULT_ROOM_OPTS }
    // A lobby has no engine state worth keeping (seats live in the room), and
    // a saved one may be left over from an earlier solo match.
    const inLobby = !room.pub || room.pub.phase === 'LOBBY'
    const saved = inLobby ? null : this.readEngine()
    if (saved) {
      this.state = saved
      // The P2P host writes the room doc only on a lobby-view change, and a
      // failed write waits for the next one: its seats can be older than ours.
      this.seats = this.readSeats() ?? this.seats
      this.quoteBook = this.readQuotes() ?? this.quoteBook
      this.kjn = this.readKjn()
      this.finalKjn = saved.phase === 'GAME_OVER' ? this.readFinal() : null
    } else if (inLobby) this.state = createMatch((this.rand() * 2 ** 31) | 0)
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
        // Only a timeout means another tab holds it. With site data blocked the
        // browser denies every lock (SecurityError); tabs then share no storage
        // either, so play on without one.
        .catch((e) => resolve((e as DOMException)?.name !== 'TimeoutError'))
    })
    if (!got) throw new Error('host-elsewhere')
  }

  dispose(): void {
    this.disposed = true
    globalThis.removeEventListener?.('online', this.onOnline)
    this.link.dispose()
    this.releaseLock?.()
    this.releaseLock = null
    if (this.botTimer) clearTimeout(this.botTimer)
    if (this.waitTimer) clearTimeout(this.waitTimer)
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
      const name = free[Math.floor(this.rand() * free.length)] ?? `Bot ${seat + 1}`
      this.seats[seat] = { uid: this.botUid(seat), name, bot: true, botLevel: level }
      await this.commit()
    })
  }

  /** A uid for a bot that no player can claim. A player who leaves keeps their
   *  own uid on the bot seat instead, so they can reclaim it. */
  private botUid(seat: number): string {
    return `${BOT_UID_PREFIX}${seat}:${this.rand().toString(36).slice(2, 8)}`
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
        const j = Math.floor(this.rand() * (i + 1))
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

  /** A dev setting changed: act on it now, not at the next move. A waiting
   *  bot timer restarts with the new speed; the commit drains acks and
   *  schedules the seats that the new settings hand to the bot logic. */
  devChanged(): void {
    this.enqueue(async () => {
      if (this.botTimer) clearTimeout(this.botTimer)
      this.botTimer = null
      if (this.state.phase !== 'LOBBY' && this.state.phase !== 'GAME_OVER') await this.commit()
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
      await this.beginMatch((this.rand() * 2 ** 31) | 0)
    })
  }

  /** A fresh match, started into the dealer draw. Each team's drawing player
   *  is a human seat when the team has one. */
  private async beginMatch(seed: number): Promise<void> {
    const humanSeat = (team: number) =>
      this.seats.findIndex((s, i) => teamOf(i) === team && s !== null && !s.bot)
    const drawerA = humanSeat(0)
    const drawerB = humanSeat(1)
    const dev = this.dev()
    this.state = createMatch(seed, [drawerA >= 0 ? drawerA : 0, drawerB >= 0 ? drawerB : 1], dev.treeLength)
    // A new match resets which lines were said.
    this.quoteBook.reset()
    this.quoteLog = []
    // A host that cannot upload (tests, bench) keeps no record. KJN/1 is frozen
    // and has no field for another tree length or a bot on the host's seat.
    const normal = dev.treeLength === START_LINES && !dev.autoplay
    this.kjn = this.saveGame && normal ? newKjn(APP_VERSION, this.seatKinds()) : null
    this.finalKjn = null
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
        console.warn('[host] seat', seat, 'uid', s.uid, 'turns bot: kick')
        this.seats[seat] = { uid: this.botUid(seat), name: s.name, bot: true }
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
      for (const key of ROOM_KEYS) this.storage.removeItem(key(this.code))
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
          name: cleanName(intent.name) || this.seats[ri]!.name,
          bot: false,
        }
        await this.commit()
      } else if (this.state.phase === 'LOBBY' && !this.seats.some((s) => s?.uid === uid)) {
        const i = this.seats.findIndex((s) => s === null)
        if (i >= 0) {
          this.seats[i] = {
            uid,
            name: cleanName(intent.name) || 'Speler',
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
          if (!this.seats[i]!.bot) console.warn('[host] seat', i, 'uid', uid, 'turns bot: leave intent')
          this.seats[i] = { uid, name: this.seats[i]!.name, bot: true }
        }
        await this.commit()
      }
    } else if (intent.kind === 'act') {
      const a = intent.action
      const seat = this.seats[a.seat]
      // `start` only goes through beginMatch (record, drawers, quotes): an
      // intent for it is dropped, like any other illegal action.
      if (a.type === 'start') {
        console.warn('[host] dropped action start from uid', uid)
        return
      }
      // No commit when the action was dropped: a spammed or stale intent
      // must not turn into a full batch write.
      if (seat && seat.uid === uid && this.tryApply(a)) {
        await this.commit()
      }
    }
  }

  private tryApply(a: Action): boolean {
    let next: State
    try {
      next = apply(this.state, a)
    } catch (e) {
      // Illegal or stale intent: dropped.
      console.warn('[host] dropped action', a.type, 'seat', a.seat, (e as Error).message)
      return false
    }
    if (this.kjn) {
      try {
        recordAction(this.kjn, this.state, a, next)
        if (next.phase === 'GAME_OVER') this.finishRecord()
      } catch (e) {
        // The record is analysis data: it must never stop a match.
        console.warn('[host] game record dropped', e)
        this.kjn = null
      }
    }
    this.state = next
    return true
  }

  private seatKinds(): SeatKind[] {
    return this.seats.map((s): SeatKind => (s?.bot ? `bot-${s.botLevel ?? 'normal'}` : 'human'))
  }

  /** A seat that changed hands (leave, kick, reclaim) since the start is `mixed`. */
  private markMixed(): void {
    const now = this.seatKinds()
    this.kjn!.seats = this.kjn!.seats.map((k, i) => (k === now[i] ? k : 'mixed'))
  }

  /** GAME_OVER: the record moves to the upload queue. Only a match that a
   *  human played to the end is kept: bot data must not reach the stored
   *  matches, nor the local history or a download. */
  private finishRecord(): void {
    this.markMixed()
    const doc = this.kjn!.seats.includes('human') ? gameDoc(this.kjn!) : null
    this.kjn = null
    if (!doc) return
    this.finalKjn = doc.kjn
    const id = crypto.randomUUID().replace(/-/g, '')
    this.writePending([...this.readPending(), { id, doc }].slice(-PENDING_MAX))
  }

  /** Upload queued records one by one; a failed one stays for the next try. */
  private flushPending(): void {
    const save = this.saveGame
    if (this.uploading || this.disposed || !save) return
    const next = this.readPending()[0]
    if (!next) return
    this.uploading = true
    save(next.id, next.doc)
      .then(() => true)
      .catch((e) => {
        console.warn('[host] game upload failed', e)
        // Denied never turns into allowed: the doc already landed (write-once)
        // or the rules refuse it. Anything else (offline) is retried later.
        return (e as { code?: string })?.code === 'permission-denied'
      })
      .then((done) => {
        this.uploading = false
        if (!done) return
        this.writePending(this.readPending().filter((p) => p.id !== next.id))
        this.flushPending()
      })
  }

  // ---- persistence ----

  private readEngine = () => readJson<State | null>(this.storage, engineKey(this.code), null)

  private readSeats = () => readJson<(SeatInfo | null)[] | null>(this.storage, seatsKey(this.code), null)

  private readSeq(): number {
    try {
      return Number(this.storage.getItem(seqKey(this.code)) ?? 0) || 0
    } catch {
      return 0
    }
  }

  /** Said-lines bookkeeping survives a reload, like the engine state. */
  private readQuotes(): QuoteBook | null {
    const saved = readJson<Parameters<typeof QuoteBook.fromJSON>[0] | null>(this.storage, quotesKey(this.code), null)
    try {
      return saved ? QuoteBook.fromJSON(saved) : null
    } catch {
      return null
    }
  }

  private writeQuotes(): void {
    try {
      this.storage.setItem(quotesKey(this.code), JSON.stringify(this.quoteBook))
    } catch {
      // Storage full or blocked: quotes may repeat after a reload.
    }
  }

  /** A fired quote joins the log (the last 12 are published) and is saved. */
  private addQuote(q: QuoteEvent): void {
    this.quoteLog = [...this.quoteLog, q].slice(-12)
    this.writeQuotes()
  }

  private readKjn = () => readJson<KjnMatch | null>(this.storage, kjnKey(this.code), null)

  private readFinal(): string | null {
    try {
      return this.storage.getItem(finalKey(this.code)) ?? null
    } catch {
      return null
    }
  }

  private readPending(): PendingGame[] {
    const list = readJson<unknown>(this.storage, PENDING_KEY, [])
    return Array.isArray(list) ? (list as PendingGame[]) : []
  }

  private writePending(list: PendingGame[]): void {
    try {
      if (list.length) this.storage.setItem(PENDING_KEY, JSON.stringify(list))
      else this.storage.removeItem(PENDING_KEY)
    } catch {
      // Storage full or blocked: this record is lost, which is acceptable.
    }
  }

  private async commit(): Promise<void> {
    this.drainBotAcks()
    const seq = ++this.seq
    if (this.kjn) this.markMixed()
    try {
      this.storage.setItem(engineKey(this.code), JSON.stringify(this.state))
      this.storage.setItem(seqKey(this.code), String(seq))
      this.storage.setItem(seatsKey(this.code), JSON.stringify(this.seats))
      if (this.kjn) this.storage.setItem(kjnKey(this.code), JSON.stringify(this.kjn))
      else this.storage.removeItem(kjnKey(this.code))
      if (this.finalKjn) this.storage.setItem(finalKey(this.code), this.finalKjn)
      else this.storage.removeItem(finalKey(this.code))
    } catch {
      // Storage full or blocked: the game goes on, only reload recovery is lost.
    }
    this.flushPending()
    const hands = new Map<string, HandDoc>()
    this.seats.forEach((seat, i) => {
      if (seat && !seat.bot) hands.set(seat.uid, { cards: visibleHand(this.state, i) })
    })
    const pub = toPublic(this.state)
    // The host decides which quotes fire: every client then shows the same.
    const q = this.quoteBook.pick(pub, Date.now(), this.quoteRand)
    if (q) this.addQuote(q)
    // Only once all hands are played out: the record holds every dealt card.
    const kjn = this.state.phase === 'GAME_OVER' ? this.finalKjn : null
    // The version only moves forward when the publish lands.
    await this.link.publish(
      { seats: this.seats, pub, version: this.version + 1, seq, opts: this.opts, quotes: this.quoteLog, kjn },
      hands,
    )
    this.version++
    this.onCommit?.()
    this.scheduleBots()
    this.armHurry()
  }

  // ---- bots ----

  /** Seat the host should act for: any bot, plus the deal itself for anyone.
   *  Lifting a packet and picking the dealer stay real choices, and a scored
   *  hand stays up until a human clicks "next hand" — unless a dev setting
   *  hands these to the bot logic. */
  private autoSeat(): number | undefined {
    const dev = this.dev()
    const pend = pendingSeats(this.state)
    const bot = pend.find((i) => this.isBot(i))
    if (this.state.phase === 'SCORED') return dev.autoplay ? bot : undefined
    if (bot !== undefined) return bot
    if (this.state.phase === 'DEALING') return pend[0]
    if (!dev.interactiveDraws && (this.state.phase === 'DEALER_DRAW' || this.state.phase === 'CUTTING')) return pend[0]
    return undefined
  }

  /** A bot seat, or the host's own seat while dev autoplay is on. */
  private isBot(seat: number): boolean {
    const s = this.seats[seat]
    return !!s?.bot || (!!s && s.uid === this.uid && this.dev().autoplay)
  }

  private botMove(seat: number): Action {
    // Dev autoplay or draws off: the record would call a bot choice human.
    // The deal is no choice, so it keeps the record.
    if (!this.seats[seat]?.bot && this.state.phase !== 'DEALING') this.kjn = null
    return botAction(this.state, seat, this.rand, this.seats[seat]?.botLevel ?? 'normal')
  }

  /** The "seen it" pause exists for humans — bots confirm instantly, inside
   *  the commit that caused the pause instead of one commit per bot. A
   *  troefke confirms too: dropping it would make the bot roll again later. */
  private drainBotAcks(): void {
    while (this.state.phase === 'PLAYING') {
      // Dev "skip Gezien": a plain ack for each waiting human. Troefke stays
      // theirs to ask: it is legal until the partner's first lead.
      if (this.dev().skipSeen) {
        const human = pendingSeats(this.state).find(
          (i) => !this.isBot(i) && legalActions(this.state, i).some((x) => x.type === 'ack'),
        )
        if (human !== undefined && this.tryApply({ type: 'ack', seat: human })) continue
      }
      const seat = this.autoSeat()
      if (seat === undefined || !this.isBot(seat)) return
      // Ask the bot only when it can ack: a move thrown away would still draw
      // from this.rand, and a seeded game would then depend on extra commits.
      if (!legalActions(this.state, seat).some((x) => x.type === 'ack' || x.type === 'troefke')) return
      const a = this.botMove(seat)
      if ((a.type !== 'ack' && a.type !== 'troefke') || !this.tryApply(a)) return
    }
  }

  private scheduleBots(): void {
    if (this.botTimer) return
    if (this.state.phase === 'LOBBY' || this.state.phase === 'GAME_OVER') return
    const seat = this.autoSeat()
    if (seat === undefined) return
    // Announce the dealer for a moment before the cards go out.
    const drawLinger = this.state.phase === 'DEALING'
    // A bid or dealer draw just got announced:
    // pause before the next automatic action so the announcement is readable.
    const lastEv = this.state.log[this.state.log.length - 1]?.t
    const bidLinger =
      lastEv === 'pass' ||
      lastEv === 'play-call' ||
      lastEv === 'dealer-pass' ||
      lastEv === 'second-card' ||
      lastEv === 'draw' ||
      lastEv === 'draw-tie' ||
      lastEv === 'draw-win'
    // The cards just went out: every table deals them per two first.
    const dealLinger = lastEv === 'deal'
    const speed = this.dev().speed
    const base = Math.max(
      this.botDelay(),
      drawLinger ? this.drawLingerMs : 0,
      bidLinger ? this.bidLingerMs : 0,
      dealLinger ? this.dealLingerMs : 0,
    )
    const wait = speed === 'instant' ? 0 : base / speed
    this.botTimer = setTimeout(() => {
      this.botTimer = null
      this.enqueue(async () => {
        const seat = this.autoSeat()
        if (seat === undefined) return
        if (this.tryApply(this.botMove(seat))) await this.commit()
      })
    }, wait)
  }

  // ---- table talk ----

  /** Nag a seat that keeps the table waiting: one pending actor for > 9 s.
   *  The host fires it and commits, so all clients see the same nag. */
  private armHurry(): void {
    const pend = pendingSeats(this.state)
    const seat = pend.length === 1 ? pend[0] : -1
    if (seat !== this.waitSeat) {
      this.waitSeat = seat
      if (this.waitTimer) clearTimeout(this.waitTimer)
      this.waitTimer = null
    }
    if (seat < 0 || this.waitTimer) return
    this.waitTimer = setTimeout(() => {
      this.waitTimer = null
      this.enqueue(async () => {
        const still = pendingSeats(this.state)
        if (still.length !== 1 || still[0] !== seat) return
        const q = this.quoteBook.hurry(seat, Date.now(), this.quoteRand)
        if (q) {
          this.addQuote(q)
          await this.commit() // publishes the nag and re-arms this timer
        } else {
          // Every bystander is on cooldown: try again later.
          this.waitSeat = -1
          this.armHurry()
        }
      })
    }, this.hurryMs)
  }
}
