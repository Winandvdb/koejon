import { describe, expect, it } from 'vitest'
import { apply, createMatch, fullDeck, sameCard, toPublic } from '../src/engine'
import type { Card, State } from '../src/engine'
import { dealPairs, deckStack, pairOfCard } from '../src/lib/deckstack'
import type { StackPart } from '../src/lib/deckstack'
import { C, cutAndDeal, dealtState, lastTrickState } from './helpers'

/** Score the last trick (seat 0 wins it), then go to the cut of the next hand. */
function cutAfterScore(tricksWon: [number, number], piles: [Card[], Card[]] = [[], []]): State {
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
  s = apply({ ...s, piles }, { type: 'play', seat: 0, card: C('S', 'A') })
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

describe('deck animation against the engine, card for card', () => {
  const LAST = [C('S', 'A'), C('S', 'K'), C('S', '10'), C('S', '9')]
  /** The 20 cards of the first five tricks, in a fixed order. */
  const REST = fullDeck()
    .filter((c) => !LAST.some((l) => sameCard(l, c)))
    .reverse()

  /** Lift n cards from the top and put them under, as the cutter does. */
  const cut = (deck: Card[], n: number) => [...deck.slice(n), ...deck.slice(0, n)]

  /** The table draws the last packet on top; index 0 is the top, as in the engine. */
  const stacked = (parts: StackPart[], cardsOf: (p: StackPart) => Card[]) =>
    [...parts].reverse().flatMap(cardsOf)

  /** Give out `deck` as the animated pairs do. Each card of a hand must come
   *  with the pair the table times it with (`pairOfCard`). */
  function dealtHands(deck: Card[], dealer: number): Card[][] {
    const hands: Card[][] = [[], [], [], []]
    dealPairs(dealer).forEach((p, i) => {
      const h = hands[p.seat]
      expect([pairOfCard(dealer, p.seat, h.length), pairOfCard(dealer, p.seat, h.length + 1)]).toEqual([i, i])
      h.push(deck[p.from[0]], deck[p.from[1]])
    })
    return hands
  }

  /** Deal from the engine's cut deck and compare hands and turned cards with the engine. */
  function expectDealFrom(deck: Card[], dealing: State) {
    expect(dealing.phase).toBe('DEALING')
    const hands = dealtHands(deck, toPublic(dealing).dealer)
    const after = apply(dealing, { type: 'deal', seat: dealing.dealer })
    expect(hands).toEqual(after.hands)
    const dh = hands[after.dealer]
    expect([dh[5], dh[4]]).toEqual([after.turned!.first, after.turned!.second])
  }

  /** Stack as the animation does, cut like the engine, deal as the animation does. */
  function expectSameDeal(cutting: State, cardsOf: (s: State, p: StackPart) => Card[]) {
    for (const dealer of [0, 1, 2, 3]) {
      const s: State = { ...cutting, dealer }
      const deck = stacked(deckStack(toPublic(s))!, (p) => cardsOf(s, p))
      expect(new Set(deck.map((c) => c.s + c.r)).size).toBe(24)
      expectDealFrom(cut(deck, 10), cutOnly(s))
    }
  }

  const pileCards = (s: State, p: StackPart) => (p.from === 'pile' ? s.piles[p.team] : [])

  it('after a scored hand', () => {
    expectSameDeal(cutAfterScore([2, 3], [REST.slice(0, 8), REST.slice(8)]), pileCards)
  })

  it('after a kapot hand', () => {
    expectSameDeal(cutAfterScore([5, 0], [REST, []]), pileCards)
  })

  it('after an all-passed deal', () => {
    const s: State = {
      ...dealtState(5, 0),
      phase: 'DEALER_CHOICE',
      turned: { first: C('H', '9'), second: C('S', 'K'), secondUp: true },
    }
    const hands = s.hands
    expectSameDeal(apply(s, { type: 'choose', seat: 0, suit: null }), (_, p) =>
      p.from === 'hand' ? hands[p.seat] : [],
    )
  })

  it('for the first deal of a match', () => {
    for (const dealer of [0, 1, 2, 3]) {
      const dealing = cutOnly({ ...createMatch(dealer + 1), phase: 'CUTTING', dealer })
      // A fresh shuffle: the engine keeps the cut deck for the deal.
      expectDealFrom(dealing.piles[0], dealing)
    }
  })
})
