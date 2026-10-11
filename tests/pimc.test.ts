import { describe, expect, it } from 'vitest'
import { apply, createMatch, legalActions, pendingSeats } from '../src/engine'
import type { Action, State } from '../src/engine'
import { createAlgorithm } from '../src/bots/algorithm'
import type { AlgorithmSpec, BotTrace } from '../src/bots/algorithm'
import { createBot } from '../src/bots/bot'
import { sampleWorld } from '../src/bots/determinize'
import { observe } from '../src/bots/observation'
import { troefkeHand, troefkeWeight } from '../src/bots/pimc'
import { seededRandom } from '../src/lib/seed'
import { C, dealtState, playingState } from './helpers'

const SAMPLES = 3

/** Seed's first deal (dealer 0): seat 3 bids on the 1st card, so seat 1, its partner, leads. */
function troefkeState(seed: number): State {
  let s = dealtState(seed, 0)
  for (const seat of [1, 2]) s = apply(s, { type: 'bid', seat, play: false })
  return apply(s, { type: 'bid', seat: 3, play: true })
}

/** All seats confirmed the dealer's cards: the leader may lead. */
function led(s: State): State {
  for (const seat of [0, 1, 2, 3]) if (!s.trickAcks.includes(seat)) s = apply(s, { type: 'ack', seat })
  return s
}

/**
 * Play `steps` actions of a seeded match: seats 0 and 2 play their cards with
 * `spec` and bid with heuristic:hard, the others are heuristic:hard.
 */
function play(seed: number, steps: number, spec: AlgorithmSpec, visit?: (s: State, a: Action, trace: BotTrace) => void): Action[] {
  const pimc = createBot({ name: 'pimc-play', rules: [{ use: spec }, { use: 'heuristic:hard' }] })
  const heuristic = createBot('heuristic:hard')
  const rand = seededRandom(seed)
  const out: Action[] = []
  let s = createMatch(seed)
  while (s.phase !== 'GAME_OVER' && out.length < steps) {
    const seat = pendingSeats(s)[0]
    const trace: BotTrace = { candidates: [], notes: [] }
    const a = (seat % 2 === 0 ? pimc : heuristic).decide(s, seat, rand, trace)
    visit?.(s, a, trace)
    out.push(a)
    s = apply(s, a)
  }
  return out
}

