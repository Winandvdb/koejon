import { apply, isBidding, pendingSeats, rngNext, sameCard, teamOf } from '../engine'
import type { Action, State } from '../engine'
import { createBot } from './bot'
import type { Bot } from './bot'
import { troefkeWeight } from './conventions'
import { sampleWorld } from './determinize'
import { decisionPhase, observe } from './observation'
import type { DecisionPhase, Observation } from './observation'
import { solve } from './solver'
import { breakEven, handValue } from './value'

export const RATING_CLASSES = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'] as const
export type RatingClass = (typeof RATING_CLASSES)[number]

/** Worlds per rated card: the double-dummy values of every legal card, averaged as `pimc` does. */
export const CARD_SAMPLES = 20
/**
 * Hands played out per bid choice. On close bids the gap between two choices
 * still moves by about 0.19 lines from seed to seed (0.24 at 100, 0.14 at
 * 300); more costs too much time on a phone (#105).
 */
export const BID_ROLLOUTS = 150
/** Plays every seat in a bid rollout: it does not see the hidden cards, unlike the solver. */
const ROLLOUT_BOT = 'heuristic:hard'

/**
 * Highest loss in lines of each class but `blunder`, per kind of decision.
 * A card value moves in steps of 1/20 line (one world of 20), so `best`
 * allows one step; a whole line lost is a blunder. In 6 sampled matches of
 * `heuristic:normal` bots this gives, from best to blunder, 70/8/12/7/4% of
 * 1118 cards. Bids are noisier (see `BID_ROLLOUTS`) but lose less: with
 * their own limits 90/4/4/2/1% of 391 bids.
 */
export const LOSS_LIMITS: Record<DecisionPhase, [best: number, good: number, inaccuracy: number, mistake: number]> = {
  play: [0.05, 0.15, 0.4, 1],
  bidding: [0.1, 0.25, 0.5, 1],
}

export function ratingClass(loss: number, kind: DecisionPhase): RatingClass {
  const i = LOSS_LIMITS[kind].findIndex((limit) => loss <= limit)
  return RATING_CLASSES[i < 0 ? 4 : i]
}

export interface RatedAction {
  action: Action
  /** Expected change in lines for the seat's team: lines it crossed minus lines the other team crossed. */
  value: number
  /** Bids only: share of the rollouts where the seat's team gained lines. */
  win?: number
}

export interface Rating {
  seat: number
  kind: DecisionPhase
  played: Action
  /** Every legal action, best first. */
  values: RatedAction[]
  /** Best value minus the played value, in lines; never below 0. */
  loss: number
  rating: RatingClass
  /**
   * Go / pass and the dealer's choice only, not the troefke (the contract
   * already stands): the stake in lines of the bid, kapot not counted.
   */
  stake?: number
  /** With `stake`: the win chance a bid at `stake` needs (`breakEven`). */
  breakEven?: number
}

export const sameAction = (a: Action, b: Action): boolean =>
  a.type === b.type &&
  a.seat === b.seat &&
  (a.type !== 'play' || (b.type === 'play' && sameCard(a.card, b.card))) &&
  (a.type !== 'bid' || (b.type === 'bid' && a.play === b.play)) &&
  (a.type !== 'choose' || (b.type === 'choose' && a.suit === b.suit))

const seeded = (seed: number): (() => number) => {
  const holder = { rng: seed | 0 }
  return () => rngNext(holder)
}

/** Card values: as `pimc`, but every legal card, also one the troefke convention forbids. */
function cardValues(obs: Observation, rand: () => number, samples: number): RatedAction[] {
  const weight = troefkeWeight(obs)
  const sum = obs.legal.map(() => 0)
  for (let n = 0; n < samples; n++) {
    solve(sampleWorld(obs, rand, weight), obs.seat, obs.legal).forEach((v, i) => (sum[i] += v.value))
  }
  return obs.legal.map((action, i) => ({ action, value: sum[i] / samples }))
}

const handOpen = (s: State): boolean => isBidding(s.phase) || s.phase === 'PLAYING'

