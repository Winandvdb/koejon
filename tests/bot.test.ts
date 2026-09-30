import { describe, expect, it } from 'vitest'
import { botAction } from '../src/bots/bot'
import { C, playingState } from './helpers'
import type { Card, State } from '../src/engine'

const smart = () => 0 // rand < any threshold → deterministic smart path
const never = () => 0.99 // rand > all thresholds

/** BIDDING_R1 with seat 1 to speak; `hand` is seat 1's cards. */
function bidState(hand: Card[], over: Partial<State> = {}): State {
  const hands: Card[][] = [[], [], [], []]
  hands[1] = hand
  return playingState({
    phase: 'BIDDING_R1',
    dealer: 0,
    hands,
    turned: { first: C('H', 'Q'), second: C('S', '9'), secondUp: false },
    trump: null,
    bidder: null,
    turn: 1,
    ...over,
  })
}

const TRASH = [C('S', '9'), C('S', '10'), C('C', '9'), C('C', '10'), C('D', '9'), C('D', '10')]

describe('bot bidding', () => {
  it('knijpen: bids a trash hand when opponents sit at 2 lines', () => {
    const s = bidState(TRASH, { lines: [2, 13] }) // seat1 = team1, opp = team0
    expect(botAction(s, 1, smart)).toEqual({ type: 'bid', seat: 1, play: true })
  })

  it('no knijpen at 1 opponent line — every loss is fatal anyway', () => {
    const s = bidState(TRASH, { lines: [1, 13] })
    expect(botAction(s, 1, smart)).toEqual({ type: 'bid', seat: 1, play: false })
  })

  it('no knijpen when the doubled stake already covers their 2 lines', () => {
    const s = bidState(TRASH, { lines: [2, 13], multiplier: 2 })
    expect(botAction(s, 1, smart)).toEqual({ type: 'bid', seat: 1, play: false })
  })

  it('bids a strong hand regardless of the score', () => {
    const s = bidState([C('H', 'A'), C('H', 'K'), C('H', '9'), C('S', 'A'), C('D', 'A'), C('C', '9')])
    expect(botAction(s, 1, never)).toEqual({ type: 'bid', seat: 1, play: true })
  })
})

describe('bot troefke', () => {
  // Bidder 1, partner 3 leads trick 1; seat 1 still owes its ack.
  const troefkeState = (hand: Card[]) => {
    const hands: Card[][] = [[], [], [], []]
    hands[1] = hand
    hands[3] = [C('H', '10'), C('C', '9'), C('D', '9'), C('S', '9'), C('S', '10'), C('C', '10')]
    return playingState({
      bidder: 1,
      turn: 3,
      leader: 3,
      trickAcks: [3],
      hands,
    })
  }

  it('asks with a strong trump hand — the ask doubles as the ack', () => {
    const s = troefkeState([C('H', '9'), C('H', 'J'), C('H', 'K'), C('S', '9'), C('C', '9'), C('D', '9')])
    expect(botAction(s, 1, smart)).toEqual({ type: 'troefke', seat: 1 })
  })

  it('stays silent with a weak trump hand', () => {
    const s = troefkeState([C('H', '9'), C('S', '9'), C('S', '10'), C('C', '9'), C('D', '9'), C('D', '10')])
    expect(botAction(s, 1, smart)).toEqual({ type: 'ack', seat: 1 })
  })

  it('the partner honours the request by leading their best trump', () => {
    const s = { ...troefkeState(TRASH), troefkeAsked: true, trickAcks: [0, 1, 2, 3] }
    expect(botAction(s, 3, smart)).toEqual({ type: 'play', seat: 3, card: C('H', '10') })
  })
})

