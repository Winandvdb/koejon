import { describe, expect, it } from 'vitest'
import { apply, createMatch, isBidding, leftOf, pendingSeats } from '../src/engine'
import type { Action, Card, State } from '../src/engine'
import { createAlgorithm, registerAlgorithm } from '../src/bots/algorithm'
import type { BotTrace } from '../src/bots/algorithm'
import { createBot } from '../src/bots/bot'
import { sampleWorld } from '../src/bots/determinize'
import { inferenceWeight, pastDecisions, WEIGHT_FLOOR, worldWeight } from '../src/bots/inference'
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

/** A model that records what it is shown and finds every legal action equally likely. */
const shown: Observation[] = []
registerAlgorithm('recorder', () => ({
  id: 'recorder',
  supports: () => true,
  decide: (obs) => obs.legal[0],
  policy(obs) {
    shown.push(obs)
    return obs.legal.map((action) => ({ action, p: 1 / obs.legal.length }))
  },
}))

interface Seen {
  obs: Observation
  action: Action
}

/**
 * A heuristic:hard match: each state with the real bid, troefke and dealer's
 * choice decisions of its hand so far (the observation then and the action).
 */
function matchWithDecisions(seed: number, visit: (s: State, past: Seen[]) => void): void {
  const bot = createBot('heuristic:hard')
  const rand = seededRandom(seed)
  let s = createMatch(seed)
  let past: Seen[] = []
  while (s.phase !== 'GAME_OVER') {
    const seat = pendingSeats(s)[0]
    visit(s, past)
    const obs = observe(s, seat)
    const a = bot.decide(s, seat, rand)
    if (a.type === 'deal') past = []
    const troefkeChoice = a.type === 'troefke' || (a.type === 'ack' && obs.legal.some((x) => x.type === 'troefke'))
    if (a.type === 'bid' || a.type === 'choose' || troefkeChoice) past = [...past, { obs, action: a }]
    s = apply(s, a)
  }
}

const sortedKeys = (cards: Card[]) => cards.map((c) => c.s + c.r).sort()
const thisHand = (log: State['log']) => log.slice(log.findLastIndex((e) => e.t === 'deal'))

describe('pastDecisions and worldWeight', () => {
  it('rebuild the observation each seat had at its decision, with its hand of the world', () => {
    let checked = 0
    let troefkes = 0
    for (const seed of [1, 2, 3]) {
      matchWithDecisions(seed, (s, past) => {
        if (s.phase !== 'PLAYING' && !isBidding(s.phase)) return
        for (const seat of [0, 1, 2, 3]) {
          const history = pastDecisions(observe(s, seat))
          shown.length = 0
          // The live state is one of the worlds: the one with the real hands.
          worldWeight(s, history, createAlgorithm('recorder'))
          // Other seats' decisions, made with the hand in view.
          const want = past.filter((d) => d.obs.seat !== seat && d.obs.hand.length > 0)
          expect(history.map((d) => d.action)).toEqual(want.map((d) => d.action))
          want.forEach((d, i) => {
            // Acks and pending seats moved on while the seat thought: not part of the rebuild.
            // The log keeps 60 events: compare it from the hand's deal.
            const { trickAcks: _a, actionSeats: _b, ...real } = d.obs
            const { trickAcks: _c, actionSeats: _d, ...rebuilt } = shown[i]
            expect({ ...rebuilt, hand: sortedKeys(rebuilt.hand), log: thisHand(rebuilt.log) }).toEqual({
              ...real,
              hand: sortedKeys(real.hand),
              log: thisHand(real.log),
            })
            checked++
            if (d.action.type === 'troefke' || d.action.type === 'ack') troefkes++
          })
        }
      })
    }
    expect(checked).toBeGreaterThan(500)
    expect(troefkes).toBeGreaterThan(20)
  }, 120_000)

  it('keeps every weight between the floor and 1', () => {
    const model = createAlgorithm('heuristic:hard')
    const rand = seededRandom(3)
    let floored = 0
    let n = 0
    for (const seed of [4, 5]) {
      matchWithDecisions(seed, (s) => {
        if (s.phase !== 'PLAYING' || s.tricksPlayed > 1) return
        const obs = observe(s, s.turn)
        const history = pastDecisions(obs)
        if (history.length === 0) return
        for (let k = 0; k < 5; k++) {
          const w = worldWeight(sampleWorld(obs, rand), history, model)
          expect(w).toBeGreaterThanOrEqual(WEIGHT_FLOOR)
          expect(w).toBeLessThanOrEqual(1)
          if (w === WEIGHT_FLOOR) floored++
          n++
        }
      })
    }
    expect(n).toBeGreaterThan(200)
    // The floor is reached: worlds the model cannot explain stay possible.
    expect(floored).toBeGreaterThan(10)
  }, 120_000)

  it('gives a seat that bid on a suit more trumps than uniform samples do', () => {
    const model = createAlgorithm('heuristic:hard')
    const rand = seededRandom(17)
    const WORLDS = 30
    let uniform = 0
    let weighted = 0
    let positions = 0
    for (const seed of [6, 7, 8, 9]) {
      matchWithDecisions(seed, (s) => {
        // The first lead after a bid, seen by a seat that is not the bidder.
        if (s.phase !== 'PLAYING' || s.tricksPlayed > 0 || s.trick.length > 0 || s.trickAcks.length < 4) return
        const bidder = s.bidder!
        const seat = s.turn === bidder ? leftOf(bidder) : s.turn
        const obs = observe(s, seat)
        if (!pastDecisions(obs).some((d) => d.action.type === 'bid' && d.action.play)) return
        const { weight } = inferenceWeight(obs, { model })
        const trumps = (w: State) => w.hands[bidder].filter((c) => c.s === s.trump).length
        for (let k = 0; k < WORLDS; k++) {
          uniform += trumps(sampleWorld(obs, rand))
          weighted += trumps(sampleWorld(obs, rand, weight))
        }
        positions++
      })
    }
    expect(positions).toBeGreaterThanOrEqual(10)
    const mean = (x: number) => x / (positions * WORLDS)
    expect(mean(weighted)).toBeGreaterThan(mean(uniform) + 0.3)
  }, 120_000)
})

