import { describe, expect, it } from 'vitest'
import { legalActions, partnerOf, RANK_ORDER, RANKS, trickWinnerIndex } from '../src/engine'
import type { Card } from '../src/engine'
import { troefkeIgnored, troefkeWeight } from '../src/bots/conventions'
import { BOT_PROFILES, readHand } from '../src/bots/heuristic'
import { observe } from '../src/bots/observation'
import { LEVELS, lowest, MIN_FOUND, oppMayTrump, playedThisHand, scanMatches, SEEDS } from './helpers'

describe('bot seed scans: leads', () => {
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

  // Hard only: the other levels do not remember which side aces fell.
  it('hard: no sweep lead of a king while its ace is out and another card may go (#194)', () => {
    let found = 0
    scanMatches('hard', SEEDS, (s, a, notes) => {
      if (a.type !== 'play' || notes.includes('lazy dump') || s.trick.length > 0 || s.tricksPlayed === 0) return
      if (!notes.at(-1)?.startsWith('sweep: highest card')) return
      const trump = s.trump!
      const hand = s.hands[a.seat]
      const played = playedThisHand(s).map((p) => p.card)
      const aceOut = (suit: string) => !played.concat(hand).some((c) => c.s === suit && c.r === 'A')
      const feedsAce = (c: Card) => c.s !== trump && c.r === 'K' && aceOut(c.s)
      const legal = legalActions(s, a.seat).flatMap((x) => (x.type === 'play' ? [x.card] : []))
      // Another plain card that is no ace and feeds no ace may go instead.
      if (!legal.some(feedsAce) || !legal.some((c) => c.s !== trump && c.r !== 'A' && !feedsAce(c))) return
      found++
      expect(feedsAce(a.card), `lead ${a.card.r}${a.card.s} (${notes.join('; ')}), seed scan at hard`).toBe(false)
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
})