describe('pimc', () => {
  it('only plays legal cards and troefke choices', () => {
    let decided = 0
    for (const seed of [1, 2]) {
      play(seed, 400, { id: 'pimc', samples: SAMPLES }, (s, a, trace) => {
        expect(legalActions(s, a.seat)).toContainEqual(a)
        if (a.seat % 2 === 0 && trace.algorithm === 'pimc') {
          expect(['play', 'ack', 'troefke']).toContain(a.type)
          const key = (x: Action) => JSON.stringify(x)
          expect(trace.candidates.map((c) => key(c.action)).sort()).toEqual(legalActions(s, a.seat).map(key).sort())
          decided++
        }
      })
    }
    expect(decided).toBeGreaterThan(100)
  }, 120_000)

  it('is deterministic for a fixed seed and sample count', () => {
    const spec = { id: 'pimc', samples: 2 }
    const a = play(7, 250, spec)
    expect(play(7, 250, spec)).toEqual(a)
    // Another seed deals other hands.
    expect(play(8, 250, spec)).not.toEqual(a)
  }, 120_000)

  it('writes the average value, the range and the number of samples per action', () => {
    const traces: BotTrace[] = []
    play(3, 300, { id: 'pimc', samples: SAMPLES }, (s, a, trace) => {
      if (a.seat % 2 === 0 && trace.algorithm === 'pimc' && trace.candidates.length > 1) traces.push(trace)
    })
    expect(traces.length).toBeGreaterThan(20)
    for (const t of traces) {
      expect(t.candidates.every((c) => c.visits === SAMPLES && typeof c.score === 'number')).toBe(true)
      for (const c of t.candidates) {
        const [, min, max] = /^min (-?\d+) max (-?\d+)$/.exec(c.note!)!.map(Number)
        expect(min).toBeLessThanOrEqual(c.score!)
        expect(c.score!).toBeLessThanOrEqual(max)
      }
    }
  }, 120_000)

  it('plays the card with the best average, and lists it first in the trace', () => {
    let n = 0
    let ties = 0
    play(4, 300, { id: 'pimc', samples: SAMPLES }, (s, a, trace) => {
      if (a.seat % 2 !== 0 || trace.algorithm !== 'pimc' || trace.candidates.length < 2) return
      const best = Math.max(...trace.candidates.map((c) => c.score!))
      expect(trace.candidates[0].action).toEqual(a)
      expect(trace.candidates[0].score).toBe(best)
      if (a.type === 'play' && trace.candidates[1].score === best) {
        // A tie: a trump goes first only when the other tied card is a trump too.
        const [x, y] = trace.candidates.map((c) => (c.action.type === 'play' ? c.action.card : null))
        if (x!.s === s.trump) expect(y!.s).toBe(s.trump)
        ties++
      }
      n++
    })
    expect(n).toBeGreaterThan(20)
    expect(ties).toBeGreaterThan(0)
  }, 120_000)

  it('supports card play and the troefke, no bids or dealer choice', () => {
    const pimc = createAlgorithm('pimc')
    expect(pimc.supports(observe(dealtState(5, 0), 1))).toBe(false)
    const choice = { ...dealtState(5, 0), phase: 'DEALER_CHOICE' as const }
    expect(pimc.supports(observe(choice, 0))).toBe(false)
    expect(observe(troefkeState(1), 3).legal.map((a) => a.type)).toEqual(['ack', 'troefke'])
    expect(pimc.supports(observe(troefkeState(1), 3))).toBe(true)
    const cards = playingState({ hands: [[], [C('S', '9'), C('H', 'A')], [], []] })
    expect(pimc.supports(observe(cards, 1))).toBe(true)
    // A bot of pimc alone has no rule for a bid.
    expect(() => createBot('pimc').decide(dealtState(5, 0), 1, () => 0.5)).toThrow(/no rule decides bidding/)
  })

  it('leads a trump as the partner after a troefke', () => {
    const pimc = createAlgorithm({ id: 'pimc', samples: 2 })
    let checked = 0
    let plainWithout = 0
    for (let seed = 1; seed <= 30; seed++) {
      const s = troefkeState(seed)
      const hand = s.hands[1]
      if (!hand.some((c) => c.s === s.trump) || hand.every((c) => c.s === s.trump)) continue
      const asked = led(apply(s, { type: 'troefke', seat: 3 }))
      expect(pimc.decide(observe(asked, 1), seededRandom(seed))).toMatchObject({ card: { s: s.trump } })
      const free = pimc.decide(observe(led(s), 1), seededRandom(seed))
      if (free.type === 'play' && free.card.s !== s.trump) plainWithout++
      checked++
    }
    expect(checked).toBeGreaterThan(5)
    // Without the troefke it does lead a side card at times: the rule changes something.
    expect(plainWithout).toBeGreaterThan(0)
  }, 60_000)

  it('samples only troefke hands for the bidder once a troefke is asked', () => {
    const s = apply(troefkeState(4), { type: 'troefke', seat: 3 })
    const obs = observe(led(s), 0)
    const weight = troefkeWeight(obs)!
    expect(weight).toBeTypeOf('function')
    const fits = (w: State) => troefkeHand(w.hands[3], s.trump!)
    const rand = seededRandom(1)
    let weighted = 0
    let plain = 0
    for (let i = 0; i < 100; i++) {
      if (fits(sampleWorld(obs, rand, weight))) weighted++
      if (fits(sampleWorld(obs, rand))) plain++
    }
    expect(weighted).toBe(100)
    expect(plain).toBeLessThan(90)
    // Nothing to learn for the bidder itself, or without a troefke.
    expect(troefkeWeight(observe(led(s), 3))).toBeUndefined()
    expect(troefkeWeight(observe(led(troefkeState(4)), 0))).toBeUndefined()
  })

  it('decides the troefke with a partner that cannot see the bidder', () => {
    const pimc = createAlgorithm({ id: 'pimc', samples: 3, partnerSamples: 2 })
    const chosen = { ack: 0, troefke: 0 }
    for (let seed = 1; seed <= 30; seed++) {
      const s = troefkeState(seed)
      const trace: BotTrace = { candidates: [], notes: [] }
      const a = pimc.decide(observe(s, 3), seededRandom(seed), trace)
      expect(['ack', 'troefke']).toContain(a.type)
      expect(trace.candidates.map((c) => c.action.type).sort()).toEqual(['ack', 'troefke'])
      expect(trace.candidates[0].action).toEqual(a)
      expect(trace.candidates.every((c) => c.visits === 3)).toBe(true)
      // The same seed decides the same way.
      expect(pimc.decide(observe(s, 3), seededRandom(seed))).toEqual(a)
      chosen[a.type as 'ack' | 'troefke']++
    }
    // It asks in some deals and not in others.
    expect(chosen.ack).toBeGreaterThan(0)
    expect(chosen.troefke).toBeGreaterThan(0)
  }, 120_000)

  it('takes the number of worlds as an option and rejects the rest', () => {
    expect(createAlgorithm('pimc').id).toBe('pimc')
    expect(createAlgorithm({ id: 'pimc', samples: 5 }).id).toBe('pimc')
    expect(createAlgorithm({ id: 'pimc', partnerSamples: 2 }).id).toBe('pimc')
    expect(() => createAlgorithm({ id: 'pimc', partnerSamples: 0 })).toThrow(/positive integer/)
    expect(() => createAlgorithm('pimc:fast')).toThrow(/unknown pimc variant/)
    expect(() => createAlgorithm({ id: 'pimc', worlds: 5 })).toThrow(/unknown pimc option/)
    expect(() => createAlgorithm({ id: 'pimc', samples: 0 })).toThrow(/positive integer/)
    expect(() => createAlgorithm({ id: 'pimc', samples: 2.5 })).toThrow(/positive integer/)
    expect(() => createAlgorithm({ id: 'pimc', samples: '5' })).toThrow(/positive integer/)
  })
})
