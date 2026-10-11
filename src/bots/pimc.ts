import { RANK_ORDER, RANK_POINTS } from '../engine'
import type { Action } from '../engine'
import type { Algorithm, BotTrace } from './algorithm'
import { sampleWorld } from './determinize'
import { decisionPhase } from './observation'
import type { Observation } from './observation'
import { solve } from './solver'

/** Worlds per decision when the spec names no `samples`. */
export const PIMC_SAMPLES = 20

/** Between equal values: the cheaper card (fewer points, then lower). */
function cost(a: Action): number {
  return a.type === 'play' ? RANK_POINTS[a.card.r] * 10 + RANK_ORDER[a.card.r] : 0
}

/**
 * Perfect Information Monte Carlo, as GIB plays bridge: deal the cards the seat
 * cannot see at random (`sampleWorld`), solve each world exactly with
 * the double-dummy `solve`, and play the card with the best average value.
 * Its known weak points (strategy fusion: it assumes it will know the cards
 * later; non-locality) are accepted.
 *
 * Card play only: `supports` is false for bids, troefke and the dealer's
 * choice. `solve` can value bids, but each world shows all hands, so PIMC
 * bid far too often (25% on the 1st card against 7% for heuristic:hard, a
 * quarter of its bids with one trump or none) and won only 38% of its
 * matches against the same card play with heuristic:hard bids (#86).
 *
 * Options: `samples`, the worlds per decision.
 */
export function createPimc(variant: string | undefined, options: Record<string, unknown>): Algorithm {
  if (variant !== undefined) throw new Error(`unknown pimc variant: ${variant}`)
  for (const [k, v] of Object.entries(options)) {
    if (k !== 'samples') throw new Error(`unknown pimc option: ${k}`)
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new Error(`pimc option ${k} must be a positive integer`)
  }
  const samples = (options.samples as number | undefined) ?? PIMC_SAMPLES
  return {
    id: 'pimc',
    supports: (obs) => decisionPhase(obs) === 'play',
    decide(obs: Observation, rand: () => number, trace?: BotTrace): Action {
      const { legal } = obs
      const sum = legal.map(() => 0)
      const min = legal.map(() => Infinity)
      const max = legal.map(() => -Infinity)
      for (let n = 0; n < samples; n++) {
        const values = solve(sampleWorld(obs, rand), obs.seat, legal)
        values.forEach(({ value }, i) => {
          sum[i] += value
          min[i] = Math.min(min[i], value)
          max[i] = Math.max(max[i], value)
        })
      }
      let best = 0
      for (let i = 1; i < legal.length; i++) {
        if (sum[i] > sum[best] || (sum[i] === sum[best] && cost(legal[i]) < cost(legal[best]))) best = i
      }
      if (trace) {
        legal.forEach((action, i) =>
          trace.candidates.push({
            action,
            score: sum[i] / samples,
            visits: samples,
            note: `min ${min[i]} max ${max[i]}`,
          }),
        )
        trace.notes.push(`pimc: ${samples} worlds, best average ${(sum[best] / samples).toFixed(2)}`)
      }
      return legal[best]
    },
  }
}
