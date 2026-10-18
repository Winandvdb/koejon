import { describe, expect, it } from 'vitest'
import { partnerOf, RANK_ORDER, RANK_POINTS } from '../src/engine'
import { HEURISTIC_DEFAULTS, levelOptions } from '../src/bots/heuristic'
import { LEVELS, MIN_FOUND, scanMatches, SEEDS } from './helpers'

describe('bot seed scans: bids', () => {
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
})
