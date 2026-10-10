import { afterEach, describe, expect, test, vi } from 'vitest'
import { matchScore } from '../src/engine'
import { addHistory, HISTORY_KEY, HISTORY_MAX, readHistory } from '../src/lib/history'
import { parseKjn, replaySteps, type KjnHand, type KjnMatch } from '../src/lib/kjn'
import type { KeyValueStore } from '../src/lib/link-local'
import { EMPTY_STATS, matchStats, STATS_KEY, totalStats } from '../src/lib/stats'
import { finishedMatch, memoryStore } from './helpers'

afterEach(() => vi.unstubAllGlobals())

/** Only the fields the statistics read: contract and result. */
function hand(bidder: number | null, crossed: [number, number], koei = false): KjnHand {
  const playing = bidder === null ? 0 : bidder % 2
  return {
    contract: bidder === null ? null : { bidder, trump: 'H', level: 1 },
    result: bidder === null ? null : { playing, points: [0, 0], crossed, kapot: false, koei },
  } as KjnHand
}

const match = (hands: KjnHand[], winner: number | null = 1, lines: [number, number] = [4, 0]): KjnMatch => ({
  format: 'KJN/1',
  app: 'test',
  seats: ['human', 'human', 'human', 'human'],
  hands,
  winner,
  lines: winner === null ? null : lines,
})

describe('match score', () => {
  test('the winner gets 13', () => {
    expect(matchScore({ lines: [0, 5], winner: 0 }, 0)).toBe(13)
  })

  test('the loser gets 13 minus the lines left', () => {
    expect(matchScore({ lines: [0, 5], winner: 0 }, 1)).toBe(8)
  })

  test('more than 13 lines left (Koeien) gives 0, not less', () => {
    expect(matchScore({ lines: [16, 0], winner: 1 }, 0)).toBe(0)
  })
})

describe('statistics of one match', () => {
  test('crosses count for the team, bids for the seat', () => {
    const m = match([
      hand(null, [0, 0]), // everybody passed
      hand(1, [0, 2]), // own bid, double
      hand(3, [0, 3]), // partner's bid, triple
      hand(1, [0, 0]), // own bid, 20-20 draw
      hand(0, [2, 0]), // opponents' double
      hand(0, [0, 1], true), // opponents lose: a Koei for them
    ])
    expect(matchStats(m, 1)).toEqual({ played: 1, won: 1, score: 13, doubles: 1, triples: 1, bidsMade: 2, bidsWon: 1 })
    expect(matchStats(m, 3)).toMatchObject({ doubles: 1, triples: 1, bidsMade: 1, bidsWon: 1 })
    expect(matchStats(m, 0)).toEqual({ played: 1, won: 0, score: 9, doubles: 1, triples: 0, bidsMade: 2, bidsWon: 1 })
  })

  test('a last hand counts the lines really crossed, not its stake', () => {
    // 4 doubles + 1 triple leave 2 lines: the last triple stake crosses 2.
    const m = match([hand(1, [0, 2]), hand(1, [0, 2]), hand(1, [0, 2]), hand(1, [0, 2]), hand(1, [0, 3]), hand(1, [0, 3])])
    expect(matchStats(m, 1)).toMatchObject({ doubles: 5, triples: 1, bidsMade: 6, bidsWon: 6 })
  })

  test('a Koei adds a line to cross', () => {
    // 6 doubles leave 1 line, the Koei makes it 2: the last double counts in full.
    const doubles = Array.from({ length: 6 }, () => hand(1, [0, 2]))
    const m = match([...doubles, hand(1, [1, 0], true), hand(1, [0, 2])])
    expect(matchStats(m, 1).doubles).toBe(7)
    expect(matchStats(match([...doubles, hand(1, [0, 2])]), 1).doubles).toBe(6)
  })

  test('an unfinished match counts nothing', () => {
    expect(matchStats(match([hand(1, [0, 2])], null), 1)).toEqual(EMPTY_STATS)
  })

  test('a played match: result and score from the record', () => {
    const { final, kjn } = finishedMatch(5)
    const s = matchStats(parseKjn(kjn), 0)
    expect(s.played).toBe(1)
    expect(s.won).toBe(final.winner === 0 ? 1 : 0)
    expect(s.score).toBe(matchScore({ lines: final.lines, winner: final.winner! }, 0))
    expect(s.bidsWon).toBeLessThanOrEqual(s.bidsMade)
  })

  test('crosses agree with the lines the engine crosses', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const m = parseKjn(finishedMatch(seed).kjn)
      const count = [new Map<number, number>(), new Map<number, number>()]
      let prev: [number, number] | null = null
      for (const s of replaySteps(m)) {
        if (prev && s.lastResult && (s.phase === 'SCORED' || s.phase === 'GAME_OVER') && s.tricksPlayed === 6)
          for (const t of [0, 1]) {
            const n = prev[t] - s.lines[t]
            count[t].set(n, (count[t].get(n) ?? 0) + 1)
          }
        prev = s.phase === 'PLAYING' ? [s.lines[0], s.lines[1]] : null
      }
      for (const seat of [0, 1])
        expect(matchStats(m, seat)).toMatchObject({ doubles: count[seat].get(2) ?? 0, triples: count[seat].get(3) ?? 0 })
    }
  })
})

