import { describe, expect, it } from 'vitest'
import { apply, legalActions, legalCards, trickWinnerIndex } from '../src/engine'
import type { Card } from '../src/engine'
import { C, playingState } from './helpers'

const keys = (cs: Card[]) => cs.map((c) => `${c.s}${c.r}`).sort()

describe('legal plays', () => {
  it('leader may play any card', () => {
    const hand = [C('S', 'A'), C('H', '9'), C('D', 'K')]
    const s = playingState({ hands: [hand, [], [], []], turn: 0, trick: [] })
    expect(legalCards(s, 0)).toHaveLength(3)
  })

  it('trump led: must play a trump if holding one, even a lower trump', () => {
    // ♥ trump led (A). Seat 1 holds a low trump + plain cards -> only the trump.
    const s = playingState({
      trump: 'H',
      trick: [{ seat: 0, card: C('H', 'A') }],
      hands: [[], [C('H', '9'), C('S', 'A'), C('D', 'K')], [], []],
      turn: 1,
    })
    expect(keys(legalCards(s, 1))).toEqual(['H9'])
  })

  it('trump led: void in trump -> any card', () => {
    const s = playingState({
      trump: 'H',
      trick: [{ seat: 0, card: C('H', 'A') }],
      hands: [[], [C('S', '9'), C('D', 'K')], [], []],
      turn: 1,
    })
    expect(legalCards(s, 1)).toHaveLength(2)
  })

  it('plain led: may follow suit or trump; no trump in trick -> any trump ok', () => {
    const s = playingState({
      trump: 'H',
      trick: [{ seat: 0, card: C('S', 'A') }],
      hands: [[], [C('S', '9'), C('H', '9'), C('H', 'K'), C('D', 'A')], [], []],
      turn: 1,
    })
    // S9 follow + both trumps allowed; DA illegal (would be a discard while able to follow).
    expect(keys(legalCards(s, 1))).toEqual(['H9', 'HK', 'S9'])
  })

  it('no underbuy: holding led suit may only trump HIGHER than trick trump', () => {
    const s = playingState({
      trump: 'H',
      trick: [
        { seat: 0, card: C('S', 'A') },
        { seat: 3, card: C('H', 'K') }, // trumped with K
      ],
      hands: [[], [C('S', '9'), C('H', '9'), C('H', 'Q'), C('H', 'A'), C('D', 'A')], [], []],
      turn: 1,
    })
    // S9 follow; only HA beats HK; H9/HQ underbuy -> illegal; DA illegal.
    expect(keys(legalCards(s, 1))).toEqual(['HA', 'S9'])
  })

  it('no underbuy: void in led suit -> any card incl. low trump', () => {
    const s = playingState({
      trump: 'H',
      trick: [
        { seat: 0, card: C('S', 'A') },
        { seat: 3, card: C('H', 'K') },
      ],
      hands: [[], [C('H', '9'), C('D', 'A'), C('C', 'Q')], [], []],
      turn: 1,
    })
    expect(keys(legalCards(s, 1))).toEqual(['CQ', 'DA', 'H9'])
  })

  it('rejects an illegal card via apply', () => {
    const s = playingState({
      trump: 'H',
      trick: [
        { seat: 0, card: C('S', 'A') },
        { seat: 3, card: C('H', 'K') },
      ],
      hands: [[], [C('S', '9'), C('H', '9')], [], []],
      turn: 1,
    })
    expect(() => apply(s, { type: 'play', seat: 1, card: C('H', '9') })).toThrow()
    const s2 = apply(s, { type: 'play', seat: 1, card: C('S', '9') })
    expect(s2.trick).toHaveLength(3)
  })

  it('returns no actions for a seat that is not on turn', () => {
    const s = playingState({ turn: 2 })
    expect(legalActions(s, 0)).toHaveLength(0)
  })
})

