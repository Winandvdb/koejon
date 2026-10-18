import { describe, expect, it } from 'vitest'
import { apply, createMatch, legalActions, partnerOf, pendingSeats } from '../src/engine'
import { createBot, HARD_ANCHOR_MARGIN, HARD_PIMC, LEVEL_CONFIGS } from '../src/bots/bot'
import { troefkeHand } from '../src/bots/conventions'
import { seededRandom } from '../src/lib/seed'
import { MIN_FOUND, scanMatches, SEEDS } from './helpers'

describe('bot seed scans: search bots', () => {
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

  it('hard level: a card other than the anchor card beats it by more than the margin', () => {
    // pimc is slow: few seeds, but every card decision counts.
    let found = 0
    let kept = 0
    const hard = createBot(LEVEL_CONFIGS.hard)
    scanMatches('hard', 2, (s, a, notes, trace) => {
      const anchor = trace.candidates.find((c) => c.note?.endsWith(', anchor'))
      if (a.type !== 'play' || !anchor) return
      const note = notes.find((n) => n.startsWith('anchor heuristic:hard '))
      // The scores are averages: their difference can miss a margin on the 0.1 grid by a rounding error.
      const gain = trace.candidates[0].score! - anchor.score! - 1e-9
      if (JSON.stringify(anchor.action) === JSON.stringify(a)) {
        expect(gain, note).toBeLessThanOrEqual(HARD_ANCHOR_MARGIN)
        kept++
      } else {
        found++
        expect(a, note).toEqual(trace.candidates[0].action)
        expect(gain, note).toBeGreaterThan(HARD_ANCHOR_MARGIN)
      }
    }, hard)
    expect(found).toBeGreaterThanOrEqual(MIN_FOUND)
    expect(kept).toBeGreaterThan(found)
  }, 300_000)

  it('hard level: the anchor never plays a lazy dump', () => {
    let found = 0
    scanMatches('hard', SEEDS, (s, a, notes) => {
      if (a.type !== 'play' || legalActions(s, a.seat).length < 2) return
      found++
      expect(notes, 'lazy dump in the hard level anchor').not.toContain('lazy dump')
    }, createBot(HARD_PIMC.anchor))
    expect(found).toBeGreaterThanOrEqual(MIN_FOUND)
  }, 120_000)
})