describe('statistics on this device', () => {
  const sum = (texts: string[], seat: number) =>
    texts.map((k) => matchStats(parseKjn(k), seat)).reduce((a, b) => {
      const out = { ...a }
      for (const key of Object.keys(out) as (keyof typeof out)[]) out[key] += b[key]
      return out
    })

  test('matches already in the history count at once', () => {
    const store = memoryStore()
    const texts = [finishedMatch(1).kjn, finishedMatch(2).kjn]
    store.setItem(HISTORY_KEY, JSON.stringify(texts.map((kjn, i) => ({ id: String(i), finishedAt: i, seat: 2, names: [], kjn }))))
    expect(store.getItem(STATS_KEY)).toBeNull()
    expect(totalStats(readHistory(store), store)).toEqual(sum(texts, 2))
  })

  test('a match counts once, also when it is kept again', () => {
    const store = memoryStore()
    const { kjn } = finishedMatch(3)
    addHistory({ seat: 0, names: [], kjn }, store)
    addHistory({ seat: 0, names: [], kjn }, store)
    expect(totalStats(readHistory(store), store).played).toBe(1)
  })

  test('matches that drop out of the history still count', () => {
    const store = memoryStore()
    const texts = Array.from({ length: HISTORY_MAX + 2 }, (_, i) => finishedMatch(200 + i).kjn)
    texts.forEach((kjn) => addHistory({ seat: 1, names: [], kjn }, store))
    expect(readHistory(store)).toHaveLength(HISTORY_MAX)
    expect(totalStats(readHistory(store), store)).toEqual(sum(texts, 1))
  })

  test('a record that does not parse counts nothing', () => {
    const store = memoryStore()
    expect(totalStats([{ seat: 0, kjn: 'junk' }], store)).toEqual(EMPTY_STATS)
  })

  test('blocked storage reads as no statistics', () => {
    const thrower = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
    const broken: KeyValueStore = { getItem: thrower, setItem: thrower, removeItem: thrower }
    expect(totalStats(readHistory(broken), broken)).toEqual(EMPTY_STATS)
  })

  test('keeping matches asks the browser once to keep the data', () => {
    const persist = vi.fn(async () => true)
    vi.stubGlobal('navigator', { storage: { persist } })
    const store = memoryStore()
    addHistory({ seat: 0, names: [], kjn: finishedMatch(4).kjn }, store)
    addHistory({ seat: 0, names: [], kjn: finishedMatch(6).kjn }, store)
    expect(persist).toHaveBeenCalledOnce()
  })
})
