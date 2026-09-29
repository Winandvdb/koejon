import { describe, expect, it } from 'vitest'
import { apply, createMatch, legalActions } from '../src/engine'
import type { State } from '../src/engine'

function started(seed: number): State {
  return apply(createMatch(seed), { type: 'start', seat: 0 })
}

describe('dealer draw', () => {
  it('team A draws first, then team B; packet A is in [4,16]', () => {
    const s = started(42)
    expect(s.dealerDraw!.pending).toBe(0)
    expect(legalActions(s, 0).some((a) => a.type === 'draw')).toBe(true)
    expect(legalActions(s, 1)).toHaveLength(0)

    const s2 = apply(s, { type: 'draw', seat: 0 })
    expect(s2.dealerDraw!.pending).toBe(1)
    expect(s2.dealerDraw!.packetA).toBeGreaterThanOrEqual(4)
    expect(s2.dealerDraw!.packetA).toBeLessThanOrEqual(16)
    expect(s2.dealerDraw!.draws).toHaveLength(1)
    expect(legalActions(s2, 1).some((a) => a.type === 'draw')).toBe(true)
  })

  it('winner picks any seat as first dealer', () => {
    let s = started(42)
    let guard = 100
    while (s.dealerDraw && s.dealerDraw.pending !== 2 && guard-- > 0) {
      s = apply(s, { type: 'draw', seat: s.dealerDraw.drawer[s.dealerDraw.pending] })
    }
    const winner = s.dealerDraw!.winnerSeat!
    expect(legalActions(s, winner).filter((a) => a.type === 'chooseDealer')).toHaveLength(4)
    // the loser cannot pick
    const loser = winner === s.dealerDraw!.draws[0].seat ? s.dealerDraw!.draws[1].seat : s.dealerDraw!.draws[0].seat
    expect(() => apply(s, { type: 'chooseDealer', seat: loser, dealer: 0 })).toThrow()
    s = apply(s, { type: 'chooseDealer', seat: winner, dealer: 3 })
    expect(s.phase).toBe('BIDDING_R1')
    expect(s.dealer).toBe(3)
    expect(s.dealerDraw).toBeNull()
  })

  it('a tie forces both players to redraw', () => {
    // Find a seed where the first attempt ties.
    let s: State | null = null
    for (let seed = 0; seed < 200; seed++) {
      let t = started(seed)
      t = apply(t, { type: 'draw', seat: 0 })
      t = apply(t, { type: 'draw', seat: 1 })
      if (t.dealerDraw!.pending === 0) {
        s = t
        break
      }
    }
    expect(s).not.toBeNull()
    expect(s!.dealerDraw!.draws).toHaveLength(0)
    expect(s!.dealerDraw!.packetA).toBeNull()
    // team A draws again
    expect(legalActions(s!, 0).some((a) => a.type === 'draw')).toBe(true)
  })

  it('drawn cards are always distinct deck positions', () => {
    for (let seed = 0; seed < 30; seed++) {
      let s = started(seed)
      let guard = 100
      while (s.dealerDraw && s.dealerDraw.pending !== 2 && guard-- > 0) {
        s = apply(s, { type: 'draw', seat: s.dealerDraw.drawer[s.dealerDraw.pending] })
      }
      const [a, b] = s.dealerDraw!.draws
      expect(a.card.s === b.card.s && a.card.r === b.card.r).toBe(false)
    }
  })
})
