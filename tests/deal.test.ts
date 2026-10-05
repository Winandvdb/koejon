import { describe, expect, it } from 'vitest'
import { apply, createMatch, legalActions } from '../src/engine'
import type { State } from '../src/engine'
import { C, dealtState } from './helpers'

describe('deal', () => {
  it('deals 24 unique cards, 6 per seat', () => {
    const s = dealtState(42)
    expect(s.phase).toBe('BIDDING_R1')
    const all = s.hands.flat()
    expect(all).toHaveLength(24)
    const keys = new Set(all.map((c) => `${c.s}${c.r}`))
    expect(keys.size).toBe(24)
    for (const h of s.hands) expect(h).toHaveLength(6)
  })

  it('sets aside dealer cards 5 (down) and 6 (up = first turned)', () => {
    const s = dealtState(7, 2)
    const dh = s.hands[2]
    expect(s.turned!.second).toEqual(dh[4])
    expect(s.turned!.first).toEqual(dh[5])
    expect(s.turned!.secondUp).toBe(false)
  })

  it('starts bidding left of the dealer; dealer may not bid in round 1', () => {
    const s = dealtState(9, 1)
    expect(s.phase).toBe('BIDDING_R1')
    // bidders: 2, 3, 0 — never dealer(1)
    expect(legalActions(s, 2).some((a) => a.type === 'bid')).toBe(true)
    expect(legalActions(s, 1)).toHaveLength(0)
    expect(legalActions(s, 0)).toHaveLength(0)
    expect(legalActions(s, 3)).toHaveLength(0)
  })

  it('deals deterministically for a fixed seed', () => {
    const a = dealtState(123)
    const b = dealtState(123)
    expect(a.hands).toEqual(b.hands)
    expect(a.turned).toEqual(b.turned)
  })
})

describe('dealer rotation', () => {
  it('moves to the left neighbour after a scored hand', () => {
    // Craft a scored state directly.
    let s: State = {
      ...dealtState(5, 0),
      phase: 'SCORED',
      winner: null,
    }
    s = apply(s, { type: 'next', seat: 0 })
    expect(s.phase).toBe('DEALING')
    expect(s.dealer).toBe(1)
  })

  it('moves to the left neighbour on an all-passed deal and sets multiplier to 2', () => {
    let s = {
      ...dealtState(5, 0),
      phase: 'DEALER_CHOICE' as const,
      turned: { first: C('H', '9'), second: C('S', 'K'), secondUp: true },
      multiplier: 2,
    }
    s = apply(s, { type: 'choose', seat: 0, suit: null })
    expect(s.phase).toBe('DEALING')
    expect(s.dealer).toBe(1)
    expect(s.multiplier).toBe(2)
  })
})

describe('createMatch', () => {
  it('starts in LOBBY with 13 lines each', () => {
    const s = createMatch(1)
    expect(s.phase).toBe('LOBBY')
    expect(s.lines).toEqual([13, 13])
    expect(s.multiplier).toBe(1)
  })
})
