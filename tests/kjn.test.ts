import { describe, expect, it, test } from 'vitest'
import { apply, createMatch, pendingSeats } from '../src/engine'
import type { Action, Card, HandResult, State } from '../src/engine'
import { botAction } from '../src/bots/bot'
import { DEV_DEFAULTS, type DevSettings } from '../src/lib/devsettings'
import { HostGame, type HostOptions } from '../src/lib/host'
import type { GameDoc, KjnMatch } from '../src/lib/kjn'
import {
  gameDoc,
  KJN_MAX_CHARS,
  newKjn,
  parseKjn,
  recordAction,
  replayKjn,
  SEAT_KINDS,
  serializeKjn,
} from '../src/lib/kjn'
import { localLinks, SOLO_CODE } from '../src/lib/link-local'
import type { KeyValueStore } from '../src/lib/storage'
import { newRoomDoc, RoomSession, type SessionView } from '../src/lib/room'
import type { GuestEvents, GuestLink, HostLink } from '../src/lib/transport'
import { seededRandom } from '../src/lib/seed'
import { memoryStore, until } from './helpers'

const MATCHES = 30

interface TruthHand {
  dealer: number
  hands: Card[][]
  actions: Action[]
  result: HandResult | null
}

/** A bot match, recorded as KJN and, separately, straight from the engine. */
function runMatch(seed: number): { rec: KjnMatch; truth: TruthHand[]; final: State } {
  let s = createMatch(seed)
  const rand = seededRandom(seed * 7919 + 13)
  const rec = newKjn('test', ['bot-normal', 'bot-normal', 'bot-normal', 'bot-normal'])
  const truth: TruthHand[] = []
  for (let steps = 0; s.phase !== 'GAME_OVER'; steps++) {
    if (steps > 20000) throw new Error(`match ${seed} did not terminate`)
    const a = botAction(s, pendingSeats(s)[0], rand)
    const next = apply(s, a)
    recordAction(rec, s, a, next)
    if (a.type === 'deal') {
      truth.push({ dealer: next.dealer, hands: structuredClone(next.hands), actions: [], result: null })
    } else if (a.type === 'bid' || a.type === 'choose' || a.type === 'troefke' || a.type === 'play') {
      truth.at(-1)!.actions.push(a)
    }
    if (s.phase === 'PLAYING' && next.phase !== 'PLAYING') truth.at(-1)!.result = next.lastResult
    s = next
  }
  return { rec, truth, final: s }
}

/** The decisions of a recorded hand, as engine actions in play order. */
function recordedActions(h: KjnMatch['hands'][number]): Action[] {
  const out: Action[] = h.auction.flat().map((b) => ({ type: 'bid', seat: b.seat, play: b.play }))
  if (h.choice !== undefined) out.push({ type: 'choose', seat: h.dealer, suit: h.choice })
  if (h.troefke) out.push({ type: 'troefke', seat: h.contract!.bidder })
  for (const t of h.tricks) {
    t.cards.forEach((card, i) => out.push({ type: 'play', seat: (t.leader + i) % 4, card }))
  }
  return out
}

function resultOf(r: HandResult) {
  const crossed = [0, 0]
  crossed[r.winnerTeam] = r.erased
  return { playing: r.playingTeam, points: r.points, crossed, kapot: r.kapot, koei: r.koei }
}

describe('KJN/1 from bot matches', () => {
  it(`records ${MATCHES} complete matches canonically and replays them`, () => {
    const seen = { passed: 0, level1: 0, level2: 0, round2: 0, choice: 0, troefke: 0 }
    let maxChars = 0
    for (let seed = 1; seed <= MATCHES; seed++) {
      const { rec, truth, final } = runMatch(seed)
      const text = serializeKjn(rec)
      maxChars = Math.max(maxChars, text.length)
      const parsed = parseKjn(text)
      expect(parsed).toEqual(rec)
      expect(serializeKjn(parsed)).toBe(text)

      expect(parsed.hands).toHaveLength(truth.length)
      parsed.hands.forEach((h, i) => {
        const t = truth[i]
        expect(h.dealer).toBe(t.dealer)
        expect(h.deal).toEqual(t.hands)
        expect(recordedActions(h)).toEqual(t.actions)
        expect(h.result).toEqual(t.result && resultOf(t.result))
        if (!h.contract) seen.passed++
        else if (h.contract.level === 1) seen.level1++
        else seen.level2++
        if (h.auction.length === 2) seen.round2++
        if (h.choice) seen.choice++
        if (h.troefke) seen.troefke++
      })
      expect(parsed.winner).toBe(final.winner)
      expect(parsed.lines).toEqual(final.lines)

      const end = replayKjn(parsed)
      expect(end.phase).toBe('GAME_OVER')
      expect(end.winner).toBe(final.winner)
      expect(end.lines).toEqual(final.lines)
    }
    for (const [k, n] of Object.entries(seen)) expect(n, k).toBeGreaterThan(0)
    expect(maxChars).toBeLessThan(30_000)
  }, 120_000)
})

