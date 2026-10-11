import { describe, expect, it } from 'vitest'
import { apply, createMatch, legalActions, pendingSeats } from '../src/engine'
import type { Action, State } from '../src/engine'
import { createAlgorithm } from '../src/bots/algorithm'
import type { AlgorithmSpec, BotTrace } from '../src/bots/algorithm'
import { createBot } from '../src/bots/bot'
import { observe } from '../src/bots/observation'
import { seededRandom } from '../src/lib/seed'
import { C, dealtState, playingState } from './helpers'

const SAMPLES = 3

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
  it('only plays legal cards', () => {
    let decided = 0
    for (const seed of [1, 2]) {
      play(seed, 400, { id: 'pimc', samples: SAMPLES }, (s, a, trace) => {
        expect(legalActions(s, a.seat)).toContainEqual(a)
        if (a.seat % 2 === 0 && trace.algorithm === 'pimc') {
          expect(a.type).toBe('play')
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
      if (trace.candidates[1].score === best) {
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

  it('supports card play only: no bids, troefke or dealer choice', () => {
    const pimc = createAlgorithm('pimc')
    expect(pimc.supports(observe(dealtState(5, 0), 1))).toBe(false)
    // Seat 0 bid; its partner still has to lead: ack or troefke.
    const troefke = playingState({ bidder: 0, turn: 2, leader: 2, trickAcks: [2], hands: [[C('H', 'A')], [C('S', '9')], [C('H', '9')], [C('D', '9')]] })
    expect(observe(troefke, 0).legal.map((a) => a.type)).toEqual(['ack', 'troefke'])
    expect(pimc.supports(observe(troefke, 0))).toBe(false)
    const choice = { ...dealtState(5, 0), phase: 'DEALER_CHOICE' as const }
    expect(pimc.supports(observe(choice, 0))).toBe(false)
    const cards = playingState({ hands: [[], [C('S', '9'), C('H', 'A')], [], []] })
    expect(pimc.supports(observe(cards, 1))).toBe(true)
    // A bot of pimc alone has no rule for a bid.
    expect(() => createBot('pimc').decide(dealtState(5, 0), 1, () => 0.5)).toThrow(/no rule decides bidding/)
  })

  it('takes the number of worlds as an option and rejects the rest', () => {
    expect(createAlgorithm('pimc').id).toBe('pimc')
    expect(createAlgorithm({ id: 'pimc', samples: 5 }).id).toBe('pimc')
    expect(() => createAlgorithm('pimc:fast')).toThrow(/unknown pimc variant/)
    expect(() => createAlgorithm({ id: 'pimc', worlds: 5 })).toThrow(/unknown pimc option/)
    expect(() => createAlgorithm({ id: 'pimc', samples: 0 })).toThrow(/positive integer/)
    expect(() => createAlgorithm({ id: 'pimc', samples: 2.5 })).toThrow(/positive integer/)
    expect(() => createAlgorithm({ id: 'pimc', samples: '5' })).toThrow(/positive integer/)
  })
})
