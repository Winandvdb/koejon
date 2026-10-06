import { describe, expect, it } from 'vitest'
import { apply, legalActions, toPublic, turnedVisible } from '../src/engine'
import { biddingState, C } from './helpers'

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
