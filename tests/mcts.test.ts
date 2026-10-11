import { describe, expect, it } from 'vitest'
import { apply, createMatch, isBidding, legalActions, pendingSeats } from '../src/engine'
import type { Action, Card, State } from '../src/engine'
import { createAlgorithm } from '../src/bots/algorithm'
import type { AlgorithmSpec, BotTrace } from '../src/bots/algorithm'
import { createBot } from '../src/bots/bot'
import { troefkeHand, troefkeLead } from '../src/bots/conventions'
import { handOf, isDone, moveOf, moverOf, movesOf, PASS, step } from '../src/bots/mcts'
import { observe } from '../src/bots/observation'
import { handValue } from '../src/bots/value'
import { seededRandom } from '../src/lib/seed'
import { biddingState, C, dealtState, playingState } from './helpers'

const ALGORITHMS = ['mcts', 'ismcts'] as const

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
 * Play `steps` actions of a seeded match: seats 0 and 2 play `spec` for every
 * decision, the others heuristic:hard.
 */
function play(seed: number, steps: number, spec: AlgorithmSpec, visit?: (s: State, a: Action, trace: BotTrace) => void): Action[] {
  const bot = createBot(spec)
  const heuristic = createBot('heuristic:hard')
  const rand = seededRandom(seed)
  const out: Action[] = []
  let s = createMatch(seed)
  while (s.phase !== 'GAME_OVER' && out.length < steps) {
    const seat = pendingSeats(s)[0]
    const trace: BotTrace = { candidates: [], notes: [] }
    const a = (seat % 2 === 0 ? bot : heuristic).decide(s, seat, rand, trace)
    visit?.(s, a, trace)
    out.push(a)
    s = apply(s, a)
  }
  return out
}

const sorted = (moves: number[]) => [...moves].sort((a, b) => a - b)

describe('the hand model of mcts', () => {
  it('plays random hands as the engine does, with the troefke convention', () => {
    const counts = { hands: 0, allPassed: 0, troefke: 0, choice: 0 }
    for (let seed = 1; seed <= 300; seed++) {
      const rand = seededRandom(seed)
      let s = dealtState(seed, seed % 4)
      // Other scores and stakes: the floor at 0 lines, the doubled stake.
      s = { ...s, lines: [1 + (seed % 5), 1 + ((seed >> 2) % 7)], multiplier: 1 + (seed % 2) }
      const before = s
      const h = handOf(s)
      while (isBidding(s.phase) || s.phase === 'PLAYING') {
        const seat = pendingSeats(s)[0]
        let legal = legalActions(s, seat)
        // Another seat's confirmation is no decision, nor a troefke without a
        // troefke hand (the convention): the model skips them.
        const weak = legal.some((a) => a.type === 'troefke') && !troefkeHand(s.hands[seat], s.trump!)
        if ((legal.length === 1 && legal[0].type === 'ack') || weak) {
          s = apply(s, legal.find((a) => a.type === 'ack')!)
          continue
        }
        // The partner obeys the troefke: the model leaves it only the trumps.
        if (troefkeLead(observe(s, seat))) legal = legal.filter((a) => a.type === 'play' && a.card.s === s.trump)
        expect(moverOf(h)).toBe(seat)
        expect(sorted(movesOf(h, []))).toEqual(sorted(legal.map((a) => moveOf(a, s))))
        // Go now and then, so that all seats pass at times too.
        const a = legal[0].type === 'bid' ? legal[rand() < 0.15 ? 0 : 1] : legal[Math.floor(rand() * legal.length)]
        if (a.type === 'troefke') counts.troefke++
        if (a.type === 'choose') counts.choice++
        step(h, moveOf(a, s))
        s = apply(s, a)
      }
      expect(isDone(h)).toBe(true)
      if (s.phase === 'CUTTING') {
        expect(h.value).toBe(0)
        counts.allPassed++
      } else {
        expect(h.value).toBe(handValue(before, s, 0))
        counts.hands++
      }
    }
    expect(counts.hands).toBeGreaterThan(200)
    expect(counts.allPassed).toBeGreaterThan(5)
    expect(counts.troefke).toBeGreaterThan(5)
    expect(counts.choice).toBeGreaterThan(5)
  })

  it('starts from a played trick and a troefke still to decide', () => {
    const states = Array.from({ length: 30 }, (_, i) => troefkeState(i + 1))
    const strong = states.find((s) => troefkeHand(s.hands[3], s.trump!))!
    // The bidder has not confirmed yet: with a troefke hand it decides the troefke.
    expect(movesOf(handOf(strong), [])).toEqual([moveOf({ type: 'ack', seat: 3 }, strong), moveOf({ type: 'troefke', seat: 3 }, strong)])
    // Once it confirmed, or without a troefke hand, the partner leads.
    const weak = states.find((s) => !troefkeHand(s.hands[3], s.trump!))!
    for (const s of [apply(strong, { type: 'ack', seat: 3 }), weak]) {
      const lead = handOf(s)
      expect(moverOf(lead)).toBe(1)
      expect(sorted(movesOf(lead, []))).toEqual(sorted(s.hands[1].map((card) => moveOf({ type: 'play', seat: 1, card }, s))))
    }
  })

  it('tells the bids of round 2 apart by the suit of the second card', () => {
    // From round 1, where the second card is still face down, worlds differ in it.
    const r2 = (second: Card) => {
      const h = handOf(biddingState(C('S', 'Q'), second))
      for (let i = 0; i < 3; i++) step(h, PASS)
      return movesOf(h, [])
    }
    expect(r2(C('H', 'K'))).not.toEqual(r2(C('D', 'K')))
    expect(r2(C('H', 'K'))).toEqual(r2(C('H', '10')))
  })
})

