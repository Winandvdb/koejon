import { describe, expect, it } from 'vitest'
import { apply, createMatch, legalActions, pendingSeats, rngShuffle } from '../src/engine'
import type { Action, State } from '../src/engine'
import { createAlgorithm, registerAlgorithm } from '../src/bots/algorithm'
import type { Algorithm, BotTrace } from '../src/bots/algorithm'
import { botAction, BOT_LEVELS, createBot } from '../src/bots/bot'
import type { BotLevel } from '../src/bots/bot'
import { decisionPhase, observe } from '../src/bots/observation'
import { breakEven, handValue } from '../src/bots/value'
import { seededRandom } from '../src/lib/seed'
import { C, dealtState, playingState } from './helpers'

const trace = (): BotTrace => ({ candidates: [], notes: [] })

/** Real decisions of a bot match: more than one legal action, not a lift or the first dealer. */
function decisions(seed: number, level: BotLevel): { s: State; seat: number }[] {
  const out: { s: State; seat: number }[] = []
  let s = createMatch(seed)
  const rand = seededRandom(seed * 7919 + 13)
  while (s.phase !== 'GAME_OVER') {
    const seat = pendingSeats(s)[0]
    const legal = legalActions(s, seat)
    if (legal.length > 1 && !['draw', 'cut', 'chooseDealer'].includes(legal[0].type)) out.push({ s, seat })
    s = apply(s, botAction(s, seat, rand, level))
  }
  return out
}

/** Same public info, other hidden cards: the other hands dealt anew, other deck and RNG. */
function hideOthers(s: State, seat: number, rand: () => number): State {
  const t = structuredClone(s)
  const others = [0, 1, 2, 3].filter((x) => x !== seat)
  const cards = rngShuffle({ rng: Math.floor(rand() * 2 ** 31) }, others.flatMap((x) => t.hands[x]))
  for (const x of others) t.hands[x] = cards.splice(0, t.hands[x].length)
  t.rng = s.rng + 12345
  t.seed = s.seed + 1
  t.piles = [rngShuffle({ rng: 7 }, [...t.piles[0], ...t.piles[1]]), []]
  return t
}

describe('observe', () => {
  it('holds the own hand and the public state, but no other hands, deck or RNG', () => {
    const s = playingState({
      hands: [[C('S', 'A')], [C('H', 'K'), C('C', '9')], [C('D', 'Q')], [C('S', '10')]],
      piles: [[C('D', 'A')], []],
    })
    const obs = observe(s, 1)
    expect(obs.hand).toEqual([C('H', 'K'), C('C', '9')])
    expect(obs.handCounts).toEqual([1, 2, 1, 1])
    expect(obs.legal).toEqual(legalActions(s, 1))
    for (const key of ['hands', 'rng', 'seed', 'piles']) expect(obs).not.toHaveProperty(key)
    const text = JSON.stringify(obs)
    for (const c of [C('S', 'A'), C('D', 'Q'), C('S', '10'), C('D', 'A')]) {
      expect(text).not.toContain(JSON.stringify(c))
    }
  })

  it('hides the draw deck and the face-down second card, and the dealer bids blind', () => {
    const drawing = apply(createMatch(3), { type: 'start', seat: 0 })
    expect(drawing.dealerDraw!.deck).not.toBeNull()
    expect(observe(drawing, 0).dealerDraw).not.toHaveProperty('deck')

    const s = dealtState(5, 0)
    expect(observe(s, 1).turned!.second).toBeNull()
    expect(observe(s, 0).hand).toEqual([])
    expect(observe(s, 1).hand).toEqual(s.hands[1])
  })

  it('counts bids, troefke and the dealer choice as bidding, card play as play', () => {
    const s = dealtState(5, 0)
    expect(decisionPhase(observe(s, 1))).toBe('bidding')
    const ack = playingState({ trickAcks: [1], bidder: 3, turn: 1, hands: [[], [C('S', '9')], [], []] })
    expect(decisionPhase(observe(ack, 3))).toBe('bidding')
    const play = playingState({ hands: [[], [C('S', '9'), C('H', 'A')], [], []] })
    expect(decisionPhase(observe(play, 1))).toBe('play')
  })
})

describe('heuristic reads only the observation', () => {
  it.each(BOT_LEVELS)('%s decides the same when the hidden cards change', (level) => {
    let changed = 0
    let n = 0
    for (const seed of [1, 2, 3]) {
      for (const { s, seat } of decisions(seed, level)) {
        const hidden = hideOthers(s, seat, seededRandom(seed * 1000 + n))
        if (JSON.stringify(hidden.hands) !== JSON.stringify(s.hands)) changed++
        expect(observe(hidden, seat)).toEqual(observe(s, seat))
        expect(botAction(hidden, seat, seededRandom(n), level)).toEqual(botAction(s, seat, seededRandom(n), level))
        n++
      }
    }
    expect(n).toBeGreaterThan(100)
    expect(changed).toBeGreaterThan(n / 2)
  }, 60_000)
})