describe('trick resolution', () => {
  it('highest trump wins', () => {
    const trick = [
      { seat: 0, card: C('S', 'A') },
      { seat: 1, card: C('H', '9') },
      { seat: 2, card: C('H', 'A') },
      { seat: 3, card: C('S', 'K') },
    ]
    expect(trick[trickWinnerIndex(trick, 'H')].seat).toBe(2)
  })

  it('highest led suit wins without trump', () => {
    const trick = [
      { seat: 0, card: C('S', '10') },
      { seat: 1, card: C('S', 'A') },
      { seat: 2, card: C('D', 'A') },
      { seat: 3, card: C('S', 'K') },
    ]
    expect(trick[trickWinnerIndex(trick, 'H')].seat).toBe(1)
  })

  it('a lone trump beats aces of the led suit', () => {
    const trick = [
      { seat: 0, card: C('S', 'A') },
      { seat: 1, card: C('S', 'K') },
      { seat: 2, card: C('H', '9') },
      { seat: 3, card: C('D', 'A') },
    ]
    expect(trick[trickWinnerIndex(trick, 'H')].seat).toBe(2)
  })

  it('winner leads the next trick and points accumulate', () => {
    const s = playingState({
      trump: 'H',
      trick: [
        { seat: 3, card: C('S', 'A') },
        { seat: 0, card: C('S', 'K') },
        { seat: 1, card: C('S', 'Q') },
      ],
      hands: [[], [], [C('S', '9'), C('H', '9')], []],
      turn: 2,
      tricksPlayed: 0,
    })
    const s2 = apply(s, { type: 'play', seat: 2, card: C('S', '9') })
    // Seat 3 wins (SA). Team 1 gets 4+3+2+0 = 9 points.
    expect(s2.turn).toBe(3)
    expect(s2.leader).toBe(3)
    expect(s2.tricksWon).toEqual([0, 1])
    expect(s2.points).toEqual([0, 9])
    expect(s2.trick).toHaveLength(0)
    expect(s2.lastTrick).toHaveLength(4)
  })

  it('a completed trick waits for all four confirmations before the next lead', () => {
    const s = playingState({
      trump: 'H',
      trick: [
        { seat: 3, card: C('S', 'A') },
        { seat: 0, card: C('S', 'K') },
        { seat: 1, card: C('S', 'Q') },
      ],
      hands: [[], [], [C('S', '9'), C('H', '9')], [C('H', 'Q')]],
      turn: 2,
    })
    let s2 = apply(s, { type: 'play', seat: 2, card: C('S', '9') })
    // Winner (3) may not lead until the others acked; the winner auto-acks.
    expect(s2.trickAcks).toEqual([3])
    expect(legalActions(s2, 3)).toEqual([])
    expect(() => apply(s2, { type: 'play', seat: 3, card: C('H', 'Q') })).toThrow()
    for (const seat of [0, 1, 2]) s2 = apply(s2, { type: 'ack', seat })
    expect(legalActions(s2, 3).some((a) => a.type === 'play')).toBe(true)
    const s3 = apply(s2, { type: 'play', seat: 3, card: C('H', 'Q') })
    expect(s3.trick).toHaveLength(1)
  })

  it('the first lead of a hand also waits for all four confirmations', () => {
    // Real deals auto-ack the first leader (seat 1 here); the others must confirm.
    const s = playingState({ trickAcks: [1], hands: [[], [C('H', 'Q')], [], []] })
    expect(legalActions(s, 1)).toEqual([])
    expect(legalActions(s, 0)).toEqual([{ type: 'ack', seat: 0 }])
    let s2 = s
    for (const seat of [0, 2, 3]) s2 = apply(s2, { type: 'ack', seat })
    expect(legalActions(s2, 1).some((a) => a.type === 'play')).toBe(true)
  })

  it('lets the bidder ask for troefke when their partner leads first', () => {
    // Bidder 1, partner 3 leads: 1 may ack AND ask during the confirm window.
    const s = playingState({ bidder: 1, turn: 3, trickAcks: [3] })
    const legal = legalActions(s, 1)
    expect(legal).toContainEqual({ type: 'ack', seat: 1 })
    expect(legal).toContainEqual({ type: 'troefke', seat: 1 })
    const s2 = apply(s, { type: 'troefke', seat: 1 })
    expect(s2.troefkeAsked).toBe(true)
    // Asking implies the bidder saw the cards — no separate ack needed.
    expect(s2.trickAcks).toContain(1)
    // Once asked, the offer is gone; the lead itself is unaffected.
    expect(legalActions(s2, 1).some((a) => a.type === 'troefke')).toBe(false)
  })

  it('does not offer troefke when the bidder or an opponent leads', () => {
    const ownLead = playingState({ bidder: 1, turn: 1 })
    expect(legalActions(ownLead, 1).some((a) => a.type === 'troefke')).toBe(false)
    const oppLead = playingState({ bidder: 1, turn: 0 })
    expect(legalActions(oppLead, 1).some((a) => a.type === 'troefke')).toBe(false)
  })
})
