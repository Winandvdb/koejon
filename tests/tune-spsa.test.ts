import { describe, expect, it } from 'vitest'
import type { BotTrace } from '../src/bots/algorithm'
import { createBot, HARD_PIMC, LEVEL_CONFIGS } from '../src/bots/bot'
import type { BotConfig } from '../src/bots/bot'
import { HEURISTIC_DEFAULTS } from '../src/bots/heuristic'
import { legalActions, pendingSeats } from '../src/engine'
import { seededRandom } from '../src/lib/seed'
import { CARD_PLAY_KEYS, PARAMS, spsa, toOptions, toPoint, tuneBot } from '../scripts/tune-spsa.mjs'
import { C, dealtState, decisions, playingState } from './helpers'

const defaults = { ...HEURISTIC_DEFAULTS } as Record<string, number>

/** One SPSA run on a made-up score; returns the result and every seed list. */
async function run(seed: number, score: (o: Record<string, number>) => number, generations = 5, fixed?: string[]) {
  const seeds: number[][] = []
  const best = await spsa({
    start: defaults,
    generations,
    seed,
    seedsPerGen: 4,
    fixed,
    evaluate: async (plus, minus, s) => {
      seeds.push(s)
      return [score(plus), score(minus)]
    },
  })
  return { best, seeds }
}

describe('tune-spsa', () => {
  it('has a search range for exactly the heuristic constants', () => {
    expect(PARAMS.map((p) => p.key).sort()).toEqual(Object.keys(HEURISTIC_DEFAULTS).sort())
  })

  it('keeps the defaults: inside the bounds and on the step', () => {
    expect(toOptions(toPoint(defaults))).toEqual(defaults)
  })

  it('rounds to the step and clamps to the bounds', () => {
    const o = toOptions(PARAMS.map((_, i) => (i % 2 ? 1.7 : 0.333)))
    for (const [i, p] of PARAMS.entries()) {
      const v = o[p.key]
      if (i % 2) expect(v).toBe(p.hi)
      expect(v).toBeGreaterThanOrEqual(p.lo)
      expect(v).toBeLessThanOrEqual(p.hi)
      expect(Math.abs(v / p.step - Math.round(v / p.step))).toBeLessThan(1e-9)
    }
  })

  it('repeats for the same seed and differs for another', async () => {
    const score = (o: Record<string, number>) => 0.5 - 0.01 * o.bidThreshold1 + 0.02 * o.dealerAce
    const a = await run(1, score)
    const b = await run(1, score)
    const c = await run(2, score)
    expect(b).toEqual(a)
    expect(c.seeds).not.toEqual(a.seeds)
  })

  it('draws new seeds per generation, far above the bench seeds', async () => {
    const { seeds } = await run(1, () => 0.5)
    expect(new Set(seeds.flat()).size).toBe(seeds.flat().length)
    for (const s of seeds.flat()) expect(s).toBeGreaterThanOrEqual(1_000_000)
  })

  it('climbs a score with one best point', async () => {
    // Highest score at the middle of every range.
    const mid = toOptions(PARAMS.map(() => 0.5))
    const dist = (o: Record<string, number>) =>
      PARAMS.reduce((d, p) => d + ((o[p.key] - mid[p.key]) / (p.hi - p.lo)) ** 2, 0)
    const { best } = await run(3, (o) => 0.5 - 0.1 * dist(o), 200)
    expect(dist(best)).toBeLessThan(dist(defaults) / 4)
  })

  it('never moves a fixed constant', async () => {
    // The score pulls bidThreshold1 up, but it is fixed.
    const { best } = await run(1, (o) => 0.01 * o.bidThreshold1 + 0.02 * o.dealerAce, 50, ['bidThreshold1'])
    expect(best.bidThreshold1).toBe(defaults.bidThreshold1)
    expect(best.dealerAce).toBeGreaterThan(defaults.dealerAce)
  })

  it('with pimc plays the hard level bot: pimc cards, the candidate bids', () => {
    // The untuned side is the level bot ('heuristic:hard' as an object spec).
    const level = LEVEL_CONFIGS.hard as BotConfig
    expect(level.rules[1].use).toBe('heuristic:hard')
    expect(tuneBot({}, HARD_PIMC)).toEqual({ ...level, rules: [level.rules[0], { use: { id: 'heuristic:hard' } }] })
    expect(tuneBot({ bidThreshold1: 6 }, null)).toEqual({ id: 'heuristic:hard', bidThreshold1: 6 })
    for (const k of CARD_PLAY_KEYS) expect(Object.keys(HEURISTIC_DEFAULTS)).toContain(k)

    // A candidate that bids on anything: its options reach the bids, pimc plays the card.
    const bot = createBot(tuneBot({ bidThreshold1: 6, clearBid: 0, betterSuit: 0, loneTrumpMin: 8 }, HARD_PIMC))
    const hands = [
      [C('C', 'J'), C('C', 'Q'), C('D', 'J'), C('D', 'Q'), C('S', 'J'), C('S', 'Q')],
      [C('H', '9'), C('H', 'J'), C('H', 'K'), C('S', '9'), C('C', '9'), C('D', '9')],
      [C('C', 'K'), C('C', 'A'), C('D', 'K'), C('D', 'A'), C('S', 'K'), C('S', 'A')],
      [C('H', '10'), C('H', 'Q'), C('H', 'A'), C('S', '10'), C('C', '10'), C('D', '10')],
    ]
    const trace = (): BotTrace => ({ candidates: [], notes: [] })
    const card = trace()
    expect(bot.decide(playingState({ bidder: 1, turn: 3, leader: 3, hands }), 3, seededRandom(1), card).type).toBe('play')
    expect(card.algorithm).toBe('pimc')
    // The options reach the bids: on some deal the candidate bids where the untuned side passes.
    const base = createBot(LEVEL_CONFIGS.hard)
    let differs = 0
    for (let seed = 1; seed <= 20; seed++) {
      const s = dealtState(seed)
      const seat = pendingSeats(s)[0]
      const bid = trace()
      const a = bot.decide(s, seat, seededRandom(1), bid)
      expect(bid.algorithm).toBe('heuristic:hard')
      if (a.type === 'bid' && a.play && !(base.decide(s, seat, seededRandom(1)) as { play: boolean }).play) differs++
    }
    expect(differs).toBeGreaterThan(0)
  })

  it('fixes with pimc only constants that bids and the dealer\'s choice never read', () => {
    // Every CARD_PLAY_KEYS value at the other end of its range.
    const far = Object.fromEntries(
      PARAMS.filter((p) => CARD_PLAY_KEYS.includes(p.key)).map((p) => [
        p.key,
        defaults[p.key] - p.lo < p.hi - defaults[p.key] ? p.hi : p.lo,
      ]),
    )
    const base = createBot('heuristic:hard')
    const moved = createBot({ id: 'heuristic:hard', ...far })
    const hits = { bid: 0, choose: 0 }
    for (let seed = 1; seed <= 5; seed++)
      for (const { s, seat } of decisions(seed, 'hard')) {
        const type = legalActions(s, seat)[0].type
        if (type !== 'bid' && type !== 'choose') continue
        hits[type]++
        expect(moved.decide(s, seat, seededRandom(seed))).toEqual(base.decide(s, seat, seededRandom(seed)))
      }
    expect(hits.bid).toBeGreaterThan(100)
    expect(hits.choose).toBeGreaterThan(5)
  })
})
