import { describe, expect, it } from 'vitest'
import { apply, createMatch, dealOrder, legalActions } from '../src/engine'
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

  it('deals the same cards for a seed as it did before (frozen)', () => {
    const s = dealtState(123, 2)
    expect(s.hands.map((h) => h.map((c) => c.s + c.r).join(' '))).toEqual([
      'HK CJ SA C9 CQ H9',
      'HQ S10 D9 SJ DJ SK',
      'DK CK S9 SQ HJ DQ',
      'C10 D10 DA HA CA H10',
    ])
    expect(s.turned).toEqual({ first: C('D', 'Q'), second: C('H', 'J'), secondUp: false })
    expect(s.rng).toBe(-1647318399)
  })

  it('deals to the left neighbour first and to the dealer last, for every dealer', () => {
    expect([0, 1, 2, 3].map(dealOrder)).toEqual([
      [1, 2, 3, 0],
      [2, 3, 0, 1],
      [3, 0, 1, 2],
      [0, 1, 2, 3],
    ])
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
    expect(s.phase).toBe('CUTTING')
    expect(s.dealer).toBe(1)
  })

  it('moves to the left neighbour on an all-passed deal and sets multiplier to 2', () => {
    let s: State = {
      ...dealtState(5, 0),
      phase: 'DEALER_CHOICE' as const,
      turned: { first: C('H', '9'), second: C('S', 'K'), secondUp: true },
      multiplier: 2,
    }
    s = apply(s, { type: 'choose', seat: 0, suit: null })
    expect(s.phase).toBe('CUTTING')
    expect(s.dealer).toBe(1)
    expect(s.multiplier).toBe(2)
  })
})

describe('cut', () => {
  /** A state in CUTTING with dealer 1, after a scored hand; all 24 cards on the piles. */
  const cutting = (): State => {
    const s = dealtState(5, 0)
    const all = s.hands.flat()
    const scored: State = { ...s, phase: 'SCORED', winner: null, piles: [all.slice(0, 12), all.slice(12)] }
    return apply(scored, { type: 'next', seat: 0 })
  }

  it('the dealer\'s right neighbour lifts 4 to 20 cards (at least 4 stay)', () => {
    const s = cutting()
    expect(s.dealer).toBe(1)
    const sizes = legalActions(s, 0).flatMap((a) => (a.type === 'cut' ? [a.n] : []))
    expect(sizes).toEqual(Array.from({ length: 17 }, (_, i) => i + 4))
    for (const seat of [1, 2, 3]) expect(legalActions(s, seat)).toHaveLength(0)
    expect(() => apply(s, { type: 'cut', seat: 0, n: 3 })).toThrow()
    expect(() => apply(s, { type: 'cut', seat: 0, n: 21 })).toThrow()
    expect(() => apply(s, { type: 'cut', seat: 2, n: 8 })).toThrow()
  })

  it('applies the cut to the deck, then the dealer deals', () => {
    const s = cutting()
    const s2 = apply(s, { type: 'cut', seat: 0, n: 20 })
    expect(s2.phase).toBe('DEALING')
    expect(s2.log.at(-1)).toMatchObject({ t: 'cut', seat: 0, n: 20 })
    expect(s2.piles[0]).toHaveLength(24)
    const stacked = [...s.piles[0], ...s.piles[1]]
    expect(s2.piles).toEqual([[...stacked.slice(20), ...stacked.slice(0, 20)], []])
    expect(legalActions(s2, 1)).toEqual([{ type: 'deal', seat: 1 }])
  })

  it('deals per two, clockwise from the left of the dealer, from the top of the cut deck', () => {
    for (const dealer of [0, 1, 2, 3]) {
      const s = apply({ ...cutting(), dealer }, { type: 'cut', seat: (dealer + 3) % 4, n: 9 })
      const deck = s.piles[0]
      const dealt = apply(s, { type: 'deal', seat: dealer })
      // Left neighbour, partner, right neighbour, dealer: 2 cards each, three times.
      const left = (dealer + 1) % 4
      for (let round = 0; round < 3; round++) {
        for (let k = 0; k < 4; k++) {
          const top = 8 * round + 2 * k
          expect(dealt.hands[(left + k) % 4].slice(2 * round, 2 * round + 2)).toEqual(deck.slice(top, top + 2))
        }
      }
    }
  })
})

describe('createMatch', () => {
  it('starts in LOBBY with 13 lines each', () => {
    const s = createMatch(1)
    expect(s.phase).toBe('LOBBY')
    expect(s.lines).toEqual([13, 13])
    expect(s.multiplier).toBe(1)
  })

  it('takes a shorter tree length', () => {
    const s = createMatch(1, undefined, 2)
    expect(s.lines).toEqual([2, 2])
    for (const team of [0, 1]) expect(s.marks.filter((m) => m.team === team && m.t === 'line')).toHaveLength(2)
  })
})
