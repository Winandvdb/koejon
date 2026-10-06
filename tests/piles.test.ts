import { describe, expect, it } from 'vitest'
import { apply, toPublic } from '../src/engine'
import type { Card, State } from '../src/engine'
import { C, dealtState, lastTrickState, playingState } from './helpers'

const key = (c: Card) => `${c.s}${c.r}`

/** Read the dealt deck back from the hands, in the order the dealer dealt it. */
function dealtDeck(s: State): Card[] {
  const d = s.dealer
  const order = [(d + 1) % 4, (d + 2) % 4, (d + 3) % 4, d]
  const deck: Card[] = []
  for (let round = 0; round < 3; round++) {
    for (const seat of order) deck.push(s.hands[seat][2 * round], s.hands[seat][2 * round + 1])
  }
  return deck
}

/** Lift k cards from the top of `deck` and put them under the rest. */
const cut = (deck: Card[], k: number) => [...deck.slice(k), ...deck.slice(0, k)]

describe('trick piles', () => {
  it('puts a won trick on the pile of the winning team', () => {
    let s = playingState({
      trump: 'H',
      turn: 1,
      hands: [[C('S', '9')], [C('S', 'A')], [C('S', '10')], [C('S', 'K')]],
    })
    for (const seat of [1, 2, 3, 0]) s = apply(s, { type: 'play', seat, card: s.hands[seat][0] })
    expect(s.piles[0]).toEqual([])
    expect(s.piles[1].map(key).sort()).toEqual(['S10', 'S9', 'SA', 'SK'])
  })

  /** Play one fixed trick with RNG `rng` and return the order on the pile. */
  const pileOrder = (rng: number) => {
    let s = playingState({
      rng,
      trump: 'H',
      turn: 1,
      hands: [[C('S', '9')], [C('S', 'A')], [C('S', '10')], [C('S', 'K')]],
    })
    for (const seat of [1, 2, 3, 0]) s = apply(s, { type: 'play', seat, card: s.hands[seat][0] })
    return s.piles[1].map(key).join()
  }

  it('shuffles the 4 cards of a collected trick', () => {
    const orders = new Set(Array.from({ length: 40 }, (_, i) => pileOrder(i + 1)))
    expect(orders.size).toBeGreaterThan(10)
  })

  it('shuffles a trick the same way for the same seeded RNG', () => {
    for (let i = 1; i <= 10; i++) expect(pileOrder(i)).toBe(pileOrder(i))
  })

  it('builds the next deck from both piles, team 0 on top, with only a cut', () => {
    const first = dealtState(42).hands.flat()
    const piles: [Card[], Card[]] = [first.slice(0, 8), first.slice(8, 20)]
    // The last trick (4 cards) is still to play; seat 0 wins it for team 0.
    let s = lastTrickState({
      trick: [
        { seat: 1, card: first[20] },
        { seat: 2, card: first[21] },
        { seat: 3, card: first[22] },
      ],
      turn: 0,
      card: first[23],
    })
    s = { ...s, trump: first[23].s, piles }
    s = apply(s, { type: 'play', seat: 0, card: first[23] })
    expect(s.phase).toBe('SCORED')
    // The last trick lies on its winner's pile, in shuffled order.
    const winner = [...s.log].reverse().find((e) => e.t === 'trick')!.seat! % 2
    expect(s.piles[winner].slice(0, piles[winner].length)).toEqual(piles[winner])
    expect(s.piles[winner].slice(-4).map(key).sort()).toEqual(first.slice(20).map(key).sort())
    const stacked = [...s.piles[0], ...s.piles[1]]
    s = apply(apply(s, { type: 'next', seat: 0 }), { type: 'deal', seat: 1 })
    const deck = dealtDeck(s)
    const k = [...Array(25).keys()].filter((i) => cut(stacked, i).every((c, j) => key(c) === key(deck[j])))
    expect(k).toHaveLength(1)
    expect(k[0]).toBeGreaterThanOrEqual(4)
    expect(k[0]).toBeLessThanOrEqual(20)
    expect(s.piles).toEqual([[], []])
  })

  it('puts the hands back on the deck unshuffled after an all-passed deal', () => {
    let s: State = {
      ...dealtState(5, 0),
      phase: 'DEALER_CHOICE',
      turned: { first: C('H', '9'), second: C('S', 'K'), secondUp: true },
    }
    const thrownIn = s.hands.flat()
    s = apply(s, { type: 'choose', seat: 0, suit: null })
    expect(s.piles).toEqual([thrownIn, []])
    s = apply(s, { type: 'deal', seat: 1 })
    const deck = dealtDeck(s).map(key)
    const ok = [...Array(17).keys()].some((i) => cut(thrownIn, i + 4).map(key).join() === deck.join())
    expect(ok).toBe(true)
  })

  it('keeps the piles private', () => {
    const pub = toPublic(playingState({ piles: [[C('S', 'A')], []] }))
    expect(JSON.stringify(pub)).not.toContain('piles')
  })
})