/** The hand after `first`, played to its end by `bot` on every seat. */
function rollout(world: State, first: Action, bot: Bot, rand: () => number): State {
  let s = apply(world, first)
  while (handOpen(s)) {
    const seat = pendingSeats(s)[0]
    s = apply(s, bot.decide(s, seat, rand))
  }
  return s
}

/**
 * Bid values by rollouts: each choice is played out in the same `rollouts`
 * worlds with the same random numbers, so the difference between choices
 * is the choice and not the sampling noise. All seats play like `ROLLOUT_BOT`,
 * also the other bidders after a pass. All passed counts as 0.
 */
function bidValues(obs: Observation, rand: () => number, rollouts: number): RatedAction[] {
  const bot = createBot(ROLLOUT_BOT)
  const team = teamOf(obs.seat)
  const sum = obs.legal.map(() => 0)
  const wins = obs.legal.map(() => 0)
  for (let n = 0; n < rollouts; n++) {
    const world = sampleWorld(obs, rand)
    const seed = Math.floor(rand() * 0x100000000)
    obs.legal.forEach((a, i) => {
      const value = handValue(world, rollout(world, a, bot, seeded(seed)), team)
      sum[i] += value
      if (value > 0) wins[i]++
    })
  }
  return obs.legal.map((action, i) => ({ action, value: sum[i] / rollouts, win: wins[i] / rollouts }))
}


export interface RateOptions {
  /** The action the seat took. */
  played: Action
  /** Seeds every random choice: the same seed gives the same rating. */
  seed: number
  /** Worlds per card or rollouts per bid choice; default `CARD_SAMPLES` / `BID_ROLLOUTS`. */
  samples?: number
}

/**
 * How good `played` was among the legal actions of `seat` in `state`. Only
 * the seat's observation counts: a move is rated on what the player could
 * know, never on the hidden hands. Null for a step without a real choice
 * (one legal action, or a lift or the first dealer).
 *
 * Cards get the `pimc` value: the double-dummy value averaged over sampled
 * worlds. Bids (go / pass, troefke, the dealer's choice) are rated by
 * rollouts with an imperfect-information bot: double-dummy bid values see
 * all cards and make every bid look better than it is (#86).
 */
export function rateDecision(state: State, seat: number, options: RateOptions): Rating | null {
  const obs = observe(state, seat)
  if (obs.legal.length < 2 || ['draw', 'cut', 'chooseDealer'].includes(obs.legal[0].type)) return null
  const { played, seed } = options
  if (!obs.legal.some((a) => sameAction(a, played))) throw new Error(`rateDecision: ${played.type} is not legal for seat ${seat}`)
  const rand = seeded(seed)
  const kind = decisionPhase(obs)
  const values =
    kind === 'play'
      ? cardValues(obs, rand, options.samples ?? CARD_SAMPLES)
      : bidValues(obs, rand, options.samples ?? BID_ROLLOUTS)
  // A stable order: ties keep the legal order.
  values.sort((a, b) => b.value - a.value)
  const mine = values.find((v) => sameAction(v.action, played))!
  const loss = Math.max(0, values[0].value - mine.value)
  const rating: Rating = { seat, kind, played, values, loss, rating: ratingClass(loss, kind) }
  if (isBidding(obs.phase)) {
    rating.stake = obs.phase === 'BIDDING_R1' ? obs.multiplier : 2
    rating.breakEven = breakEven(rating.stake)
  }
  return rating
}

/** Per seat and kind of decision, the number of ratings in each class. */
export type RatingSummary = Record<DecisionPhase, Record<RatingClass, number>>[]

export function summarize(ratings: Iterable<Rating>): RatingSummary {
  const empty = () => Object.fromEntries(RATING_CLASSES.map((c) => [c, 0])) as Record<RatingClass, number>
  const out = [0, 1, 2, 3].map(() => ({ bidding: empty(), play: empty() }))
  for (const r of ratings) out[r.seat][r.kind][r.rating]++
  return out
}
