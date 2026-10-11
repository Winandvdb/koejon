import { describe, expect, it } from 'vitest'
import { apply, createMatch, legalActions, partnerOf, pendingSeats, RANK_ORDER, RANKS, trickWinnerIndex } from '../src/engine'
import type { Card, State } from '../src/engine'
import { createBot } from '../src/bots/bot'
import { troefkeHand } from '../src/bots/conventions'
import { seededRandom } from '../src/lib/seed'
import { scanMatches } from './helpers'

// Seed scans: rules checked in every match where the situation occurs, in
// place of a check by hand. A lazy dump is wrong on purpose and is skipped.
const SEEDS = 60
// A scan that finds the situation too rarely proves nothing.
const MIN_FOUND = 10
const LEVELS = ['normal', 'hard'] as const

const lowest = (cards: Card[]) => cards.reduce((a, b) => (RANK_ORDER[a.r] <= RANK_ORDER[b.r] ? a : b))

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
  it.each(LEVELS)('%s: the bidder takes the troefke trump lead with the boss trump', (level) => {
    let found = 0
    scanMatches(level, SEEDS, (s, a, notes) => {
      if (a.type !== 'play' || notes.includes('lazy dump')) return
      const trump = s.trump!
      const seat = a.seat
      if (!s.troefkeAsked || s.tricksPlayed > 0 || seat !== s.bidder || s.trick[0]?.card.s !== trump) return
      const oppAfter = [(seat + 1) % 4, (seat + 3) % 4].some((o) => !s.trick.some((tc) => tc.seat === o))
      if (!oppAfter) return
      // In trick 1 the only trumps gone are the ones in this trick.
      const hand = s.hands[seat]
      const out = RANKS.filter(
        (r) => !s.trick.some((tc) => tc.card.s === trump && tc.card.r === r) && !hand.some((c) => c.s === trump && c.r === r),
      )
      const bossOut = out.length ? Math.max(...out.map((r) => RANK_ORDER[r])) : 0
      const win = s.trick[trickWinnerIndex(s.trick, trump)]
      const top = Math.max(...s.trick.filter((tc) => tc.card.s === trump).map((tc) => RANK_ORDER[tc.card.r]))
      const sealed = win.seat === (seat + 2) % 4 && RANK_ORDER[win.card.r] >= bossOut
      const boss = hand.filter((c) => c.s === trump && RANK_ORDER[c.r] > bossOut && RANK_ORDER[c.r] > top)
      if (sealed || boss.length === 0) return
      found++
      expect(a.card, `troefke trick, seed scan at ${level}`).toEqual(lowest(boss))
    })
    expect(found).toBeGreaterThanOrEqual(MIN_FOUND)
  }, 120_000)

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

  it.each(['mcts', 'ismcts'])('%s asks a troefke only with a troefke hand, and its partner leads a trump', (id) => {
    // All four seats play the search bot, at a small budget.
    const bot = createBot({ id, iterations: 20 })
    const found = { asked: 0, led: 0 }
    for (let seed = 1; seed <= 20; seed++) {
      let s = createMatch(seed)
      const rand = seededRandom(seed * 7919 + 13)
      while (s.phase !== 'GAME_OVER') {
        const seat = pendingSeats(s)[0]
        const a = bot.decide(s, seat, rand)
        if (a.type === 'troefke') {
          found.asked++
          expect(troefkeHand(s.hands[seat], s.trump!), `troefke without a troefke hand, seed ${seed}`).toBe(true)
        }
        const obeys = s.troefkeAsked && s.tricksPlayed === 0 && s.trick.length === 0 && seat === partnerOf(s.bidder!)
        if (a.type === 'play' && obeys && s.hands[seat].some((c) => c.s === s.trump)) {
          found.led++
          expect(a.card.s, `troefke not obeyed, seed ${seed}`).toBe(s.trump)
        }
        s = apply(s, a)
      }
    }
    expect(found.asked).toBeGreaterThanOrEqual(MIN_FOUND)
    expect(found.led).toBeGreaterThanOrEqual(MIN_FOUND)
  }, 120_000)
})
