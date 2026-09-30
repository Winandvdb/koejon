import { describe, expect, it } from 'vitest'
import { apply, choiceSuits, legalActions } from '../src/engine'
import { biddingState, C } from './helpers'

const bid = (seat: number, play: boolean) => ({ type: 'bid' as const, seat, play })

describe('bidding round 1', () => {
  it('first "play" sets trump to the first turned suit, level 1', () => {
    let s = biddingState(C('H', 'A'), C('S', 'K'), 0)
    s = apply(s, bid(1, false))
    s = apply(s, bid(2, true))
    expect(s.phase).toBe('PLAYING')
    expect(s.trump).toBe('H')
    expect(s.level).toBe(1)
    expect(s.bidder).toBe(2)
    expect(s.turn).toBe(1) // left of dealer leads
  })

  it('three passes reveal the second card -> round 2 on a different suit', () => {
    let s = biddingState(C('H', 'A'), C('S', 'K'), 0)
    for (const seat of [1, 2, 3]) s = apply(s, bid(seat, false))
    expect(s.phase).toBe('BIDDING_R2')
    expect(s.turned!.secondUp).toBe(true)
    expect(s.bidIndex).toBe(0)
    // same order again: seat 1 first
    expect(legalActions(s, 1).some((a) => a.type === 'bid')).toBe(true)
  })

  it('same second suit skips round 2: dealer chooses immediately', () => {
    let s = biddingState(C('H', 'A'), C('H', 'K'), 0)
    for (const seat of [1, 2, 3]) s = apply(s, bid(seat, false))
    expect(s.phase).toBe('DEALER_CHOICE')
    expect(choiceSuits(s)).toEqual(['H'])
    expect(legalActions(s, 0).map((a) => a.type)).toContain('choose')
  })

  it('round 2 "play" sets trump to the second suit, level 2', () => {
    let s = biddingState(C('H', 'A'), C('S', 'K'), 0)
    for (const seat of [1, 2, 3]) s = apply(s, bid(seat, false))
    s = apply(s, bid(1, false))
    s = apply(s, bid(2, true))
    expect(s.phase).toBe('PLAYING')
    expect(s.trump).toBe('S')
    expect(s.level).toBe(2)
    expect(s.bidder).toBe(2)
  })

  it('all pass twice -> dealer may pick either shown suit or pass', () => {
    let s = biddingState(C('H', 'A'), C('S', 'K'), 0)
    for (const seat of [1, 2, 3]) s = apply(s, bid(seat, false))
    for (const seat of [1, 2, 3]) s = apply(s, bid(seat, false))
    expect(s.phase).toBe('DEALER_CHOICE')
    expect(choiceSuits(s).sort()).toEqual(['H', 'S'])
    s = apply(s, { type: 'choose', seat: 0, suit: 'H' })
    expect(s.phase).toBe('PLAYING')
    expect(s.trump).toBe('H')
    expect(s.level).toBe(2)
    expect(s.bidder).toBe(0)
  })

  it('dealer pass doubles the multiplier and passes the deal left', () => {
    let s = biddingState(C('H', 'A'), C('S', 'K'), 0)
    for (const seat of [1, 2, 3]) s = apply(s, bid(seat, false))
    for (const seat of [1, 2, 3]) s = apply(s, bid(seat, false))
    s = apply(s, { type: 'choose', seat: 0, suit: null })
    expect(s.phase).toBe('DEALING')
    expect(s.dealer).toBe(1)
    expect(s.multiplier).toBe(2)
  })

  it('consecutive all-passes keep doubling (x2 -> x4)', () => {
    let s = biddingState(C('H', 'A'), C('H', 'K'), 3) // dealer 3
    for (const seat of [0, 1, 2]) s = apply(s, bid(seat, false))
    // same suit -> dealer choice directly
    expect(s.phase).toBe('DEALER_CHOICE')
    s = apply(s, { type: 'choose', seat: 3, suit: null })
    expect(s.multiplier).toBe(2)
    expect(s.dealer).toBe(0)
    // second all-pass
    s = biddingState(C('D', 'A'), C('C', 'K'), 0)
    s = { ...s, multiplier: 2 }
    for (const seat of [1, 2, 3]) s = apply(s, bid(seat, false))
    for (const seat of [1, 2, 3]) s = apply(s, bid(seat, false))
    s = apply(s, { type: 'choose', seat: 0, suit: null })
    expect(s.multiplier).toBe(4)
    expect(s.dealer).toBe(1)
  })

  it('only the current bidder has bid actions', () => {
    const s = biddingState(C('H', 'A'), C('S', 'K'), 0)
    expect(legalActions(s, 1).filter((a) => a.type === 'bid')).toHaveLength(2)
    expect(legalActions(s, 2)).toHaveLength(0)
    expect(legalActions(s, 0)).toHaveLength(0)
    expect(() => apply(s, bid(2, true))).toThrow()
  })
})
