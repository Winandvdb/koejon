import { describe, expect, it } from 'vitest'
import { apply } from '../src/engine'
import type { Card, State } from '../src/engine'
import { troefkeIgnored, troefkeWeight } from '../src/bots/conventions'
import { BOT_PROFILES, readHand } from '../src/bots/heuristic'
import { observe } from '../src/bots/observation'
import { C, dealtState } from './helpers'

// Seat 3 bids and asks a troefke; seat 1, its partner, leads the first trick.
function asked(seed: number): State {
  let s = dealtState(seed, 0)
  for (const seat of [1, 2]) s = apply(s, { type: 'bid', seat, play: false })
  s = apply(s, { type: 'bid', seat: 3, play: true })
  s = apply(s, { type: 'troefke', seat: 3 })
  for (const seat of [0, 1, 2]) if (!s.trickAcks.includes(seat)) s = apply(s, { type: 'ack', seat })
  return s
}

/** The first troefke deal whose partner holds a card that `pick` finds, with that card led. */
function lead(pick: (hand: Card[], trump: string) => Card | undefined): State {
  for (let seed = 1; seed <= 50; seed++) {
    const s = asked(seed)
    const card = pick(s.hands[1], s.trump!)
    if (card) return apply(s, { type: 'play', seat: 1, card })
  }
  throw new Error('no deal found')
}

const ignoredNoTrump = () =>
  lead((hand, trump) => (hand.some((c) => c.s === trump) ? undefined : hand[0]))
const ignoredWithTrump = () =>
  lead((hand, trump) => (hand.some((c) => c.s === trump) ? hand.find((c) => c.s !== trump) : undefined))
const obeyed = () => lead((hand, trump) => hand.find((c) => c.s === trump))

describe('ignored troefke', () => {
  it('normal and hard read the partner as void in trump, easy does not', () => {
    const s = ignoredNoTrump()
    const key = `1:${s.trump}`
    for (const seat of [0, 2, 3]) {
      for (const level of ['normal', 'hard'] as const) {
        const read = readHand(observe(s, seat), BOT_PROFILES[level].memory)
        expect(read.voids.has(key), `${level} seat ${seat}`).toBe(true)
        expect(read.troefkeVoid).toBe(key)
      }
      expect(readHand(observe(s, seat), BOT_PROFILES.easy.memory).voids.has(key)).toBe(false)
    }
    expect(troefkeIgnored(observe(s, 0))).toBe(1)
  })

  it('reads it also when a human ignores it with a trump in hand', () => {
    const s = ignoredWithTrump()
    expect(readHand(observe(s, 0), 'full').voids.has(`1:${s.trump}`)).toBe(true)
  })

  it('gives no new read to the partner itself, or after an obeyed troefke', () => {
    const s = ignoredNoTrump()
    expect(readHand(observe(s, 1), 'full').troefkeVoid).toBeNull()
    const o = obeyed()
    expect(troefkeIgnored(observe(o, 0))).toBeNull()
    expect(readHand(observe(o, 0), 'full').troefkeVoid).toBeNull()
    // The bidder reads nothing from an obeyed troefke, an opponent only the bidder's hand.
    expect(troefkeWeight(observe(o, 3))).toBeUndefined()
    const opp = troefkeWeight(observe(o, 0))!
    const troefke = [C(o.trump!, 'A'), C(o.trump!, 'K')]
    expect(opp({ ...o, hands: [[], [C(o.trump!, '9')], [], troefke] })).toBe(1)
  })

  it('weights a world where the partner holds trump low, one without it by 1', () => {
    const s = ignoredWithTrump()
    const trump = s.trump!
    const side = s.trick[0].card
    const troefke = [C(trump, 'A'), C(trump, 'K')]
    const world = (hand1: Card[], hand3: Card[]): State => ({ ...s, hands: [[], hand1, [], hand3] })
    // The bidder reads only the partner.
    const bidder = troefkeWeight(observe(s, 3))!
    expect(bidder(world([C(trump, '9')], []))).toBe(0.1)
    expect(bidder(world([side], []))).toBe(1)
    // An opponent reads both: the bidder's troefke hand and the partner's trumps.
    const opp = troefkeWeight(observe(s, 0))!
    expect(opp(world([side], troefke))).toBe(1)
    expect(opp(world([C(trump, '9')], troefke))).toBe(0.1)
    expect(opp(world([C(trump, '9')], []))).toBeCloseTo(0.01)
    // The partner does not read itself.
    expect(troefkeWeight(observe(s, 1))!(world([C(trump, '9')], troefke))).toBe(1)
  })
})
