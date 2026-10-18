import { describe, expect, it } from 'vitest'
import { apply, createMatch, legalActions, partnerOf, pendingSeats, RANK_ORDER, RANK_POINTS, RANKS, trickWinnerIndex } from '../src/engine'
import type { Card, State } from '../src/engine'
import { createBot, HARD_ANCHOR_MARGIN, HARD_PIMC, LEVEL_CONFIGS } from '../src/bots/bot'
import { troefkeHand, troefkeIgnored, troefkeWeight } from '../src/bots/conventions'
import { BOT_PROFILES, HEURISTIC_DEFAULTS, levelOptions, readHand } from '../src/bots/heuristic'
import { observe } from '../src/bots/observation'
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

  it.each(LEVELS)('%s: every other seat reads an ignored troefke as no trump in the partner', (level) => {
    let found = 0
    // A lazy dump ignores the troefke also with trump in hand: the read is wrong then, on purpose.
    let lazyLead = false
    scanMatches(level, SEEDS, (s, a, notes) => {
      if (a.type !== 'play' || !s.troefkeAsked) return
      const partner = partnerOf(s.bidder!)
      if (s.tricksPlayed === 0 && s.trick.length === 0) lazyLead = notes.includes('lazy dump')
      const first = playedThisHand(s)[0]
      if (!first || first.card.s === s.trump || a.seat === partner || lazyLead) return
      const obs = observe(s, a.seat)
      expect(troefkeIgnored(obs)).toBe(partner)
      expect(readHand(obs, BOT_PROFILES[level].memory).voids.has(`${partner}:${s.trump}`)).toBe(true)
      // Apart from a lazy dump, a bot ignores only without trump and asks only with a troefke hand: the real deal fits both reads.
      if (s.tricksPlayed === 0 && s.trick.length === 1) {
        found++
        expect(s.hands[partner].some((c) => c.s === s.trump), `seed scan at ${level}`).toBe(false)
        expect(troefkeWeight(obs)!(s)).toBe(1)
      }
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

  it.each(LEVELS)('%s: a short defender with one side ace does not lead trump', (level) => {
    let found = 0
    scanMatches(level, SEEDS, (s, a, notes) => {
      if (a.type !== 'play' || notes.includes('lazy dump') || s.trick.length > 0) return
      const trump = s.trump!
      const seat = a.seat
      if (seat % 2 === s.bidder! % 2 || !oppMayTrump(s, seat)) return
      const hand = s.hands[seat]
      const mine = hand.filter((c) => c.s === trump).length
      const out = 6 - mine - playedThisHand(s).filter((p) => p.card.s === trump).length
      const plain = hand.filter((c) => c.s !== trump)
      if (mine === 0 || mine > out || plain.filter((c) => c.r === 'A').length !== 1 || plain.length < 2) return
      found++
      expect(a.card.s, `lead ${a.card.r}${a.card.s} (${notes.join('; ')}), seed scan at ${level}`).not.toBe(trump)
    })
    expect(found).toBeGreaterThanOrEqual(MIN_FOUND)
  }, 120_000)

  it('easy: a lead with a side ace in hand cashes an ace, unless it pulls with the boss trump', () => {
    let found = 0
    scanMatches('easy', SEEDS, (s, a, notes) => {
      if (a.type !== 'play' || notes.includes('lazy dump') || s.trick.length > 0) return
      const trump = s.trump!
      const seat = a.seat
      const hand = s.hands[seat]
      if (hand.length < 2 || !hand.some((c) => c.r === 'A' && c.s !== trump)) return
      if (s.troefkeAsked && s.tricksPlayed === 0 && seat === partnerOf(s.bidder!)) return
      found++
      // Easy remembers nothing: a boss trump tops every trump outside its hand, played or not.
      const outside = RANKS.filter((r) => !hand.some((c) => c.s === trump && c.r === r))
      const boss = a.card.s === trump && outside.every((r) => RANK_ORDER[r] < RANK_ORDER[a.card.r])
      expect(a.card.r === 'A' || boss, `lead ${a.card.r}${a.card.s} (${notes.join('; ')}), seed scan at easy`).toBe(true)
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

  it.each(LEVELS)('%s: the dealer goes blind on two weak suits only with the hand-set chance', (level) => {
    let found = 0
    scanMatches(level, SEEDS, (s, a, notes) => {
      if (a.type !== 'choose' || s.lines[a.seat % 2] <= 2) return
      const t = s.turned!
      if (t.first.s === t.second!.s || Math.max(RANK_ORDER[t.first.r], RANK_ORDER[t.second!.r]) > RANK_ORDER['Q']) return
      found++
      expect(notes, `weak dealer choice, seed scan at ${level}`).toContain(`choose: go with chance ${HEURISTIC_DEFAULTS.dealerWeak}`)
    })
    expect(found).toBeGreaterThanOrEqual(MIN_FOUND)
  }, 120_000)

  it('a turned ace raises the bid threshold with an opponent dealer and lowers it with a partner dealer', () => {
    const base = levelOptions('hard')
    const found = { opponent: 0, partner: 0 }
    scanMatches('hard', SEEDS, (s, a, notes) => {
      const m = notes.join('\n').match(/^bid: rating ([\d.]+) vs threshold ([\d.]+)/)
      if (a.type !== 'bid' || !m) return
      const r1 = s.phase === 'BIDDING_R1'
      const shown = r1 ? s.turned!.first : s.turned!.second!
      const stakes = r1 ? s.multiplier : 2
      const partner = s.dealer === partnerOf(a.seat)
      const threshold =
        (stakes >= 4 ? base.bidThreshold4 : stakes >= 2 ? base.bidThreshold2 : base.bidThreshold1) +
        (partner ? -base.turnedPartner : base.turnedOpponent) * (RANK_POINTS[shown.r] / RANK_POINTS.A)
      expect(Number(m[2]), notes.join('; ')).toBe(Number(threshold.toFixed(2)))
      if (shown.r !== 'A') return
      const rating = Number(m[1])
      const note = notes.join('; ')
      if (!partner && rating < threshold && !/knijpen|decisive/.test(note)) {
        found.opponent++
        expect(a.play, note).toBe(false)
      }
      if (partner && rating >= threshold && !/waits|two low trumps/.test(note)) {
        found.partner++
        expect(a.play, note).toBe(true)
      }
    })
    expect(found.opponent).toBeGreaterThanOrEqual(MIN_FOUND)
    expect(found.partner).toBeGreaterThanOrEqual(MIN_FOUND)
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
