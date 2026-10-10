import { describe, expect, it } from 'vitest'
import { apply, legalActions, shownHand, toPublic, turnedVisible } from '../src/engine'
import { biddingState, C, playingState } from './helpers'

describe('turned cards on the table', () => {
  it('stay up after all four confirmed, until the first card is played', () => {
    // Both turned cards are spades: all pass, the dealer goes on the second card.
    let s = biddingState(C('S', '9'), C('S', 'K'), 0)
    s.hands[1] = [C('H', '9')]
    for (const seat of [1, 2, 3]) s = apply(s, { type: 'bid', seat, play: false })
    expect(s.phase).toBe('DEALER_CHOICE')
    expect(turnedVisible(toPublic(s))).toBe(true)
    s = apply(s, { type: 'choose', seat: 0, suit: 'S' })
    // The first leader (1) is auto-confirmed; the others confirm at once.
    s.trickAcks = [1]
    for (const seat of [0, 2, 3]) s = apply(s, { type: 'ack', seat })
    expect(s.trickAcks).toHaveLength(4)
    // No extra click for the leader: the lead is legal right away.
    expect(legalActions(s, 1).some((a) => a.type === 'play')).toBe(true)
    expect(turnedVisible(toPublic(s))).toBe(true)
    s = apply(s, { type: 'play', seat: 1, card: C('H', '9') })
    expect(turnedVisible(toPublic(s))).toBe(false)
  })
})

describe('shownHand', () => {
  // The dealer's dealt hand: the two turned cards are the last two cards.
  const hand = [C('C', '9'), C('C', '10'), C('D', '9'), C('D', '10'), C('S', 'K'), C('S', '9')]

  it('leaves the turned cards out of the dealer\'s hand while they lie on the table', () => {
    const s = playingState({
      dealer: 0,
      turned: { first: C('S', '9'), second: C('S', 'K'), secondUp: true },
    })
    const pub = toPublic(s)
    expect(turnedVisible(pub)).toBe(true)
    expect(shownHand(pub, 0, hand)).toEqual(hand.slice(0, 4))
  })

  it('also leaves out a second turned card that is still face down', () => {
    const s = playingState({
      dealer: 0,
      turned: { first: C('S', '9'), second: C('S', 'K'), secondUp: false },
    })
    const pub = toPublic(s)
    // The face-down card is masked in the public state, but it is in the hand.
    expect(pub.turned!.second).toBeNull()
    expect(shownHand(pub, 0, hand)).toEqual(hand.slice(0, 4))
  })

  it('shows the turned cards again once they leave the table', () => {
    const s = playingState({ dealer: 0, trick: [{ seat: 1, card: C('H', 'A') }] })
    expect(turnedVisible(toPublic(s))).toBe(false)
    expect(shownHand(toPublic(s), 0, hand)).toEqual(hand)
  })

  it('does not change the hand of other seats', () => {
    const pub = toPublic(playingState({ dealer: 0 }))
    for (const seat of [1, 2, 3]) expect(shownHand(pub, seat, hand)).toEqual(hand)
  })
})
