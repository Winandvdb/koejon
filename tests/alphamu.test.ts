import { describe, expect, it } from 'vitest'
import { apply, createMatch, legalActions, pendingSeats } from '../src/engine'
import type { Action, Card, State } from '../src/engine'
import { createAlgorithm } from '../src/bots/algorithm'
import { alphamuValues } from '../src/bots/alphamu'
import type { AlgorithmSpec, BotTrace } from '../src/bots/algorithm'
import { createBot } from '../src/bots/bot'
import { observe } from '../src/bots/observation'
import { solve } from '../src/bots/solver'
import { sampleWorld } from '../src/bots/determinize'
import { cost } from '../src/bots/pimc'
import { seededRandom } from '../src/lib/seed'
import { C, dealtState, decisions, playingState } from './helpers'

/** Seed's first deal (dealer 0): seat 3 bids on the 1st card, so seat 1, its partner, leads. */
function troefkeState(seed: number): State {
  let s = dealtState(seed, 0)
  for (const seat of [1, 2]) s = apply(s, { type: 'bid', seat, play: false })
  return apply(s, { type: 'bid', seat: 3, play: true })
}

/**
 * Play `steps` actions of a seeded match: seats 0 and 2 play their cards with
 * `spec`, the troefke with pimc and bid with heuristic:hard; the others are heuristic:hard.
 */
function play(seed: number, steps: number, spec: AlgorithmSpec, visit?: (s: State, a: Action, trace: BotTrace) => void): Action[] {
  const own = createBot({
    name: 'alphamu-play',
    rules: [{ when: { phase: 'play' }, use: spec }, { use: { id: 'pimc', samples: 2, partnerSamples: 1 } }, { use: 'heuristic:hard' }],
  })
  const heuristic = createBot('heuristic:hard')
  const rand = seededRandom(seed)
  const out: Action[] = []
  let s = createMatch(seed)
  while (s.phase !== 'GAME_OVER' && out.length < steps) {
    const seat = pendingSeats(s)[0]
    const trace: BotTrace = { candidates: [], notes: [] }
    const a = (seat % 2 === 0 ? own : heuristic).decide(s, seat, rand, trace)
    visit?.(s, a, trace)
    out.push(a)
    s = apply(s, a)
  }
  return out
}

/** Cards from text: `'QS AH 10D'`. */
const cards = (text: string): Card[] => text.split(' ').map((x) => C(x.slice(-1) as Card['s'], x.slice(0, -1) as Card['r']))
const text = (a: Action): string => (a.type === 'play' ? a.card.r + a.card.s : a.type)

