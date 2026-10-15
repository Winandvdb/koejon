import { describe, expect, it } from 'vitest'
import { apply, createMatch, legalActions, pendingSeats } from '../src/engine'
import type { Action } from '../src/engine'
import { createAlgorithm, registerAlgorithm } from '../src/bots/algorithm'
import type { Algorithm, BotTrace } from '../src/bots/algorithm'
import { botAction, BOT_LEVELS, BOT_PROFILES, createBot, LEVEL_CONFIGS } from '../src/bots/bot'
import { decisionPhase, observe } from '../src/bots/observation'
import { breakEven, handValue } from '../src/bots/value'
import { seededRandom } from '../src/lib/seed'
import { C, dealtState, decisions, hideOthers, playingState } from './helpers'

const trace = (): BotTrace => ({ candidates: [], notes: [] })

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
    // The heuristic of the level; tests/pimc.test.ts checks the pimc of the `hard` level bot.
    const bot = createBot(`heuristic:${level}`)
    let changed = 0
    let n = 0
    for (const seed of [1, 2, 3]) {
      for (const { s, seat } of decisions(seed, level)) {
        const hidden = hideOthers(s, seat, seededRandom(seed * 1000 + n))
        if (JSON.stringify(hidden.hands) !== JSON.stringify(s.hands)) changed++
        expect(observe(hidden, seat)).toEqual(observe(s, seat))
        expect(bot.decide(hidden, seat, seededRandom(n))).toEqual(bot.decide(s, seat, seededRandom(n)))
        n++
      }
    }
    expect(n).toBeGreaterThan(100)
    expect(changed).toBeGreaterThan(n / 2)
  }, 60_000)
})

describe('the hard level bot', () => {
  const hard = createBot(LEVEL_CONFIGS.hard)
  // Seat 1 bid with three trumps (a troefke hand); its partner 3 leads the first trick.
  const hands = [
    [C('C', 'J'), C('C', 'Q'), C('D', 'J'), C('D', 'Q'), C('S', 'J'), C('S', 'Q')],
    [C('H', '9'), C('H', 'J'), C('H', 'K'), C('S', '9'), C('C', '9'), C('D', '9')],
    [C('C', 'K'), C('C', 'A'), C('D', 'K'), C('D', 'A'), C('S', 'K'), C('S', 'A')],
    [C('H', '10'), C('H', 'Q'), C('H', 'A'), C('S', '10'), C('C', '10'), C('D', '10')],
  ]
  const cases = [
    { what: 'a card', s: playingState({ bidder: 1, turn: 3, leader: 3, hands }), seat: 3, algorithm: 'pimc' },
    { what: 'the troefke', s: playingState({ bidder: 1, turn: 3, leader: 3, trickAcks: [3], hands }), seat: 1, algorithm: 'pimc' },
    { what: 'a bid', s: dealtState(5, 0), seat: 1, algorithm: 'heuristic:hard' },
  ]

  it.each(cases)('decides $what with $algorithm, as botAction does for hard', ({ s, seat, algorithm }) => {
    const tr = trace()
    const a = hard.decide(s, seat, seededRandom(1), tr)
    expect(tr.algorithm).toBe(algorithm)
    expect(botAction(s, seat, seededRandom(1), 'hard')).toEqual(a)
    // Its cards are anchored to the heuristic card, its troefke is not.
    expect(tr.notes.some((n) => n.startsWith('anchor heuristic:hard'))).toBe(a.type === 'play')
    // Two troefke searches: seconds on a loaded runner.
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
    for (const skill of [-0.1, 1.5, '1', NaN, null])
      expect(() => createAlgorithm({ id: 'heuristic:hard', skill })).toThrow(/skill must be a number in \[0, 1\]/)
    for (const skill of [0, 1]) expect(createAlgorithm({ id: 'heuristic:hard', skill }).id).toBe('heuristic:hard')
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

    // An opponent leads the ace of clubs (4 points) and the partner cannot
    // beat it; a low trump wins it cheaply as the last card.
    const s = playingState({
      trick: [
        { seat: 3, card: C('C', 'A') },
        { seat: 0, card: C('C', '9') },
        { seat: 1, card: C('C', '10') },
      ],
      leader: 3,
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

    // With skill 1 the same draw keeps the smart card.
    const ts = trace()
    expect(createBot({ id: 'heuristic:hard', skill: 1 }).decide(s, 2, () => 0.99, ts)).toEqual({ type: 'play', seat: 2, card: C('H', '9') })
    expect(ts.notes).toEqual(['contest: 4 points in the trick'])

    // The hard level's anchor draws first: the draw that dumps for heuristic:hard keeps its smart card.
    const draws = [0.99]
    const rand = seededRandom(1)
    const th = trace()
    createBot(LEVEL_CONFIGS.hard).decide(s, 2, () => draws.shift() ?? rand(), th)
    expect(th.notes.find((n) => n.startsWith('anchor '))).toMatch(/^anchor heuristic:hard 9H: /)
  })

  it('the skill option changes only the lazy dumps and draws the same random numbers', () => {
    const plain = createBot('heuristic:hard')
    const skilled = createBot({ id: 'heuristic:hard', skill: 1 })
    const profile = createBot({ id: 'heuristic:hard', skill: BOT_PROFILES.hard.skill })
    let dumps = 0
    for (const seed of [1, 2, 3])
      decisions(seed, 'hard').forEach(({ s, seat }, i) => {
        const run = (bot: typeof plain) => {
          const rand = seededRandom(seed * 1000 + i)
          const tr = trace()
          const a = bot.decide(s, seat, rand, tr)
          return { a, notes: tr.notes, next: rand() }
        }
        const p = run(plain)
        const k = run(skilled)
        // Without skill it plays as the level's profile.
        expect(run(profile)).toEqual(p)
        expect(k.next, 'same random stream').toBe(p.next)
        expect(k.notes).not.toContain('lazy dump')
        if (p.notes.includes('lazy dump')) dumps++
        else expect(k).toEqual(p)
      })
    expect(dumps).toBeGreaterThan(0)
  })
})

describe('value of a hand', () => {
  it('matches the engine scoring on finished hands of simulated matches', () => {
    let hands = 0
    const bot = createBot('heuristic:hard')
    for (const seed of [1, 2, 3, 4]) {
      let s = createMatch(seed)
      const rand = seededRandom(seed)
      while (s.phase !== 'GAME_OVER') {
        const next = apply(s, bot.decide(s, pendingSeats(s)[0], rand))
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