/**
 * Frozen KJN/1 sample. If this test needs a change, the change is
 * incompatible: bump the format to KJN/2 instead of editing KJN/1.
 */
const SAMPLE = `[Format "KJN/1"]
[App "abc1234"]
[Seats "human bot-normal mixed bot-hard"]
[Winner "1"]
[Lines "12 0"]

[Hand "1"]
[Dealer "0"]
[Deal "S9 ST SJ SQ SK SA / H9 HT HJ HQ HK HA / D9 DT DJ DQ DK DA / C9 CT CJ CQ CK CA"]
[Turned "SA SK"]
[Auction "1P 2P 3P"]
[Choice "-"]
[Contract "-"]

[Hand "2"]
[Dealer "1"]
[Deal "S9 ST SJ SQ SK SA / H9 HT HJ HQ DA HA / D9 DT DJ DQ DK HK / C9 CT CJ CQ CK CA"]
[Turned "HA DA"]
[Auction "2P 3P 0P / 2P 3G"]
[Contract "3 D 2"]
[Troefke "1"]
[Play "2 DK CA SA DA / 1 HA D9 C9 S9"]
[Playing "1"]
[Points "0 28"]
[Crossed "0 3"]
[Kapot "1"]
[Koei "0"]
`

describe('KJN/1 format', () => {
  it('parses the frozen sample and writes it back byte for byte', () => {
    const m = parseKjn(SAMPLE)
    expect(m.seats).toEqual(['human', 'bot-normal', 'mixed', 'bot-hard'])
    expect(m.hands[0].contract).toBeNull()
    expect(m.hands[0].choice).toBeNull()
    expect(m.hands[1].auction).toHaveLength(2)
    expect(m.hands[1].contract).toEqual({ bidder: 3, trump: 'D', level: 2 })
    expect(m.hands[1].tricks[0]).toEqual({
      leader: 2,
      cards: [
        { s: 'D', r: 'K' },
        { s: 'C', r: 'A' },
        { s: 'S', r: 'A' },
        { s: 'D', r: 'A' },
      ],
    })
    expect(serializeKjn(m)).toBe(SAMPLE)
  })

  it('rejects other versions and non-canonical text', () => {
    expect(() => parseKjn(SAMPLE.replace('KJN/1', 'KJN/2'))).toThrow(/unsupported format/)
    expect(() => parseKjn(SAMPLE.replace('[Hand "1"]', '[Hand  "1"]'))).toThrow()
    expect(() => parseKjn(SAMPLE.replace('\n[Dealer "0"]', '\n[Dealer "0"]\n'))).toThrow()
    expect(() => parseKjn(SAMPLE.trimEnd())).toThrow(/final newline/)
    expect(() => parseKjn(SAMPLE.replace('[Turned "SA SK"]', '[Turned "SK SA"]'))).toThrow(/turned/)
  })

  it('makes a games document only for a finished match, without identifiers', () => {
    const { rec } = runMatch(3)
    const doc = gameDoc(rec)!
    expect(Object.keys(doc).sort()).toEqual(['app', 'format', 'hands', 'kjn', 'seats', 'winner'])
    expect(doc.hands).toBe(rec.hands.length)
    expect(gameDoc({ ...rec, winner: null, lines: null })).toBeNull()
  })

  // The Firestore rules check only auth, size and the format tag; the shape
  // of what a build writes is checked here.
  it('writes games documents in the agreed shape', () => {
    const doc = gameDoc({ ...runMatch(4).rec, seats: ['human', 'bot-easy', 'mixed', 'bot-hard'] })!
    expect(doc.format).toMatch(/^KJN\/[0-9]+$/)
    expect(doc.app).toMatch(/^[A-Za-z0-9._-]{1,40}$/)
    expect(doc.seats).toHaveLength(4)
    for (const s of doc.seats) expect(SEAT_KINDS).toContain(s)
    expect([0, 1]).toContain(doc.winner)
    expect(doc.hands).toBeGreaterThan(0)
    expect(doc.kjn.startsWith(`[Format "${doc.format}"]\n`)).toBe(true)
    expect(doc.kjn.length).toBeLessThanOrEqual(KJN_MAX_CHARS)
    expect(Object.keys(doc).length).toBeLessThanOrEqual(12)
  })

  it('replay rejects a record that the engine does not reproduce', () => {
    const { rec } = runMatch(5)
    const played = rec.hands.findIndex((h) => h.result)
    const fakeScore = structuredClone(rec)
    fakeScore.hands[played].result!.points = [40, 0]
    expect(() => replayKjn(fakeScore)).toThrow(/result differs/)
    const fakeWinner = { ...structuredClone(rec), winner: 1 - rec.winner! }
    expect(() => replayKjn(fakeWinner)).toThrow(/match result/)
    const fakeCard = structuredClone(rec)
    const t = fakeCard.hands[played].tricks[0]
    ;[t.cards[0], t.cards[1]] = [t.cards[1], t.cards[0]]
    expect(() => replayKjn(fakeCard)).toThrow()
  })
})

