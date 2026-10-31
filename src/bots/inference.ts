import { clientState, leftOf, partnerOf } from '../engine'
import type { Action, Card, Phase, State } from '../engine'
import type { Algorithm, AlgorithmSpec, BotTrace } from './algorithm'
import { troefkeIgnoredWeight } from './conventions'
import { playedCards } from './determinize'
import { observe } from './observation'
import type { Observation } from './observation'

/**
 * The lowest weight of a world: one action the model did not expect makes a
 * world unlikely, not impossible (a human bids as it likes). Not 0, so a
 * deal that no hand explains does not spend every try of `sampleWorld`.
 */
export const WEIGHT_FLOOR = 0.05

/** One past decision of another seat this hand, as that seat saw it then. */
export interface PastDecision {
  seat: number
  /** The seat's observation then; its `hand` comes from each world. */
  obs: Observation
  action: Action
  /** Index of `action` in `obs.legal`, and so in the model's policy. */
  index: number
  /** Cards the seat played this hand since: its hand then is the world's plus these. */
  played: Card[]
}

// Six cards for the seats while a decision is rebuilt: only their count shows.
const SIX: Card[] = Array.from({ length: 6 }, () => ({ s: 'S', r: '9' }) as Card)

/**
 * The bids, troefke choices and dealer's choices of the other seats this
 * hand, each with the observation its seat had then. Rebuilt directly from
 * the public state and the log since the last `deal`, not by replaying it:
 * a hand changes nothing public before its first card but the bidding fields
 * set back here. A decision whose seat could not see its hand (the dealer
 * while bidding, so also the dealer's choice) is left out: it says nothing
 * about the hidden cards, the same chance in every world.
 *
 * The troefke counts as a decision once it is known: asked (the `troefke`
 * event), or not asked by a bidder that could ask it and already confirmed
 * (in the acks, or a card fell). The log keeps the last 60 events: all of
 * this hand's, but the rebuilt views miss older ones.
 */
export function pastDecisions(obs: Observation): PastDecision[] {
  let start = -1
  for (let i = obs.log.length - 1; i >= 0 && start < 0; i--) if (obs.log[i].t === 'deal') start = i
  if (start < 0 || !obs.turned) return []
  const played = playedCards(obs)
  const playedBy = (seat: number) => played.flatMap((tc) => (tc.seat === seat ? [tc.card] : []))
  const leader = leftOf(obs.dealer)
  const base = clientState(obs, -1, null)
  // While round 1 runs, the second card lies face down.
  let second: Card | null = null
  let phase: Phase = 'BIDDING_R1'
  let bidIndex = 0
  const out: PastDecision[] = []
  const add = (seat: number, action: Action, at: number, over: Partial<State> = {}) => {
    if (seat === obs.seat) return
    const s: State = {
      ...base,
      phase,
      hands: [SIX, SIX, SIX, SIX],
      turned: { first: obs.turned!.first, second: second ?? obs.turned!.first, secondUp: second !== null },
      trump: null,
      level: 0,
      bidder: null,
      bidIndex,
      turn: leader,
      leader,
      trick: [],
      lastTrick: null,
      prevTrick: null,
      trickAcks: [leader],
      troefkeAsked: false,
      tricksPlayed: 0,
      tricksWon: [0, 0],
      points: [0, 0],
      log: obs.log.slice(0, at),
      ...over,
    }
    const view = observe(s, seat)
    // A seat that could not see its hand decided the same in every world.
    if (view.hand.length === 0) return
    const index = view.legal.findIndex((a) => sameDecision(a, action))
    if (index < 0) throw new Error(`inference: ${action.type} of seat ${seat} is not legal in its rebuilt view`)
    out.push({ seat, obs: view, action, index, played: playedBy(seat) })
  }
  const playing = (): Partial<State> => ({
    phase: 'PLAYING',
    trump: obs.trump,
    level: obs.level,
    bidder: obs.bidder,
    turn: leader,
  })
  for (let i = start + 1; i < obs.log.length; i++) {
    const e = obs.log[i]
    if (e.t === 'pass') {
      add(e.seat!, { type: 'bid', seat: e.seat!, play: false }, i)
      bidIndex++
      if (bidIndex === 3 && phase === 'BIDDING_R2') {
        phase = 'DEALER_CHOICE'
        bidIndex = 0
      }
    } else if (e.t === 'second-card') {
      second = e.card!
      phase = second.s === obs.turned.first.s ? 'DEALER_CHOICE' : 'BIDDING_R2'
      bidIndex = 0
    } else if (e.t === 'play-call') {
      if (phase === 'DEALER_CHOICE') add(e.seat!, { type: 'choose', seat: e.seat!, suit: e.suit! }, i)
      else add(e.seat!, { type: 'bid', seat: e.seat!, play: true }, i)
      phase = 'PLAYING'
    } else if (e.t === 'dealer-pass') {
      add(e.seat!, { type: 'choose', seat: e.seat!, suit: null }, i)
    } else if (e.t === 'troefke') {
      add(e.seat!, { type: 'troefke', seat: e.seat! }, i, playing())
    }
  }
  const bidder = obs.bidder
  if (phase === 'PLAYING' && bidder !== null && !obs.troefkeAsked && bidder === partnerOf(leader)) {
    if (played.length > 0 || obs.trickAcks.includes(bidder)) {
      let at = obs.log.findIndex((e, i) => i > start && e.t === 'card')
      if (at < 0) at = obs.log.length
      add(bidder, { type: 'ack', seat: bidder }, at, playing())
    }
  }
  return out
}

