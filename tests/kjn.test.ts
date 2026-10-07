import { describe, expect, it, test } from 'vitest'
import { apply, createMatch, pendingSeats } from '../src/engine'
import type { Action, Card, HandResult, State } from '../src/engine'
import { botAction } from '../src/bots/bot'
import { HostGame } from '../src/lib/host'
import type { GameDoc, KjnMatch } from '../src/lib/kjn'
import { gameDoc, newKjn, parseKjn, recordAction, serializeKjn } from '../src/lib/kjn'
import { localLinks, SOLO_CODE, type KeyValueStore } from '../src/lib/link-local'
import { newRoomDoc, RoomSession, type SessionView } from '../src/lib/room'
import type { HostLink } from '../src/lib/transport'
import { mulberry } from './helpers'

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
  const rand = mulberry(seed * 7919 + 13)
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

/** Replays a record through the engine from its dealt cards only: no seed, no cut. */
function replay(m: KjnMatch): State {
  let s = createMatch(0)
  for (const h of m.hands) {
    const lead = (h.dealer + 1) % 4
    s = {
      ...s,
      phase: 'BIDDING_R1',
      handNumber: s.handNumber + 1,
      dealer: h.dealer,
      dealerDraw: null,
      hands: structuredClone(h.deal),
      turned: { first: h.turned[0], second: h.turned[1], secondUp: false },
      trump: null,
      level: 0,
      bidder: null,
      bidIndex: 0,
      turn: lead,
      leader: lead,
      trick: [],
      lastTrick: null,
      prevTrick: null,
      trickAcks: [lead],
      troefkeAsked: false,
      tricksPlayed: 0,
      tricksWon: [0, 0],
      points: [0, 0],
      piles: [[], []],
    }
    for (const b of h.auction.flat()) s = apply(s, { type: 'bid', ...b })
    if (h.choice !== undefined) s = apply(s, { type: 'choose', seat: h.dealer, suit: h.choice })
    if (!h.contract) {
      expect(s.phase).toBe('CUTTING')
      expect(h.result).toBeNull()
      continue
    }
    expect({ bidder: s.bidder, trump: s.trump, level: s.level }).toEqual(h.contract)
    if (h.troefke) s = apply(s, { type: 'troefke', seat: h.contract.bidder })
    for (const t of h.tricks) {
      expect(s.turn).toBe(t.leader)
      for (const card of t.cards) {
        // Trick acknowledgements are not part of the notation.
        for (const seat of [0, 1, 2, 3]) if (!s.trickAcks.includes(seat)) s = apply(s, { type: 'ack', seat })
        s = apply(s, { type: 'play', seat: s.turn, card })
      }
    }
    expect(resultOf(s.lastResult!)).toEqual(h.result)
  }
  return s
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

      const end = replay(parsed)
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
})

// ---- host ----

function memoryStore(): KeyValueStore {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

async function until(fn: () => boolean, timeout = 30_000): Promise<void> {
  const t0 = Date.now()
  while (!fn()) {
    if (Date.now() - t0 > timeout) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 5))
  }
}

const UID = 'me'

/** A host on an in-memory link; `games` set means the link can upload (multiplayer). */
async function open(storage: KeyValueStore, fresh: boolean, games?: GameDoc[]) {
  const links = localLinks(UID, storage, fresh ? newRoomDoc(SOLO_CODE, UID, 'Me') : undefined)!
  const link: HostLink = games
    ? {
        ...links.host,
        saveGame: async (g) => {
          games.push(g)
        },
      }
    : links.host
  const session = new RoomSession(SOLO_CODE, UID, links.guest, link)
  const host = await HostGame.attach(SOLO_CODE, UID, link, {
    storage,
    botDelay: () => 0,
    drawLingerMs: 0,
    bidLingerMs: 0,
  })
  host.onError = (e) => {
    throw e
  }
  let latest: SessionView | null = null
  const unsub = session.view.subscribe((v) => {
    latest = v
    const pub = v.room?.pub
    if (!pub || !v.state || pub.phase === 'LOBBY' || pub.phase === 'GAME_OVER') return
    if (pub.actionSeats.includes(v.mySeat)) host.submit({ kind: 'act', action: botAction(v.state, v.mySeat) })
  })
  const close = () => {
    unsub()
    host.dispose()
    session.dispose()
  }
  return { host, view: () => latest, close }
}

describe('host game records', () => {
  test('a match survives a host reload and is uploaded exactly once', async () => {
    const storage = memoryStore()
    const games: GameDoc[] = []
    const first = await open(storage, true, games)
    first.host.addBot(1, 'easy')
    first.host.addBot(2)
    first.host.addBot(3, 'hard')
    first.host.startGame()
    await until(() => (first.view()?.room?.pub?.handNumber ?? 0) >= 2)
    first.close()
    expect(storage.getItem(`koejon-kjn-${SOLO_CODE}`)).not.toBeNull()

    const second = await open(storage, false, games)
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
    second.close()
  }, 60_000)

  test('a solo match keeps no record', async () => {
    const storage = memoryStore()
    const g = await open(storage, true)
    g.host.addBot(1)
    g.host.addBot(2)
    g.host.addBot(3)
    g.host.startGame()
    await until(() => g.view()?.room?.pub?.phase === 'GAME_OVER')
    expect(storage.getItem(`koejon-kjn-${SOLO_CODE}`)).toBeNull()
    g.close()
  }, 60_000)
})
