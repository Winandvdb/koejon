import { describe, expect, it } from 'vitest'
import { HEURISTIC_DEFAULTS } from '../src/bots/heuristic'
import { PARAMS, fixedKeys, spsa, toOptions, toPoint } from '../scripts/tune-spsa.mjs'

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

  it('keeps the values set by hand unless --free names them', async () => {
    expect(fixedKeys([])).toEqual(['dealerKing', 'dealerWeak'])
    expect(fixedKeys(['bidThreshold1'])).toEqual(['bidThreshold1', 'dealerKing', 'dealerWeak'])
    expect(fixedKeys([], ['dealerWeak'])).toEqual(['dealerKing'])
    expect(() => fixedKeys([], ['nope'])).toThrow(/--free/)
    expect(() => fixedKeys([], ['bidThreshold1'])).toThrow(/not set by hand/)
    expect(() => fixedKeys(['dealerWeak'], ['dealerWeak'])).toThrow(/both/)
    // The score pulls both up, as a tuning run would on noise.
    const { best } = await run(1, (o) => o.dealerKing + o.dealerWeak + 0.02 * o.dealerAce, 50, fixedKeys([]))
    expect(best.dealerKing).toBe(defaults.dealerKing)
    expect(best.dealerWeak).toBe(defaults.dealerWeak)
    expect(best.dealerAce).toBeGreaterThan(defaults.dealerAce)
  })
})
