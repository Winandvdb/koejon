import { describe, expect, it } from 'vitest'
import { apply, createMatch, toPublic } from '../src/engine'
import type { State } from '../src/engine'
import { deckStack } from '../src/lib/deckstack'
import { C, cutAndDeal, dealtState, lastTrickState } from './helpers'

/** Score the last trick (seat 0 wins it), then go to the cut of the next hand. */
function cutAfterScore(tricksWon: [number, number]): State {
  let s = lastTrickState({
    tricksWon,
    trick: [
      { seat: 1, card: C('S', 'K') },
      { seat: 2, card: C('S', '10') },
      { seat: 3, card: C('S', '9') },
    ],
    turn: 0,
    card: C('S', 'A'),
  })
  s = apply(s, { type: 'play', seat: 0, card: C('S', 'A') })
  return apply(s, { type: 'next', seat: 0 })
}

/** From CUTTING: the dealer's right neighbour cuts; the deal is still to come. */
const cutOnly = (s: State) => apply(s, { type: 'cut', seat: (s.dealer + 3) % 4, n: 10 })

function cutAfterAllPass(): State {
  const s: State = {
    ...dealtState(5, 0),
    phase: 'DEALER_CHOICE',
    turned: { first: C('H', '9'), second: C('S', 'K'), secondUp: true },
  }
  return apply(s, { type: 'choose', seat: 0, suit: null })
}

describe('deck stack animation', () => {
  it("puts team 0's trick pile on top of team 1's after a scored hand", () => {
    const s = cutAfterScore([1, 4])
    expect(s.phase).toBe('CUTTING')
    expect(deckStack(toPublic(s))).toEqual([
      { from: 'pile', team: 1, count: 4 },
      { from: 'pile', team: 0, count: 2 },
    ])
  })

  it('stacks only one pile when a team took all tricks', () => {
    expect(deckStack(toPublic(cutAfterScore([5, 0])))).toEqual([{ from: 'pile', team: 0, count: 6 }])
  })

  it("throws the hands in with seat 0's on top after an all-passed deal", () => {
    const s = cutAfterAllPass()
    expect(s.phase).toBe('CUTTING')
    expect(deckStack(toPublic(s))!.map((p) => (p.from === 'hand' ? p.seat : -1))).toEqual([3, 2, 1, 0])
  })

  it('keeps the same stack after the cut, until the cards go out', () => {
    for (const s of [cutAfterScore([1, 4]), cutAfterAllPass()]) {
      const cut = cutOnly(s)
      expect(cut.phase).toBe('DEALING')
      expect(deckStack(toPublic(cut))).toEqual(deckStack(toPublic(s)))
      expect(deckStack(toPublic(apply(cut, { type: 'deal', seat: cut.dealer })))).toBeNull()
    }
  })

  it('stacks nothing for the first deal of a match or outside the cut', () => {
    const first: State = { ...createMatch(1), phase: 'CUTTING' }
    expect(deckStack(toPublic(first))).toBeNull()
    expect(deckStack(toPublic(cutOnly(first)))).toBeNull()
    expect(deckStack(toPublic(cutAndDeal(first)))).toBeNull()
  })
})