const sameDecision = (a: Action, b: Action): boolean =>
  a.type === b.type &&
  (a.type !== 'bid' || (b.type === 'bid' && a.play === b.play)) &&
  (a.type !== 'choose' || (b.type === 'choose' && a.suit === b.suit))

/**
 * How well `model` explains the `history` in `world`: the product of its
 * chances of each past action, from that seat's observation then with the
 * hand it held in this world, never below `WEIGHT_FLOOR`.
 */
export function worldWeight(world: State, history: PastDecision[], model: Algorithm): number {
  let w = 1
  for (const d of history) {
    const obs = { ...d.obs, hand: [...world.hands[d.seat], ...d.played] }
    w *= model.policy!(obs)[d.index].p
  }
  return Math.max(WEIGHT_FLOOR, w)
}

/** Option `inference` of a search algorithm: the model whose policy weighs the worlds. */
export interface Inference {
  model: Algorithm
}

/**
 * Check option `inference` (`{ model: <algorithm spec> }`) of algorithm
 * `owner` and build its model with `create`: never by import. A model
 * without `policy` cannot weigh worlds and throws here.
 */
export function parseInference(
  owner: string,
  value: unknown,
  create: (spec: AlgorithmSpec) => Algorithm,
): Inference {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${owner} option inference must be an object { model }`)
  for (const k of Object.keys(value)) {
    if (k !== 'model') throw new Error(`unknown ${owner} inference option: ${k}`)
  }
  const spec = (value as { model?: unknown }).model
  if (typeof spec !== 'string' && (typeof spec !== 'object' || spec === null))
    throw new Error(`${owner} option inference needs a model: an algorithm spec`)
  const model = create(spec as AlgorithmSpec)
  if (!model.policy) throw new Error(`${owner} inference model ${model.id} has no policy`)
  return { model }
}

/**
 * The world weight of one decision with `inference`: the model's weight of
 * the past bids and troefke, times the ignored-troefke half of
 * `troefkeWeight` (the model reads no card play). It replaces the bidder's
 * half of `troefkeWeight`: the model reads the troefke itself, and
 * multiplying both (count it twice) benched no better (#90). `note` puts one line in
 * the trace with the effective sample size of the weights computed so far,
 * (Σw)² / Σw².
 */
export function inferenceWeight(
  obs: Observation,
  inference: Inference,
): { weight: (world: State) => number; note: (trace?: BotTrace) => void } {
  const history = pastDecisions(obs)
  const ignored = troefkeIgnoredWeight(obs)
  let n = 0
  let sum = 0
  let sum2 = 0
  const weight = (world: State) => {
    const w = worldWeight(world, history, inference.model) * (ignored ? ignored(world) : 1)
    n++
    sum += w
    sum2 += w * w
    return w
  }
  const note = (trace?: BotTrace) => {
    const ess = sum2 > 0 ? (sum * sum) / sum2 : 0
    trace?.notes.push(
      `inference ${inference.model.id}: ${history.length} decisions read, ESS ${ess.toFixed(1)} of ${n} worlds weighed`,
    )
  }
  return { weight, note }
}
