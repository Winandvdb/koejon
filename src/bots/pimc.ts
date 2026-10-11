import { partnerOf, RANK_ORDER, RANK_POINTS, rngNext, sameCard } from '../engine'
import type { Action, Suit } from '../engine'
import type { Algorithm, BotTrace } from './algorithm'
import { troefkeHand, troefkeLead, troefkeWeight } from './conventions'
import { sampleWorld } from './determinize'
import { decisionPhase, observe } from './observation'
import type { Observation } from './observation'
import { solve } from './solver'

/** Worlds per decision when the spec names no `samples`. */
export const PIMC_SAMPLES = 20
/** Worlds the modelled partner samples for its first lead, per world of a troefke decision. */
export const PIMC_PARTNER_SAMPLES = 5

/**
 * Between equal values: the cheaper card — a side card before a trump, then
 * fewer points, then lower — and no troefke over a troefke.
 */
function cost(a: Action, trump: Suit | null): number {
  if (a.type === 'troefke') return 1
  if (a.type !== 'play') return 0
  return (a.card.s === trump ? 100 : 0) + RANK_POINTS[a.card.r] * 10 + RANK_ORDER[a.card.r]
}

// Moved to the shared conventions; still exported here for older imports.
export { troefkeWeight } from './conventions'

/**
 * Score `candidates` over `samples` worlds with `valueOf` and pick the best
 * average; the trace lists them best first, so its first one is the choice.
 */
function best(
  obs: Observation,
  candidates: Action[],
  samples: number,
  valueOf: () => number[],
  trace?: BotTrace,
): Action {
  const sum = candidates.map(() => 0)
  const min = candidates.map(() => Infinity)
  const max = candidates.map(() => -Infinity)
  for (let n = 0; n < samples; n++) {
    valueOf().forEach((value, i) => {
      sum[i] += value
      min[i] = Math.min(min[i], value)
      max[i] = Math.max(max[i], value)
    })
  }
  const order = candidates
    .map((_, i) => i)
    .sort((i, j) => sum[j] - sum[i] || cost(candidates[i], obs.trump) - cost(candidates[j], obs.trump) || i - j)
  if (trace) {
    for (const i of order) {
      trace.candidates.push({
        action: candidates[i],
        score: sum[i] / samples,
        visits: samples,
        note: `min ${min[i]} max ${max[i]}`,
      })
    }
    trace.notes.push(`pimc: ${samples} worlds, best average ${(sum[order[0]] / samples).toFixed(2)}`)
  }
  return candidates[order[0]]
}

/** The card with the best average over `samples` worlds that fit what the seat saw. */
function playCard(obs: Observation, rand: () => number, samples: number, trace?: BotTrace): Action {
  let candidates = obs.legal
  if (troefkeLead(obs)) {
    candidates = candidates.filter((a) => a.type === 'play' && a.card.s === obs.trump)
    trace?.notes.push('troefke asked: lead a trump')
    if (candidates.length === 1) {
      trace?.candidates.push({ action: candidates[0], note: 'the only trump' })
      return candidates[0]
    }
  }
  const weight = troefkeWeight(obs)
  return best(obs, candidates, samples, () => solve(sampleWorld(obs, rand, weight), obs.seat, candidates).map((v) => v.value), trace)
}

/**
 * Troefke or not, for the bidder while its partner still has to lead. In a
 * world with all cards open the partner already leads the best card, so a
 * troefke could never win anything there. Here the partner does not see the
 * bidder's hand: per world, its lead comes from its own small PIMC — with
 * the troefke it obeys and samples troefke hands for the bidder (as
 * `playCard` does), without it it guesses — and the solver plays the rest.
 *
 * It asks only with a troefke hand, so the other seats read it right.
 */
function askTroefke(obs: Observation, rand: () => number, samples: number, partnerSamples: number, trace?: BotTrace): Action {
  const candidates = obs.legal.filter((a) => a.type === 'ack' || a.type === 'troefke')
  const ack = candidates.find((a) => a.type === 'ack')!
  if (!troefkeHand(obs.hand, obs.trump!)) {
    trace?.candidates.push({ action: ack, note: 'no troefke hand' })
    trace?.notes.push('no troefke: no troefke hand')
    return ack
  }
  const partner = partnerOf(obs.seat)
  return best(
    obs,
    candidates,
    samples,
    () => {
      const world = sampleWorld(obs, rand)
      // Both choices get the same random numbers for the partner: the
      // difference between them is the troefke, not sampling noise.
      const seed = Math.floor(rand() * 0x100000000) | 0
      const leads = candidates.map((a) => {
        const holder = { rng: seed }
        // The partner's view of the same deal, ready to lead.
        const view = observe({ ...world, trickAcks: [0, 1, 2, 3], troefkeAsked: a.type === 'troefke' }, partner)
        return playCard(view, () => rngNext(holder), partnerSamples)
      })
      // One search for both leads, so they share its cache.
      const unique = leads.filter((l, i) => leads.findIndex((m) => samePlay(l, m)) === i)
      const values = solve(world, obs.seat, unique)
      return leads.map((l) => values.find((v) => samePlay(v.action, l))!.value)
    },
    trace,
  )
}

const samePlay = (a: Action, b: Action): boolean =>
  a.type === 'play' && b.type === 'play' && sameCard(a.card, b.card)

/**
 * Perfect Information Monte Carlo, as GIB plays bridge: deal the cards the seat
 * cannot see at random (`sampleWorld`), solve each world exactly with
 * the double-dummy `solve`, and play the card with the best average value.
 * Its known weak points (strategy fusion: it assumes it will know the cards
 * later; non-locality) are accepted.
 *
 * The troefke: the bidder decides it with a partner that cannot see its hand
 * (`askTroefke`); the partner obeys it and every seat but the bidder reads it
 * as a troefke hand from then on (`troefkeWeight`). The troefke counts as
 * bidding in `decisionPhase`, but `supports` takes it: a bot rule with
 * `when: { phase: 'play' }` leaves it to the next rule.
 *
 * No bids or dealer's choice: `supports` is false for them. `solve` can value
 * bids, but each world shows all hands, so PIMC bid far too often (25% on
 * the 1st card against 7% for heuristic:hard, a quarter of its bids with one
 * trump or none) and won only 38% of its matches against the same card play
 * with heuristic:hard bids (#86).
 *
 * Options: `samples`, the worlds per decision; `partnerSamples`, the worlds
 * the partner samples for its lead in a troefke decision.
 */
export function createPimc(variant: string | undefined, options: Record<string, unknown>): Algorithm {
  if (variant !== undefined) throw new Error(`unknown pimc variant: ${variant}`)
  for (const [k, v] of Object.entries(options)) {
    if (k !== 'samples' && k !== 'partnerSamples') throw new Error(`unknown pimc option: ${k}`)
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new Error(`pimc option ${k} must be a positive integer`)
  }
  const samples = (options.samples as number | undefined) ?? PIMC_SAMPLES
  const partnerSamples = (options.partnerSamples as number | undefined) ?? PIMC_PARTNER_SAMPLES
  return {
    id: 'pimc',
    supports: (obs) => decisionPhase(obs) === 'play' || obs.legal.some((a) => a.type === 'troefke'),
    decide(obs: Observation, rand: () => number, trace?: BotTrace): Action {
      if (obs.legal.some((a) => a.type === 'troefke')) return askTroefke(obs, rand, samples, partnerSamples, trace)
      return playCard(obs, rand, samples, trace)
    },
  }
}