// Small fake algorithms for the registry and the bot rules.
const first: Algorithm = { id: 'first', supports: () => true, decide: (obs) => obs.legal[0] }
const last: Algorithm = { id: 'last', supports: () => true, decide: (obs) => obs.legal[obs.legal.length - 1] }
registerAlgorithm('first', () => first)
registerAlgorithm('last', () => last)
registerAlgorithm('bidonly', () => ({
  id: 'bidonly',
  supports: (obs) => decisionPhase(obs) === 'bidding',
  decide: (obs) => obs.legal[obs.legal.length - 1],
}))
// Builds its inner algorithm through the registry, as real algorithms must.
registerAlgorithm('wrap', (variant, options, create) => {
  const inner = create(options.inner as string)
  return { id: `wrap:${variant}`, supports: () => true, decide: (obs, rand, tr) => inner.decide(obs, rand, tr) }
})

describe('createAlgorithm', () => {
  it('builds from an id or an object spec, with a nested spec in the options', () => {
    expect(createAlgorithm('heuristic:hard').id).toBe('heuristic:hard')
    expect(createAlgorithm({ id: 'heuristic:easy', contestMin: 9 }).id).toBe('heuristic:easy')
    const w = createAlgorithm({ id: 'wrap:x', inner: 'last' })
    expect(w.id).toBe('wrap:x')
    const s = playingState({ hands: [[], [C('S', '9'), C('H', 'A')], [], []] })
    expect(w.decide(observe(s, 1), () => 0)).toEqual({ type: 'play', seat: 1, card: C('H', 'A') })
  })

  it('throws on an unknown id, heuristic level or heuristic option', () => {
    expect(() => createAlgorithm('nope')).toThrow(/unknown algorithm: nope/)
    expect(() => createAlgorithm({ id: 'wrap:x', inner: 'nope' })).toThrow(/unknown algorithm/)
    expect(() => createAlgorithm('heuristic')).toThrow(/unknown heuristic level/)
    expect(() => createAlgorithm('heuristic:expert')).toThrow(/unknown heuristic level/)
    expect(() => createAlgorithm({ id: 'heuristic:hard', contsetMin: 3 })).toThrow(/unknown heuristic option/)
    expect(() => createAlgorithm({ id: 'heuristic:hard', toString: 3 } as never)).toThrow(/unknown heuristic option/)
    expect(() => createAlgorithm({ id: 'heuristic:hard', clearBid: '3' })).toThrow(/clearBid must be a number/)
    expect(() => createAlgorithm({ name: 'heuristic:hard' } as never)).toThrow(/needs a string id/)
    expect(() => registerAlgorithm('heuristic', () => first)).toThrow(/already registered/)
  })

  it('heuristic options change its decisions', () => {
    // Two trumps with a king rate 9.5: under the default threshold of 11 at stake 1.
    const hands = [[], [C('H', 'K'), C('H', '9'), C('C', '9'), C('C', '10'), C('D', '9'), C('S', 'J')], [], []]
    const s = playingState({ phase: 'BIDDING_R1', hands, turned: { first: C('H', 'Q'), second: C('S', '9'), secondUp: false }, trump: null, bidder: null })
    const obs = observe(s, 1)
    expect(createAlgorithm('heuristic:normal').decide(obs, () => 0.99)).toEqual({ type: 'bid', seat: 1, play: false })
    expect(createAlgorithm({ id: 'heuristic:normal', bidThreshold1: 5 }).decide(obs, () => 0.99)).toEqual({
      type: 'bid',
      seat: 1,
      play: true,
    })
  })
})

