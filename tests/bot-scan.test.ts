import { describe, expect, it } from 'vitest'
import { legalActions } from '../src/engine'
import type { Card, State } from '../src/engine'
import { scanMatches } from './helpers'

// Seed scans: rules checked in every match where the situation occurs, in
// place of a check by hand. A lazy dump is wrong on purpose and is skipped.
const SEEDS = 60
// A scan that finds the situation too rarely proves nothing.
const MIN_FOUND = 10
const LEVELS = ['normal', 'hard'] as const

/** Cards played this hand: the log since its last deal. */
function playedThisHand(s: State): { seat: number; card: Card }[] {
  const out: { seat: number; card: Card }[] = []
  for (let i = s.log.length - 1; i >= 0 && s.log[i].t !== 'deal'; i--) {
    const ev = s.log[i]
    if (ev.t === 'card' && ev.card && ev.seat !== undefined) out.unshift({ seat: ev.seat, card: ev.card })
  }
  return out
}

/**
 * What a bot with trump memory reads: an opponent may hold trump until all
 * trumps outside its hand fell or it played another suit on a trump lead.
 */
function oppMayTrump(s: State, seat: number): boolean {
  const trump = s.trump!
  const played = playedThisHand(s)
  const out = 6 - s.hands[seat].filter((c) => c.s === trump).length - played.filter((p) => p.card.s === trump).length
  if (out === 0) return false
  const showedOut = new Set<number>()
  for (let t = 0; t < played.length; t += 4) {
    const w = played.slice(t, t + 4)
    if (w[0].card.s !== trump) continue
    for (const p of w.slice(1)) if (p.card.s !== trump) showedOut.add(p.seat)
  }
  return [(seat + 1) % 4, (seat + 3) % 4].some((o) => !showedOut.has(o))
}

describe('bot seed scans', () => {
  it.each(LEVELS)('%s: no side ace lead while an opponent may hold trump and another card is legal', (level) => {
    let found = 0
    scanMatches(level, SEEDS, (s, a, notes) => {
      if (a.type !== 'play' || notes.includes('lazy dump') || s.trick.length > 0) return
      const trump = s.trump!
      const sideAce = (c: Card) => c.r === 'A' && c.s !== trump
      const legal = legalActions(s, a.seat).flatMap((x) => (x.type === 'play' ? [x.card] : []))
      if (!legal.some(sideAce) || legal.every(sideAce) || !oppMayTrump(s, a.seat)) return
      found++
      expect(sideAce(a.card), `lead ${a.card.r}${a.card.s} (${notes.join('; ')}), seed scan at ${level}`).toBe(false)
    })
    expect(found).toBeGreaterThanOrEqual(MIN_FOUND)
  }, 120_000)
})
