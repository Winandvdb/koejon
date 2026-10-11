import { describe, expect, it } from 'vitest'
import { legalActions, trickWinnerIndex } from '../src/engine'
import { scanMatches } from './helpers'

// Seed scans: rules checked in every match where the situation occurs, in
// place of a check by hand. A lazy dump is wrong on purpose and is skipped.
const SEEDS = 60
// A scan that finds the situation too rarely proves nothing.
const MIN_FOUND = 10
const LEVELS = ['normal', 'hard'] as const

describe('bot seed scans', () => {
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
})
