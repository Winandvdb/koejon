import { describe, expect, it } from 'vitest'
import { apply } from '../src/engine'
import { C, lastTrickState } from './helpers'

// All-9s trick: zero card points, winner = whoever plays the highest led card.
const TRICK = (ledSuit = 'S' as const) => [
  { seat: 1, card: C(ledSuit, '10') },
  { seat: 2, card: C(ledSuit, '9') },
  { seat: 3, card: C(ledSuit, 'J') },
]

function finish(s: ReturnType<typeof lastTrickState>, seat: number, card = C('S', 'K')) {
  return apply(s, { type: 'play', seat, card })
}

describe('scoring', () => {
  it('playing team wins with >20: erases 1 line at level 1, x1', () => {
    // bidder seat 1 -> team 1 plays. Last trick: all 9s/10s, 0 pts.
    // team1 already has 21 pts; trick winner (seat0 plays SK led) is team0 -> [21,19]+0
    const s = lastTrickState({
      bidder: 1,
      points: [19, 21],
      tricksWon: [3, 2],
      trick: TRICK(),
      turn: 0,
      card: C('S', 'K'), // seat0 wins the led suit (K > J)
    })
    const s2 = finish(s, 0)
    expect(s2.phase).toBe('SCORED')
    expect(s2.lastResult!.winnerTeam).toBe(1)
    expect(s2.lastResult!.erased).toBe(1)
    expect(s2.lines).toEqual([13, 12])
    expect(s2.koeien).toEqual([0, 0])
    expect(s2.multiplier).toBe(1) // reset after a played hand
  })

  it('20-20 is a draw: nothing scored, next level-1 stake doubles', () => {
    const s = lastTrickState({
      bidder: 1,
      points: [20, 20],
      tricksWon: [3, 2],
      trick: TRICK(),
      turn: 0,
      card: C('S', 'K'),
    })
    const s2 = finish(s, 0)
    expect(s2.lastResult!.draw).toBe(true)
    expect(s2.lastResult!.erased).toBe(0)
    expect(s2.lines).toEqual([13, 13])
    expect(s2.koeien).toEqual([0, 0])
    expect(s2.multiplier).toBe(2) // carried into the next hand
    const s3 = apply(s2, { type: 'next', seat: 0 })
    expect(s3.phase).toBe('DEALING')
    expect(s3.multiplier).toBe(2)
  })

  it('level 1 multiplier applies: x4 erases 4', () => {
    const s = lastTrickState({
      bidder: 1,
      multiplier: 4,
      points: [10, 30],
      tricksWon: [2, 3],
      trick: TRICK(),
      turn: 0,
      card: C('S', 'K'),
    })
    const s2 = finish(s, 0)
    expect(s2.lastResult!.winnerTeam).toBe(1)
    expect(s2.lastResult!.erased).toBe(4)
    expect(s2.lines).toEqual([13, 9])
  })

  it('level 2 erases 2 and is never multiplied', () => {
    const s = lastTrickState({
      bidder: 1,
      level: 2,
      multiplier: 4,
      points: [10, 30],
      tricksWon: [2, 3],
      trick: TRICK(),
      turn: 0,
      card: C('S', 'K'),
    })
    const s2 = finish(s, 0)
    expect(s2.lastResult!.erased).toBe(2)
    expect(s2.lines).toEqual([13, 11])
  })

  it('kapot by playing team: +1 line on top (level 1 x2 -> 3)', () => {
    const s = lastTrickState({
      bidder: 1,
      multiplier: 2,
      points: [10, 30],
      tricksWon: [0, 5],
      // last trick won by team1: seat0 leads... make trick winner team1.
      trick: [
        { seat: 0, card: C('S', '10') },
        { seat: 1, card: C('S', 'A') },
        { seat: 2, card: C('S', '9') },
      ],
      turn: 3,
      card: C('S', 'Q'),
    })
    const s2 = apply(s, { type: 'play', seat: 3, card: C('S', 'Q') })
    expect(s2.tricksWon).toEqual([0, 6])
    expect(s2.lastResult!.kapot).toBe(true)
    expect(s2.lastResult!.erased).toBe(3) // 1*2 + 1
    expect(s2.lines).toEqual([13, 10])
  })

  it('kapot by defenders: +1, level 2 -> 3 lines, plus Koei on playing team', () => {
    const s = lastTrickState({
      bidder: 1, // team1 playing
      level: 2,
      points: [40, 0],
      tricksWon: [5, 0],
      trick: [
        { seat: 1, card: C('S', '10') },
        { seat: 2, card: C('S', 'A') },
        { seat: 3, card: C('S', '9') },
      ],
      turn: 0,
      card: C('S', 'Q'), // team0 plays; seat2(team0) SA already wins the trick
    })
    const s2 = apply(s, { type: 'play', seat: 0, card: C('S', 'Q') })
    expect(s2.tricksWon).toEqual([6, 0])
    expect(s2.lastResult!.winnerTeam).toBe(0)
    expect(s2.lastResult!.kapot).toBe(true)
    expect(s2.lastResult!.erased).toBe(3) // 2 + 1
    expect(s2.lines).toEqual([10, 14]) // def erase 3; playing +1 koei
    expect(s2.koeien).toEqual([0, 1])
  })

  it('no Koei when the playing team wins', () => {
    const s = lastTrickState({
      bidder: 0,
      points: [30, 10],
      tricksWon: [4, 1],
      trick: TRICK(),
      turn: 0,
      card: C('S', 'K'),
    })
    const s2 = finish(s, 0)
    expect(s2.lastResult!.winnerTeam).toBe(0)
    expect(s2.koeien).toEqual([0, 0])
  })

  it('match ends at 0 lines; next goes to GAME_OVER', () => {
    const s = lastTrickState({
      bidder: 1,
      points: [19, 21],
      tricksWon: [3, 2],
      lines: [5, 1],
      trick: TRICK(),
      turn: 0,
      card: C('S', 'K'),
    })
    const s2 = finish(s, 0)
    expect(s2.lines[1]).toBe(0)
    expect(s2.winner).toBe(1)
    const s3 = apply(s2, { type: 'next', seat: 2 })
    expect(s3.phase).toBe('GAME_OVER')
  })

  it('boomke marks: crossed in one batch per hand, koei appended uncrossed', () => {
    // Defender kapot at level 2: erase 3 in one batch + Koei on playing team.
    const s = lastTrickState({
      bidder: 1,
      level: 2,
      points: [40, 0],
      tricksWon: [5, 0],
      trick: [
        { seat: 1, card: C('S', '10') },
        { seat: 2, card: C('S', 'A') },
        { seat: 3, card: C('S', '9') },
      ],
      turn: 0,
      card: C('S', 'Q'),
    })
    const s2 = apply(s, { type: 'play', seat: 0, card: C('S', 'Q') })
    const crossed = s2.marks.filter((m) => m.team === 0 && m.crossed)
    expect(crossed).toHaveLength(3)
    expect(new Set(crossed.map((m) => m.batch)).size).toBe(1) // one scratch gesture
    const zij = s2.marks.filter((m) => m.team === 1)
    expect(zij.at(-1)).toEqual({ team: 1, t: 'koei', crossed: false, batch: 0 })
    expect(zij).toHaveLength(14) // 13 lines + 1 koei
  })

  it('lines never go below 0', () => {
    const s = lastTrickState({
      bidder: 1,
      level: 2,
      points: [19, 21],
      tricksWon: [0, 5],
      lines: [9, 2],
      trick: [
        { seat: 0, card: C('S', '10') },
        { seat: 1, card: C('S', 'A') },
        { seat: 2, card: C('S', '9') },
      ],
      turn: 3,
      card: C('S', 'Q'),
    })
    const s2 = apply(s, { type: 'play', seat: 3, card: C('S', 'Q') })
    // erased 3 > 2 -> clamped to 0
    expect(s2.lines[1]).toBe(0)
    expect(s2.winner).toBe(1)
  })

  it('erases top ladder lines first and Koeis only after all lines', () => {
    // Team 1: two line marks + one Koei tail.
    const marks = [
      ...Array.from({ length: 13 }, () => ({ team: 0, t: 'line' as const, crossed: false, batch: 0 })),
      ...Array.from({ length: 2 }, () => ({ team: 1, t: 'line' as const, crossed: false, batch: 0 })),
      { team: 1, t: 'koei' as const, crossed: false, batch: 0 },
    ]
    const s = {
      ...lastTrickState({
        bidder: 1,
        points: [19, 21],
        tricksWon: [3, 2],
        lines: [13, 3],
        trick: TRICK(),
        turn: 0,
        card: C('S', 'K'),
      }),
      marks,
    }
    const s2 = finish(s, 0)
    // team1 erases 1 (level 1): the top line is crossed, the Koei stays.
    const t1 = s2.marks.filter((m) => m.team === 1)
    expect(t1[1].crossed).toBe(true) // last line mark = top of the ladder
    expect(t1[0].crossed).toBe(false)
    expect(t1.find((m) => m.t === 'koei')!.crossed).toBe(false)
  })

})