describe('alphamu', () => {
  it('takes M and worlds as options and rejects the rest', () => {
    expect(createAlgorithm('alphamu').id).toBe('alphamu')
    expect(createAlgorithm({ id: 'alphamu', M: 2, worlds: 5 }).id).toBe('alphamu')
    expect(() => createAlgorithm('alphamu:strict')).toThrow(/unknown alphamu variant/)
    expect(() => createAlgorithm({ id: 'alphamu', samples: 5 })).toThrow(/unknown alphamu option/)
    for (const k of ['M', 'worlds']) {
      expect(() => createAlgorithm({ id: 'alphamu', [k]: 0 })).toThrow(/positive integer/)
      expect(() => createAlgorithm({ id: 'alphamu', [k]: 1.5 })).toThrow(/positive integer/)
      expect(() => createAlgorithm({ id: 'alphamu', [k]: '2' })).toThrow(/positive integer/)
    }
  })

  it('only plays legal cards and is deterministic for a fixed seed and options', () => {
    const spec = { id: 'alphamu', M: 2, worlds: 3 }
    let decided = 0
    const a = play(7, 250, spec, (s, act, trace) => {
      expect(legalActions(s, act.seat)).toContainEqual(act)
      if (trace.algorithm === 'alphamu') {
        expect(act.type).toBe('play')
        decided++
      }
    })
    expect(decided).toBeGreaterThan(20)
    expect(play(7, 250, spec)).toEqual(a)
    // Another seed deals other hands.
    expect(play(8, 250, spec)).not.toEqual(a)
  }, 120_000)

  it('supports card play only: bids, the dealer choice and the troefke go to the next rule', () => {
    const alphamu = createAlgorithm('alphamu')
    expect(alphamu.supports(observe(dealtState(5, 0), 1))).toBe(false)
    const choice = { ...dealtState(5, 0), phase: 'DEALER_CHOICE' as const }
    expect(alphamu.supports(observe(choice, 0))).toBe(false)
    expect(observe(troefkeState(1), 3).legal.map((a) => a.type)).toEqual(['ack', 'troefke'])
    expect(alphamu.supports(observe(troefkeState(1), 3))).toBe(false)
    const cards = playingState({ hands: [[], [C('S', '9'), C('H', 'A')], [], []] })
    expect(alphamu.supports(observe(cards, 1))).toBe(true)
    // A bot with alphamu needs a rule after it for the troefke and the bids.
    const bot = createBot({ name: 'am', rules: [{ use: { id: 'alphamu', worlds: 2 } }, { use: 'pimc' }, { use: 'heuristic:hard' }] })
    const trace: BotTrace = { candidates: [], notes: [] }
    bot.decide(troefkeState(1), 3, seededRandom(1), trace)
    expect(trace.algorithm).toBe('pimc')
    expect(() => createBot('alphamu').decide(dealtState(5, 0), 1, () => 0.5)).toThrow(/no rule decides bidding/)
  })

  it('with M = 1 plays the card of pimc on the same worlds', () => {
    const worlds = 4
    const pimc = createAlgorithm({ id: 'pimc', samples: worlds })
    const alphamu = createAlgorithm({ id: 'alphamu', M: 1, worlds })
    let n = 0
    let differ = 0
    for (const seed of [1, 2]) {
      play(seed, 400, { id: 'alphamu', M: 1, worlds: 2 }, (s, a, trace) => {
        if (trace.algorithm !== 'alphamu') return
        const obs = observe(s, a.seat)
        const card = alphamu.decide(obs, seededRandom(n))
        expect(card).toEqual(pimc.decide(obs, seededRandom(n)))
        if (JSON.stringify(card) !== JSON.stringify(obs.legal[0])) differ++
        n++
      })
    }
    expect(n).toBeGreaterThan(50)
    // Not just the first legal card each time.
    expect(differ).toBeGreaterThan(10)
  }, 120_000)

  it('writes the mean of the best vector, the worlds and the front per card, the choice first', () => {
    const traces: { s: State; a: Action; trace: BotTrace }[] = []
    play(3, 300, { id: 'alphamu', M: 3, worlds: 3 }, (s, a, trace) => {
      if (trace.algorithm === 'alphamu') traces.push({ s, a, trace })
    })
    expect(traces.length).toBeGreaterThan(20)
    let cut = 0
    for (const { s, a, trace } of traces) {
      expect(trace.candidates[0].action).toEqual(a)
      // After a troefke only the trumps are weighed.
      if (trace.notes.includes('troefke asked: lead a trump')) continue
      expect(trace.notes.at(-1)).toMatch(/^alphamu: M=3, 3 worlds, best average -?\d+\.\d\d$/)
      expect(trace.candidates.map((c) => c.action)).toEqual(expect.arrayContaining(legalActions(s, a.seat)))
      expect(trace.candidates).toHaveLength(legalActions(s, a.seat).length)
      expect(trace.candidates[0].score).toBe(Math.max(...trace.candidates.map((c) => c.score!)))
      for (const c of trace.candidates) {
        expect(c.visits).toBe(3)
        const [, size, min, max] = /^front (\d+), min (-?\d+) max (-?\d+)(?:, cut)?$/.exec(c.note!)!.map(Number)
        expect(size).toBeGreaterThanOrEqual(1)
        if (c.note!.endsWith(', cut')) {
          // A card cut short surely loses: its score, an upper bound, is below the choice.
          expect(c.score!).toBeLessThan(trace.candidates[0].score!)
          cut++
        }
        expect(min).toBeLessThanOrEqual(c.score!)
        expect(c.score!).toBeLessThanOrEqual(max)
      }
    }
    expect(cut).toBeGreaterThan(0)
  }, 120_000)

  it('avoids strategy fusion: no lead that needs a guess pimc assumes it will make', () => {
    // Trick 4, hearts trump, seat 2 (our partner) bid; we have 4 points, they have 17.
    // Seat 0 leads with QS AH 10D. Two worlds fit what it saw:
    //   A: seat 1 QD JH JS, seat 2 QH 10S KS, seat 3 9S JD KC
    //   B: seat 1 9S JS JH, seat 2 KC QH QD, seat 3 JD KS 10S
    // After AH, seats 1 and 2 must follow with their one trump, and seat 3 can
    // throw JD in both worlds: seat 0 still cannot tell them apart. Then QS
    // wins the hand only in A and 10D only in B, so AH wins in one world and
    // loses (-2) in the other. 10D now is a draw in A and wins in B.
    const base = { trump: 'H' as const, bidder: 2, turn: 0, leader: 0, tricksPlayed: 3, tricksWon: [2, 1] as [number, number], points: [4, 17] as [number, number] }
    const own = cards('QS AH 10D')
    const worlds = [
      playingState({ ...base, hands: [own, cards('QD JH JS'), cards('QH 10S KS'), cards('9S JD KC')] }),
      playingState({ ...base, hands: [own, cards('9S JS JH'), cards('KC QH QD'), cards('JD KS 10S')] }),
    ]
    const legal = observe(worlds[0], 0).legal
    const best = (sums: number[]) => text(legal[sums.indexOf(Math.max(...sums))])
    // pimc: each world solved with all cards open, so after AH it always guesses right.
    const pimc = legal.map((a) => worlds.reduce((sum, w) => sum + solve(w, 0, [a])[0].value, 0))
    expect(pimc).toEqual([-1, 2, 1])
    expect(best(pimc)).toBe('AH')
    // The partner's forced QH counts as the 2nd own-team move, so the guess needs M = 3.
    for (const M of [1, 2]) expect(best(alphamuValues(worlds, 0, legal, M).map((v) => v.sum))).toBe('AH')
    for (const M of [3, 4]) {
      const values = alphamuValues(worlds, 0, legal, M)
      expect(best(values.map((v) => v.sum))).toBe('10D')
      expect(values.map((v) => v.sum)).toEqual([-1, -1, 1])
      // AH keeps two plans, each good in one world only.
      expect(values[1].front).toEqual([[1, -2], [-2, 1]])
    }
  })

  it('cuts only cards that cannot win: the same choice and exact values for the rest', () => {
    const choice = (values: { sum: number; action: Action }[], trump: State['trump']) =>
      values.map((_, i) => i).sort((i, j) => values[j].sum - values[i].sum || cost(values[i].action, trump) - cost(values[j].action, trump) || i - j)[0]
    let n = 0
    let cut = 0
    for (const seed of [1, 2]) {
      for (const { s, seat } of decisions(seed, 'hard')) {
        const obs = observe(s, seat)
        if (obs.legal[0].type !== 'play' || s.tricksPlayed === 0) continue
        const rand = seededRandom(n++)
        const worlds = Array.from({ length: 4 }, () => sampleWorld(obs, rand))
        const full = alphamuValues(worlds, seat, obs.legal, 3)
        const fast = alphamuValues(worlds, seat, obs.legal, 3, true)
        expect(choice(fast, s.trump)).toBe(choice(full, s.trump))
        fast.forEach((v, i) => {
          if (v.exact) expect(v.sum).toBe(full[i].sum)
          else {
            expect(v.sum).toBeGreaterThanOrEqual(full[i].sum)
            expect(full[i].sum).toBeLessThan(full[choice(full, s.trump)].sum)
            cut++
          }
        })
      }
    }
    expect(n).toBeGreaterThan(100)
    expect(cut).toBeGreaterThan(20)
  }, 120_000)
})
