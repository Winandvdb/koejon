import { describe, expect, it } from 'vitest'
import type { Action } from '../src/engine'
import { createAlgorithm } from '../src/bots/algorithm'
import { observe } from '../src/bots/observation'
import type { Observation } from '../src/bots/observation'
import { seededRandom } from '../src/lib/seed'
import { decisions } from './helpers'

const sameAction = (a: Action, b: Action): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Bid, troefke and dealer's choice decisions of seeded heuristic matches. */
function biddingObs(level: 'easy' | 'normal' | 'hard', seeds: number[]): Observation[] {
  const out: Observation[] = []
  for (const seed of seeds) {
    for (const { s, seat } of decisions(seed, level)) {
      const obs = observe(s, seat)
      if (['bid', 'ack', 'choose'].includes(obs.legal[0].type)) out.push(obs)
    }
  }
  return out
}

describe('heuristic policy', () => {
  for (const level of ['easy', 'hard'] as const) {
    it(`${level}: gives each legal action a chance, summing to 1, as often as decide takes it`, () => {
      const h = createAlgorithm(`heuristic:${level}`)
      const all = biddingObs(level, [1, 2, 3, 4, 5, 6])
      let mixed = 0
      for (const obs of all) {
        const policy = h.policy!(obs)
        expect(policy.map((x) => x.action)).toEqual(obs.legal)
        expect(policy.reduce((sum, x) => sum + x.p, 0)).toBeCloseTo(1, 12)
        for (const x of policy) expect(x.p).toBeGreaterThanOrEqual(0)
        const random = policy.some((x) => x.p > 0 && x.p < 1)
        if (!random) {
          // A sure action: decide takes it whatever the random numbers.
          const sure = policy.find((x) => x.p === 1)!.action
          for (const seed of [1, 2, 3]) expect(sameAction(h.decide(obs, seededRandom(seed)), sure)).toBe(true)
          continue
        }
        mixed++
        const N = 4000
        const counts = policy.map(() => 0)
        const rand = seededRandom(mixed * 31 + 7)
        for (let i = 0; i < N; i++) {
          const a = h.decide(obs, rand)
          counts[policy.findIndex((x) => sameAction(x.action, a))]++
        }
        // 4 standard deviations of a share of 4000 draws is at most 0.032.
        policy.forEach((x, i) => expect(Math.abs(counts[i] / N - x.p)).toBeLessThan(0.035))
      }
      expect(mixed).toBeGreaterThanOrEqual(5)
    }, 60_000)
  }
})