describe.each(ALGORITHMS)('%s', (id) => {
  const spec = { id, iterations: 40 }

  it('only plays legal actions and fills the trace with visits and mean values', () => {
    let decided = 0
    const types = new Set<string>()
    play(1, 300, spec, (s, a, trace) => {
      expect(legalActions(s, a.seat)).toContainEqual(a)
      if (a.seat % 2 !== 0 || trace.algorithm !== id || trace.candidates.length < 2) return
      types.add(a.type)
      for (const c of trace.candidates) {
        expect(legalActions(s, a.seat)).toContainEqual(c.action)
        if (c.note === 'untried') {
          expect(c.visits).toBe(0)
          expect(c.score).toBeUndefined()
          continue
        }
        expect(c.score).toBeGreaterThanOrEqual(-4)
        expect(c.score).toBeLessThanOrEqual(4)
        expect(c.note).toMatch(/^avail \d+$/)
      }
      // The choice comes first: the most visits; all iterations start at the root.
      expect(trace.candidates[0].action).toEqual(a)
      const visits = trace.candidates.map((c) => c.visits!)
      expect(visits[0]).toBe(Math.max(...visits))
      expect(visits.reduce((x, y) => x + y)).toBe(spec.iterations)
      decided++
    })
    expect(decided).toBeGreaterThan(50)
    // Bids and cards: the whole hand is in the tree.
    expect(types).toContain('bid')
    expect(types).toContain('play')
  }, 120_000)

  it('is deterministic for a fixed seed and budget', () => {
    const a = play(7, 250, spec)
    expect(play(7, 250, spec)).toEqual(a)
    expect(play(8, 250, spec)).not.toEqual(a)
  }, 120_000)

  it('ruffs the trick that wins the hand at a small budget', () => {
    // Seat 0, 4th to play: its team bid. The H 9 trumps the 7 points and wins
    // the hand with 21; after the S 10 the other team has 20 and the bidders
    // reach 20 at most: a draw or a loss.
    const s = playingState({
      dealer: 0,
      bidder: 2,
      trump: 'H',
      tricksPlayed: 4,
      tricksWon: [2, 2],
      points: [14, 13],
      turn: 0,
      leader: 1,
      trick: [
        { seat: 1, card: C('S', 'A') },
        { seat: 2, card: C('S', '9') },
        { seat: 3, card: C('S', 'K') },
      ],
      hands: [[C('H', '9'), C('S', '10')], [C('D', '9')], [C('C', '9')], [C('C', 'A')]],
    })
    const algo = createAlgorithm({ id, iterations: 20 })
    for (let seed = 1; seed <= 5; seed++) {
      const trace: BotTrace = { candidates: [], notes: [] }
      expect(algo.decide(observe(s, 0), seededRandom(seed), trace)).toEqual({ type: 'play', seat: 0, card: C('H', '9') })
      // A sure win at stake 1, no kapot.
      expect(trace.candidates[0].score).toBe(1)
    }
  })

  it('leads a trump as the partner after a troefke', () => {
    const algo = createAlgorithm({ id, iterations: 30 })
    let checked = 0
    for (let seed = 1; seed <= 30; seed++) {
      const s = troefkeState(seed)
      const hand = s.hands[1]
      if (!hand.some((c) => c.s === s.trump) || hand.every((c) => c.s === s.trump)) continue
      const asked = led(apply(s, { type: 'troefke', seat: 3 }))
      const trace: BotTrace = { candidates: [], notes: [] }
      const card = algo.decide(observe(asked, 1), seededRandom(seed), trace)
      expect(card).toMatchObject({ card: { s: s.trump } })
      expect(trace.candidates.every((c) => c.action.type === 'play' && c.action.card.s === s.trump)).toBe(true)
      expect(trace.notes).toContain('troefke asked: lead a trump')
      checked++
    }
    expect(checked).toBeGreaterThan(5)
  })

  it('decides the troefke as a move of the tree, only with a troefke hand', () => {
    const algo = createAlgorithm({ id, iterations: 30 })
    const seen = { strong: 0, weak: 0 }
    for (let seed = 1; seed <= 20; seed++) {
      const s = troefkeState(seed)
      const trace: BotTrace = { candidates: [], notes: [] }
      const a = algo.decide(observe(s, 3), seededRandom(seed), trace)
      if (troefkeHand(s.hands[3], s.trump!)) {
        expect(['ack', 'troefke']).toContain(a.type)
        expect(trace.candidates.map((c) => c.action.type).sort()).toEqual(['ack', 'troefke'])
        seen.strong++
      } else {
        // Its troefke must mean what the other seats read.
        expect(a.type).toBe('ack')
        expect(trace.candidates).toHaveLength(1)
        seen.weak++
      }
    }
    expect(seen.strong).toBeGreaterThan(0)
    expect(seen.weak).toBeGreaterThan(0)
  })

  it('plays out with MAST as an option', () => {
    const mast = { ...spec, mast: true }
    const a = play(3, 200, mast, (s, act) => expect(legalActions(s, act.seat)).toContainEqual(act))
    expect(play(3, 200, mast)).toEqual(a)
    expect(play(3, 200, spec)).not.toEqual(a)
  }, 120_000)

  it('takes its options and rejects the rest', () => {
    expect(createAlgorithm({ id, iterations: 5, c: 0, mast: false }).id).toBe(id)
    expect(() => createAlgorithm(`${id}:fast`)).toThrow(new RegExp(`unknown ${id} variant`))
    expect(() => createAlgorithm({ id, samples: 5 })).toThrow(new RegExp(`unknown ${id} option`))
    expect(() => createAlgorithm({ id, iterations: 0 })).toThrow(/positive integer/)
    expect(() => createAlgorithm({ id, iterations: 2.5 })).toThrow(/positive integer/)
    expect(() => createAlgorithm({ id, c: -1 })).toThrow(/at least 0/)
    expect(() => createAlgorithm({ id, mast: 1 })).toThrow(/true or false/)
  })
})

describe('mcts worlds', () => {
  it('splits the iterations over the worlds', () => {
    const trace: BotTrace = { candidates: [], notes: [] }
    createAlgorithm({ id: 'mcts', iterations: 25, worlds: 4 }).decide(observe(dealtState(2, 0), 1), seededRandom(1), trace)
    expect(trace.candidates.reduce((n, c) => n + c.visits!, 0)).toBe(25)
    expect(trace.notes).toEqual(['mcts: 4 worlds, 25 iterations'])
    expect(() => createAlgorithm({ id: 'ismcts', worlds: 4 })).toThrow(/unknown ismcts option/)
  })
})