describe('createBot', () => {
  const bidding = dealtState(5, 0) // seat 1 to bid
  const play = playingState({ hands: [[], [C('S', '9'), C('H', 'A')], [], []] })
  const go: Action = { type: 'bid', seat: 1, play: true }
  const pass: Action = { type: 'bid', seat: 1, play: false }

  it('a plain spec is a pure bot', () => {
    const bot = createBot('last')
    expect(bot.name).toBe('last')
    expect(bot.decide(bidding, 1, () => 0)).toEqual(pass)
    expect(createBot({ id: 'wrap:y', inner: 'first' }).name).toBe('wrap:y')
    // An option named `rules` does not make a spec a configuration.
    expect(createBot({ id: 'wrap:z', inner: 'last', rules: 'strict' }).decide(bidding, 1, () => 0)).toEqual(pass)
  })

  it('the first rule whose phase matches decides', () => {
    const bot = createBot({ name: 'split', rules: [{ when: { phase: 'play' }, use: 'last' }, { use: 'first' }] })
    const tb = trace()
    expect(bot.decide(bidding, 1, () => 0, tb)).toEqual(go)
    expect(tb).toMatchObject({ rule: 1, algorithm: 'first' })
    const tp = trace()
    expect(bot.decide(play, 1, () => 0, tp)).toEqual({ type: 'play', seat: 1, card: C('H', 'A') })
    expect(tp).toMatchObject({ rule: 0, algorithm: 'last' })
  })

  it('skips a rule whose algorithm does not support the decision', () => {
    const bot = createBot({ name: 'b', rules: [{ use: 'bidonly' }, { use: 'first' }] })
    expect(bot.decide(bidding, 1, () => 0)).toEqual(pass)
    expect(bot.decide(play, 1, () => 0)).toEqual({ type: 'play', seat: 1, card: C('S', '9') })
  })

  it('throws when no rule decides', () => {
    const bot = createBot({ name: 'bids', rules: [{ use: 'bidonly' }, { when: { phase: 'bidding' }, use: 'first' }] })
    expect(() => bot.decide(play, 1, () => 0)).toThrow(/bot bids: no rule decides play/)
  })

  it('handles steps without a real choice itself', () => {
    const bot = createBot({ name: 'none', rules: [] })
    const lobby = createMatch(1)
    expect(bot.decide(lobby, 2, () => 0)).toEqual({ type: 'start', seat: 2 })
    const cutting = { ...playingState(), phase: 'CUTTING' as const, dealer: 0 }
    expect(bot.decide(cutting, 3, () => 0)).toEqual({ type: 'cut', seat: 3, n: 4 })
    const lone = playingState({ hands: [[], [C('S', '9')], [], []] })
    expect(bot.decide(lone, 1, () => 0)).toEqual({ type: 'play', seat: 1, card: C('S', '9') })
  })
})

describe('heuristic trace', () => {
  it('writes the deciding rule of a bid and of a card', () => {
    const bot = createBot('heuristic:normal')
    const tr = trace()
    bot.decide(dealtState(5, 0), 1, () => 0.99, tr)
    expect(tr.algorithm).toBe('heuristic:normal')
    expect(tr.notes.join('\n')).toMatch(/^bid: (no trump|lone trump|rating [\d.]+ vs threshold \d+)/)

    // An opponent leads the ace of clubs (4 points); a low trump wins it cheaply.
    const s = playingState({
      trick: [{ seat: 1, card: C('C', 'A') }],
      turn: 2,
      bidder: 1,
      hands: [[], [], [C('H', '9'), C('S', '9')], []],
    })
    const tc = trace()
    expect(createBot('heuristic:hard').decide(s, 2, () => 0, tc)).toEqual({ type: 'play', seat: 2, card: C('H', '9') })
    expect(tc.notes).toEqual(['contest: 4 points in the trick'])

    // A lazy dump overrides the smart card: only the dump is in the trace.
    const tl = trace()
    expect(createBot('heuristic:hard').decide(s, 2, () => 0.99, tl)).toEqual({ type: 'play', seat: 2, card: C('S', '9') })
    expect(tl.notes).toEqual(['lazy dump'])
  })
})

describe('value of a hand', () => {
  it('matches the engine scoring on finished hands of simulated matches', () => {
    let hands = 0
    for (const seed of [1, 2, 3, 4]) {
      let s = createMatch(seed)
      const rand = seededRandom(seed)
      while (s.phase !== 'GAME_OVER') {
        const next = apply(s, botAction(s, pendingSeats(s)[0], rand, 'hard'))
        if (next.phase !== s.phase && (next.phase === 'SCORED' || next.phase === 'GAME_OVER')) {
          const r = next.lastResult!
          // Lines crossed per team as the engine describes it: the winner
          // crosses the stake (never below 0), the bidder gets a koei on a loss.
          const crossed = [0, 0]
          crossed[r.winnerTeam] = Math.min(r.erased, s.lines[r.winnerTeam])
          if (r.koei) crossed[r.playingTeam] -= 1
          for (const team of [0, 1]) {
            expect(handValue(s, next, team)).toBe(crossed[team] - crossed[1 - team])
          }
          expect(handValue(s, next, 0) + handValue(s, next, 1)).toBe(0)
          hands++
        }
        s = next
      }
    }
    expect(hands).toBeGreaterThan(20)
  })

  it('break-even win chance of a bid is (s + 1) / (2s + 1)', () => {
    expect(breakEven(1)).toBeCloseTo(2 / 3)
    expect(breakEven(2)).toBeCloseTo(3 / 5)
    expect(breakEven(4)).toBeCloseTo(5 / 9)
  })
})