// ---- host ----

const UID = 'me'
const OTHER = 'other'
const PENDING = 'koejon-games-pending'

type Save = (id: string, g: GameDoc) => Promise<void>

/** A save that always lands, collecting what it stored. */
const collect =
  (games: GameDoc[], ids: string[] = []): Save =>
  async (id, g) => {
    ids.push(id)
    games.push(g)
  }

/** A host on an in-memory link; without `save` the host cannot upload.
 *  `join` seats a second human on its own session, who plays every turn it
 *  gets: the local link itself serves one uid only. */
async function open(storage: KeyValueStore, fresh: boolean, save?: Save, opts: HostOptions = {}) {
  const links = localLinks(UID, storage, fresh ? newRoomDoc(SOLO_CODE, UID, 'Me') : undefined)!
  let intentCb: Parameters<HostLink['onIntent']>[0] | null = null
  let otherEv: GuestEvents | null = null
  const link: HostLink = {
    ...links.host,
    onIntent: (cb) => {
      intentCb = cb
      links.host.onIntent(cb)
    },
    publish: async (u, hands) => {
      await links.host.publish(u, hands)
      otherEv?.state((await links.host.load())!, hands.get(OTHER) ?? null)
    },
  }
  const session = new RoomSession(SOLO_CODE, UID, links.guest, link)
  const host = await HostGame.attach(SOLO_CODE, UID, link, {
    storage,
    botDelay: () => 0,
    drawLingerMs: 0,
    bidLingerMs: 0,
    dealLingerMs: 0,
    ...(save && { saveGame: save }),
    ...opts,
  })
  host.onError = (e) => {
    throw e
  }
  let latest: SessionView | null = null
  const unsub = session.view.subscribe((v) => {
    latest = v
    const pub = v.room?.pub
    if (!pub || !v.state || pub.phase === 'LOBBY' || pub.phase === 'GAME_OVER') return
    // After a leave a bot holds our seat and we no longer see its hand.
    if (v.room!.seats[v.mySeat]?.bot) return
    if (pub.actionSeats.includes(v.mySeat)) host.submit({ kind: 'act', action: botAction(v.state, v.mySeat) })
  })
  const stops: (() => void)[] = []
  const join = async () => {
    const guest: GuestLink = {
      start: (ev) => void (otherEv = ev),
      send: (intent) => intentCb!(OTHER, structuredClone(intent)),
      dispose: () => void (otherEv = null),
    }
    const other = new RoomSession(SOLO_CODE, OTHER, guest, undefined, memoryStore())
    const unsubOther = other.view.subscribe((v) => {
      const pub = v.room?.pub
      if (!pub || !v.state || pub.phase === 'LOBBY' || pub.phase === 'GAME_OVER') return
      if (pub.actionSeats.includes(v.mySeat)) void other.send({ kind: 'act', action: botAction(v.state, v.mySeat) })
    })
    stops.push(unsubOther, () => other.dispose())
    await other.send({ kind: 'join', name: 'Other' })
  }
  const close = () => {
    unsub()
    stops.forEach((stop) => stop())
    host.dispose()
    session.dispose()
  }
  return { host, view: () => latest, close, join }
}

