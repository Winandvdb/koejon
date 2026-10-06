import { describe, expect, it } from 'vitest'
import { apply, createMatch, legalActions, toPublic } from '../src/engine'
import type { State } from '../src/engine'

function started(seed: number): State {
  return apply(createMatch(seed), { type: 'start', seat: 0 })
}

const sizes = (s: State, seat: number) =>
  legalActions(s, seat).flatMap((a) => (a.type === 'draw' ? [a.n] : []))
const range = (lo: number, hi: number) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)

/** First seed whose deck lets team A (4 cards) and team B tie on rank. */
function tieSetup(): { s: State; nB: number } {
  for (let seed = 0; seed < 200; seed++) {
    const s = started(seed)
    const deck = s.dealerDraw!.deck!
    const nB = range(4, 16).find((n) => deck[4 + n - 1].r === deck[3].r)
    if (nB) return { s, nB }
  }
  throw new Error('no tie seed')
}

describe('dealer draw', () => {
  it('team A lifts 4 to 16 cards (at least 8 stay), team B waits', () => {
    const s = started(42)
    expect(s.dealerDraw!.pending).toBe(0)
    expect(sizes(s, 0)).toEqual(range(4, 16))
    expect(legalActions(s, 1)).toHaveLength(0)
    expect(() => apply(s, { type: 'draw', seat: 0, n: 3 })).toThrow()
    expect(() => apply(s, { type: 'draw', seat: 0, n: 17 })).toThrow()
  })

  it('shows the bottom card of team A packet', () => {
    const s = started(42)
    const deck = s.dealerDraw!.deck!
    const s2 = apply(s, { type: 'draw', seat: 0, n: 9 })
    expect(s2.dealerDraw!.packetA).toBe(9)
    expect(s2.dealerDraw!.draws).toEqual([{ seat: 0, card: deck[8] }])
    expect(s2.log.at(-1)).toMatchObject({ t: 'draw', seat: 0, n: 9 })
  })

  it('team B lifts from what team A left, 4 lifted and 4 left', () => {
    for (const nA of [4, 10, 16]) {
      const s = apply(started(42), { type: 'draw', seat: 0, n: nA })
      expect(s.dealerDraw!.pending).toBe(1)
      expect(sizes(s, 1)).toEqual(range(4, 24 - nA - 4))
      expect(() => apply(s, { type: 'draw', seat: 1, n: 24 - nA - 3 })).toThrow()
      expect(() => apply(s, { type: 'draw', seat: 1, n: 3 })).toThrow()
    }
  })

  it('both teams lift from the same deck: no reshuffle between the draws', () => {
    for (let seed = 0; seed < 30; seed++) {
      const s = started(seed)
      const deck = s.dealerDraw!.deck!
      const s2 = apply(s, { type: 'draw', seat: 0, n: 7 })
      expect(s2.dealerDraw!.deck).toEqual(deck)
      const s3 = apply(s2, { type: 'draw', seat: 1, n: 5 })
      // Read the cards from the log: a tie already cleared the draws.
      const drawn = s3.log.filter((e) => e.t === 'draw').map((e) => e.card)
      expect(drawn).toEqual([deck[6], deck[7 + 5 - 1]])
    }
  })

  it('a tie starts again with a newly shuffled deck', () => {
    const { s, nB } = tieSetup()
    const deck = s.dealerDraw!.deck!
    let t = apply(s, { type: 'draw', seat: 0, n: 4 })
    t = apply(t, { type: 'draw', seat: 1, n: nB })
    const dd = t.dealerDraw!
    expect(dd.pending).toBe(0)
    expect(dd.draws).toHaveLength(0)
    expect(dd.packetA).toBeNull()
    expect(t.log.at(-1)!.t).toBe('draw-tie')
    expect(dd.deck).not.toEqual(deck)
    expect(new Set(dd.deck!.map((c) => c.s + c.r)).size).toBe(24)
    expect(sizes(t, 0)).toEqual(range(4, 16))
  })

  it('winner picks any seat as first dealer, then the cut follows', () => {
    let s = started(42)
    let guard = 100
    while (s.dealerDraw && s.dealerDraw.pending !== 2 && guard-- > 0) {
      s = apply(s, { type: 'draw', seat: s.dealerDraw.drawer[s.dealerDraw.pending], n: 8 })
    }
    const winner = s.dealerDraw!.winnerSeat!
    expect(legalActions(s, winner).filter((a) => a.type === 'chooseDealer')).toHaveLength(4)
    // the loser cannot pick
    const loser = winner === s.dealerDraw!.draws[0].seat ? s.dealerDraw!.draws[1].seat : s.dealerDraw!.draws[0].seat
    expect(() => apply(s, { type: 'chooseDealer', seat: loser, dealer: 0 })).toThrow()
    s = apply(s, { type: 'chooseDealer', seat: winner, dealer: 3 })
    expect(s.phase).toBe('CUTTING')
    expect(s.dealer).toBe(3)
    expect(s.dealerDraw).toBeNull()
  })

  it('keeps the draw deck on the host', () => {
    const s = apply(started(42), { type: 'draw', seat: 0, n: 5 })
    const pub = toPublic(s)
    expect(pub.dealerDraw).not.toHaveProperty('deck')
    expect(pub.dealerDraw!.packetA).toBe(5)
    expect(pub.dealerDraw!.draws).toEqual(s.dealerDraw!.draws)
  })
})