// A model without a policy.
registerAlgorithm('no-policy', () => ({ id: 'no-policy', supports: () => true, decide: (obs) => obs.legal[0] }))

describe('option inference', () => {
  for (const id of ['pimc', 'mcts', 'ismcts']) {
    it(`${id}: builds its model through the registry and checks it`, () => {
      expect(() => createAlgorithm({ id, inference: { model: 'heuristic:hard' } })).not.toThrow()
      expect(() => createAlgorithm({ id, inference: { model: { id: 'heuristic:hard', skill: 1 } } })).not.toThrow()
      expect(() => createAlgorithm({ id, inference: { model: 'no-policy' } })).toThrow(/no policy/)
      expect(() => createAlgorithm({ id, inference: { model: 'heuristic:hard', floor: 0.1 } })).toThrow(/unknown .*inference option: floor/)
      expect(() => createAlgorithm({ id, inference: {} })).toThrow(/needs a model/)
      expect(() => createAlgorithm({ id, inference: 'heuristic:hard' })).toThrow(/must be an object/)
      expect(() => createAlgorithm({ id, inference: { model: 'nope' } })).toThrow(/unknown algorithm/)
    })
  }

  const SPECS = [
    { id: 'pimc', samples: 4, inference: { model: 'heuristic:hard' } },
    { id: 'mcts', iterations: 60, worlds: 3, inference: { model: 'heuristic:hard' } },
    { id: 'ismcts', iterations: 60, inference: { model: 'heuristic:hard' } },
  ]
  for (const spec of SPECS) {
    it(`${spec.id}: one trace note with the model and the effective sample size; the model writes nothing else`, () => {
      const plain = createAlgorithm({ ...spec, inference: undefined, id: spec.id })
      const withModel = createAlgorithm(spec)
      let checked = 0
      matchWithDecisions(10, (s) => {
        if (checked >= 6 || s.phase !== 'PLAYING' || s.trickAcks.length < 4 || s.tricksPlayed > 2) return
        const obs = observe(s, s.turn)
        if (obs.legal.length < 2 || pastDecisions(obs).length === 0) return
        const a: BotTrace = { candidates: [], notes: [] }
        const b: BotTrace = { candidates: [], notes: [] }
        plain.decide(obs, seededRandom(1), a)
        withModel.decide(obs, seededRandom(1), b)
        const notes = b.notes.filter((n) => n.startsWith('inference'))
        expect(notes).toHaveLength(1)
        expect(notes[0]).toMatch(/^inference heuristic:hard: \d+ decisions read, ESS \d+\.\d of \d+ worlds weighed$/)
        // Nothing of the model's own reasons (heuristic notes such as 'bid: rating') in the trace.
        expect(b.notes.filter((n) => !n.startsWith('inference'))).toHaveLength(a.notes.length)
        checked++
      })
      expect(checked).toBe(6)
    }, 60_000)
  }
})