describe('host game records', () => {
  async function startBots(g: Awaited<ReturnType<typeof open>>) {
    g.host.addBot(1, 'easy')
    g.host.addBot(2)
    g.host.addBot(3, 'hard')
    g.host.startGame()
  }

  test('a match survives a host reload and is uploaded exactly once', async () => {
    const storage = memoryStore()
    const games: GameDoc[] = []
    const first = await open(storage, true, collect(games))
    await startBots(first)
    await until(() => (first.view()?.room?.pub?.handNumber ?? 0) >= 2)
    first.close()
    expect(storage.getItem(`koejon-kjn-${SOLO_CODE}`)).not.toBeNull()

    const second = await open(storage, false, collect(games))
    await until(() => second.view()?.room?.pub?.phase === 'GAME_OVER')
    await until(() => games.length > 0)
    const pub = second.view()!.room!.pub!
    // Later commits in GAME_OVER (a seat leaving) must not upload again.
    const commitsBefore = second.view()!.room!.version
    second.host.submit({ kind: 'leave' })
    await until(() => second.view()!.room!.version > commitsBefore)
    expect(games).toHaveLength(1)
    const rec = parseKjn(games[0].kjn)
    expect(rec.seats).toEqual(['human', 'bot-easy', 'bot-normal', 'bot-hard'])
    // No hand lost to the reload.
    expect(rec.hands).toHaveLength(pub.handNumber)
    expect(rec.winner).toBe(pub.winner)
    expect(games[0].kjn).not.toContain(SOLO_CODE)
    expect(games[0].kjn).not.toContain(UID)
    expect(storage.getItem(`koejon-kjn-${SOLO_CODE}`)).toBeNull()
    expect(storage.getItem(PENDING)).toBeNull()
    second.close()
  }, 60_000)

  test('a failed upload survives a new match and is retried with the same id', async () => {
    const storage = memoryStore()
    const tried: string[] = []
    const ids: string[] = []
    const games: GameDoc[] = []
    const land = collect(games, ids)
    const save: Save = async (id, g) => {
      tried.push(id)
      if (tried.length === 1) throw Object.assign(new Error('offline'), { code: 'unavailable' })
      await land(id, g)
    }
    const g = await open(storage, true, save)
    await startBots(g)
    await until(() => g.view()?.room?.pub?.phase === 'GAME_OVER')
    await until(() => tried.length === 1)
    const firstHands = g.view()!.room!.pub!.handNumber
    expect(storage.getItem(PENDING)).not.toBeNull()
    g.host.newMatch()
    await until(() => games.length > 0)
    expect(ids[0]).toBe(tried[0])
    expect(games[0].hands).toBe(firstHands)
    g.close()
  }, 60_000)

  test('a denied upload is dropped, not retried forever', async () => {
    const storage = memoryStore()
    let tries = 0
    const g = await open(storage, true, async () => {
      tries++
      throw Object.assign(new Error('denied'), { code: 'permission-denied' })
    })
    await startBots(g)
    await until(() => g.view()?.room?.pub?.phase === 'GAME_OVER')
    await until(() => tries === 1 && storage.getItem(PENDING) === null)
    g.close()
  }, 60_000)

  test('a seat that leaves and comes back within a hand is recorded as mixed', async () => {
    const games: GameDoc[] = []
    const g = await open(memoryStore(), true, collect(games))
    // A second human plays the full match: without one, nothing is recorded.
    await g.join()
    g.host.addBot(2)
    g.host.addBot(3, 'hard')
    g.host.startGame()
    await until(() => (g.view()?.room?.pub?.handNumber ?? 0) >= 1)
    const seatIsBot = () => !!g.view()?.room?.seats[0]?.bot
    g.host.submit({ kind: 'leave' })
    await until(seatIsBot)
    // Reclaim before the next deal: only a check on every seat change sees it.
    g.host.submit({ kind: 'join', name: 'Me' })
    await until(() => !seatIsBot())
    await until(() => games.length > 0)
    expect(parseKjn(games[0].kjn).seats).toEqual(['mixed', 'human', 'bot-normal', 'bot-hard'])
    g.close()
  }, 60_000)

  /** A host whose bots can finish a match alone: they wait for a human to
   *  close a scored hand, so `bots()` switches on dev autoplay. Switched on
   *  after the start, it keeps the record. */
  async function openBotsOnly(storage: KeyValueStore, games: GameDoc[]) {
    const dev: Partial<DevSettings> = {}
    const g = await open(storage, true, collect(games), { dev: () => ({ ...DEV_DEFAULTS, ...dev }) })
    const bots = () => {
      dev.autoplay = true
      g.host.devChanged()
    }
    return { ...g, bots }
  }

  /** Nothing of the match is kept: no upload, no queue, no record on the room. */
  function expectNoRecord(storage: KeyValueStore, g: Awaited<ReturnType<typeof open>>, games: GameDoc[]) {
    expect(g.view()!.room!.kjn ?? null).toBeNull()
    expect(storage.getItem(`koejon-kjn-final-${SOLO_CODE}`)).toBeNull()
    expect(storage.getItem(PENDING)).toBeNull()
    expect(games).toEqual([])
  }

  test('a match of bots only is not recorded', async () => {
    const storage = memoryStore()
    const games: GameDoc[] = []
    const g = await openBotsOnly(storage, games)
    // The host gives its own seat to a bot before the start.
    g.host.submit({ kind: 'leave' })
    await until(() => g.view()?.room?.seats[0] === null)
    g.host.addBot(0)
    await startBots(g)
    await until(() => (g.view()?.room?.pub?.handNumber ?? 0) >= 1)
    expect(storage.getItem(`koejon-kjn-${SOLO_CODE}`)).not.toBeNull()
    g.bots()
    await until(() => g.view()?.room?.pub?.phase === 'GAME_OVER')
    expectNoRecord(storage, g, games)
    g.close()
  }, 60_000)

  test('a match that the only human left is not recorded', async () => {
    const storage = memoryStore()
    const games: GameDoc[] = []
    const g = await openBotsOnly(storage, games)
    await startBots(g)
    await until(() => (g.view()?.room?.pub?.handNumber ?? 0) >= 1)
    g.host.submit({ kind: 'leave' })
    await until(() => !!g.view()?.room?.seats[0]?.bot)
    expect(storage.getItem(`koejon-kjn-${SOLO_CODE}`)).not.toBeNull()
    g.bots()
    await until(() => g.view()?.room?.pub?.phase === 'GAME_OVER')
    expectNoRecord(storage, g, games)
    g.close()
  }, 60_000)

  test('a broken record never stops the match', async () => {
    const storage = memoryStore()
    const games: GameDoc[] = []
    const first = await open(storage, true, collect(games))
    await startBots(first)
    await until(() => (first.view()?.room?.pub?.handNumber ?? 0) >= 1)
    first.close()
    const key = `koejon-kjn-${SOLO_CODE}`
    storage.setItem(key, JSON.stringify({ ...JSON.parse(storage.getItem(key)!), hands: null }))

    const second = await open(storage, false, collect(games))
    await until(() => second.view()?.room?.pub?.phase === 'GAME_OVER')
    expect(games).toHaveLength(0)
    expect(storage.getItem(PENDING)).toBeNull()
    second.close()
  }, 60_000)

  test('a link that cannot upload keeps no record', async () => {
    const storage = memoryStore()
    const g = await open(storage, true)
    await startBots(g)
    await until(() => g.view()?.room?.pub?.phase === 'GAME_OVER')
    expect(storage.getItem(`koejon-kjn-${SOLO_CODE}`)).toBeNull()
    expect(storage.getItem(PENDING)).toBeNull()
    g.close()
  }, 60_000)
})