describe('bot card play', () => {
  /** PLAYING, seat 1 to act on an open trick. Partner is seat 3. */
  function followState(
    trick: { seat: number; card: Card }[],
    hand: Card[],
    over: Partial<State> = {},
  ): State {
    const hands: Card[][] = [[], [], [], []]
    hands[1] = hand
    return playingState({ bidder: 1, turn: 1, trick, hands, ...over })
  }

  it('vets a cheap point card when partner already won — keeps the ace', () => {
    // Partner (seat3) played SA on a spade lead; seat1 closes the trick.
    const s = followState(
      [
        { seat: 0, card: C('S', '9') },
        { seat: 2, card: C('S', '10') },
        { seat: 3, card: C('S', 'A') },
      ],
      [C('S', 'A'), C('S', 'J'), C('H', '9')],
    )
    // Must follow spades: SA or SJ. SA cannot overtake SA → both are safe.
    // Vets the J (1 pt) and keeps the ace for later tricks.
    expect(botAction(s, 1, smart)).toEqual({ type: 'play', seat: 1, card: C('S', 'J') })
  })

  it('ducks a cheap trick even when a trump could steal it', () => {
    // Opp leads SQ (2 pts); partner sluffs S9. seat1 is void in spades.
    const s = followState(
      [
        { seat: 0, card: C('S', 'Q') },
        { seat: 3, card: C('S', '9') },
      ],
      [C('H', '9'), C('D', '9'), C('D', '10'), C('C', '9'), C('C', '10'), C('D', 'J')],
    )
    // H9 would trump it, but a 2-point trick is not worth a trump.
    expect(botAction(s, 1, smart)).toEqual({ type: 'play', seat: 1, card: C('D', '9') })
  })

  it('contests a rich trick with the cheapest winner', () => {
    // Trick carries SQ+SA = 6 pts; seat1 is void in spades → trump it low.
    const s = followState(
      [
        { seat: 0, card: C('S', 'Q') },
        { seat: 3, card: C('S', '9') },
        { seat: 2, card: C('S', 'A') },
      ],
      [C('H', '9'), C('H', 'K'), C('D', '9'), C('D', '10'), C('C', '9'), C('C', '10')],
    )
    expect(botAction(s, 1, smart)).toEqual({ type: 'play', seat: 1, card: C('H', '9') })
  })

  it('fights to stop the opponents crossing 21', () => {
    // Team0 at 19 — letting this 2-pt trick go gives them the hand.
    const s = followState(
      [
        { seat: 0, card: C('S', 'Q') },
        { seat: 2, card: C('S', '9') },
      ],
      [C('H', '9'), C('D', '9'), C('D', '10'), C('C', '9'), C('C', '10'), C('D', 'J')],
      { points: [19, 10] },
    )
    expect(botAction(s, 1, smart)).toEqual({ type: 'play', seat: 1, card: C('H', '9') })
  })
})

describe('bot dealer choice', () => {
  const chooseState = (first: Card, second: Card, over: Partial<State> = {}) =>
    playingState({
      phase: 'DEALER_CHOICE',
      dealer: 0,
      turned: { first, second, secondUp: true },
      ...over,
    })

  it('two low cards of the same suit → usually pass', () => {
    const s = chooseState(C('H', '9'), C('H', '10'))
    expect(botAction(s, 0, never)).toEqual({ type: 'choose', seat: 0, suit: null })
    expect(botAction(s, 0, smart)).toEqual({ type: 'choose', seat: 0, suit: 'H' })
  })

  it('same suit with a real card → almost always go', () => {
    const s = chooseState(C('H', 'A'), C('H', '10'))
    expect(botAction(s, 0, () => 0.5)).toEqual({ type: 'choose', seat: 0, suit: 'H' })
  })

  it('different suits with an ace → sometimes go on the ace', () => {
    const s = chooseState(C('H', 'A'), C('S', '9'))
    expect(botAction(s, 0, () => 0.5)).toEqual({ type: 'choose', seat: 0, suit: 'H' })
    expect(botAction(s, 0, never)).toEqual({ type: 'choose', seat: 0, suit: null })
  })

  it('different weak suits → pass', () => {
    const s = chooseState(C('H', 'Q'), C('S', '10'))
    expect(botAction(s, 0, () => 0.5)).toEqual({ type: 'choose', seat: 0, suit: null })
  })

  it('always goes when a level-2 win ends the match', () => {
    const s = chooseState(C('H', 'Q'), C('S', '10'), { lines: [2, 13] })
    expect(botAction(s, 0, never)).toEqual({ type: 'choose', seat: 0, suit: 'H' })
  })
})
