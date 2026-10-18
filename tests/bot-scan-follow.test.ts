import { describe, expect, it } from 'vitest'
import { legalActions, partnerOf, RANK_ORDER, RANK_POINTS, trickWinnerIndex } from '../src/engine'
import type { Card } from '../src/engine'
import { LEVELS, MIN_FOUND, oppMayTrump, playedThisHand, scanMatches, SEEDS } from './helpers'

describe('bot seed scans: follow suit', () => {
  it.each(LEVELS)('%s: player 2 does not trump a plain lead with no points', (level) => {
    let found = 0
    scanMatches(level, SEEDS, (s, a, notes) => {
      if (a.type !== 'play' || notes.includes('lazy dump') || s.trick.length !== 1) return
      const trump = s.trump!
      const lead = s.trick[0].card
      if (lead.s === trump || RANK_ORDER[lead.r] > RANK_ORDER['10']) return
      // A decided hand dumps without these rules.
      if (s.points[0] >= 21 || s.points[1] >= 21) return
      const legal = legalActions(s, a.seat).flatMap((x) => (x.type === 'play' ? [x.card] : []))
      if (!legal.some((c) => c.s === trump) || !legal.some((c) => c.s !== trump)) return
      found++
      expect(a.card.s, `player 2 on a 0-point lead, seed scan at ${level}`).not.toBe(trump)
    })
    expect(found).toBeGreaterThanOrEqual(MIN_FOUND)
  }, 120_000)

  it.each(LEVELS)('%s: overtakes the partner with the led suit, not a trump', (level) => {
    let found = 0
    scanMatches(level, SEEDS, (s, a, notes) => {
      if (a.type !== 'play' || notes.includes('lazy dump') || s.trick.length === 0) return
      const trump = s.trump!
      const seat = a.seat
      const led = s.trick[0].card.s
      if (led === trump) return
      // A decided hand dumps without these rules.
      if (s.points[0] >= 21 || s.points[1] >= 21) return
      if (s.trick[trickWinnerIndex(s.trick, trump)].seat !== (seat + 2) % 4) return
      const next = [...s.trick, { seat, card: a.card }]
      if (trickWinnerIndex(next, trump) !== next.length - 1) return
      const legal = legalActions(s, seat).flatMap((x) => (x.type === 'play' ? [x.card] : []))
      if (!legal.some((c) => c.s === led)) return
      // Kapot runs excepted: a trump may protect the trick while an opponent still plays.
      const team = seat % 2
      const run = s.tricksPlayed > 0 && (s.tricksWon[team] === s.tricksPlayed || s.tricksWon[1 - team] === s.tricksPlayed)
      const oppAfter = [(seat + 1) % 4, (seat + 3) % 4].some((o) => !s.trick.some((tc) => tc.seat === o))
      if (run && oppAfter) return
      found++
      expect(a.card.s, `overtake partner on a plain lead, seed scan at ${level}`).not.toBe(trump)
    })
    expect(found).toBeGreaterThanOrEqual(MIN_FOUND)
  }, 120_000)

  it.each(LEVELS)('%s: a partner signal is a low card under the top card, read once no opponent may trump', (level) => {
    let given = 0
    let read = 0
    // A signal lead needs a signal and no trump left at the opponents: rare.
    scanMatches(level, 2 * SEEDS, (s, a, notes) => {
      if (a.type !== 'play' || notes.includes('lazy dump')) return
      const trump = s.trump!
      const has = (r: Card['r']) => s.hands[a.seat].some((c) => c.s === a.card.s && c.r === r)
      if (notes.some((n) => n.startsWith('signal: '))) {
        given++
        const aceGone = playedThisHand(s).some((p) => p.card.s === a.card.s && p.card.r === 'A')
        const note = `signal ${a.card.s}${a.card.r}, seed scan at ${level}`
        expect(s.trick[trickWinnerIndex(s.trick, trump)].seat, note).toBe(partnerOf(a.seat))
        expect(a.card.s === trump || RANK_POINTS[a.card.r] > 0, note).toBe(false)
        expect(has('A') || (aceGone && has('K')), note).toBe(true)
      }
      if (notes.some((n) => n.includes("partner's signal"))) {
        read++
        expect(oppMayTrump(s, a.seat), `signal lead, seed scan at ${level}`).toBe(false)
      }
    })
    expect(given).toBeGreaterThanOrEqual(MIN_FOUND)
    expect(read).toBeGreaterThanOrEqual(MIN_FOUND)
  }, 120_000)
})
