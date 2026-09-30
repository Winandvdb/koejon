import { describe, expect, it } from 'vitest'
import { toPublic } from '../src/engine'
import type { BoomkeMark, HandResult, TrickCard } from '../src/engine'
import { activeQuotes, QUOTES } from '../src/lib/quotes'
import { C, playingState } from './helpers'

const TRICK: TrickCard[] = [
  { seat: 0, card: C('H', 'A') },
  { seat: 1, card: C('H', '9') },
  { seat: 2, card: C('H', '10') },
  { seat: 3, card: C('H', 'J') },
]

const RESULT = (over: Partial<HandResult> = {}): HandResult => ({
  playingTeam: 1,
  points: [10, 30],
  winnerTeam: 1,
  draw: false,
  erased: 1,
  kapot: false,
  koei: false,
  level: 1,
  multiplier: 1,
  ...over,
})

const CROSSED = (team: number, batch: number): BoomkeMark => ({
  team,
  t: 'line',
  crossed: true,
  batch,
})

describe('table quotes', () => {
  it('the caller speaks after "Ik ga", until the first card falls', () => {
    const pub = toPublic(playingState({ bidder: 2 }))
    const qs = activeQuotes(pub)
    expect(qs).toHaveLength(1)
    expect(qs[0].seat).toBe(2)
    expect(QUOTES.play).toContain(qs[0].text)

    const mid = toPublic(
      playingState({ bidder: 2, trick: [{ seat: 1, card: C('S', 'K') }] }),
    )
    expect(activeQuotes(mid)).toHaveLength(0)
  })

  it('kapot run broken: first trick against >= 2 opponent tricks', () => {
    const pub = toPublic(
      playingState({
        tricksPlayed: 3,
        tricksWon: [1, 2],
        leader: 0,
        lastTrick: TRICK,
      }),
    )
    const qs = activeQuotes(pub)
    expect(qs).toHaveLength(1)
    expect(qs[0].seat % 2).toBe(0) // a winner-team seat
    expect(QUOTES.gouwe).toContain(qs[0].text)
  })

  it('no gouwe when the opponents hold only one trick', () => {
    const pub = toPublic(
      playingState({
        tricksPlayed: 2,
        tricksWon: [1, 1],
        leader: 0,
        lastTrick: TRICK,
      }),
    )
    expect(activeQuotes(pub)).toHaveLength(0)
  })

  it('a lost hand calls for a redeal; a draw stays quiet', () => {
    const scored = toPublic(
      playingState({
        phase: 'SCORED',
        tricksPlayed: 6,
        tricksWon: [2, 4],
        leader: 1,
        lastTrick: TRICK,
        lastResult: RESULT(),
      }),
    )
    const qs = activeQuotes(scored)
    const lost = qs.find((q) => q.key.startsWith('l'))
    expect(lost).toBeDefined()
    expect(lost!.seat % 2).toBe(0) // team 0 lost to winnerTeam 1
    expect(QUOTES.lost).toContain(lost!.text)

    const draw = toPublic(
      playingState({
        phase: 'SCORED',
        tricksPlayed: 6,
        tricksWon: [3, 3],
        leader: 1,
        lastTrick: TRICK,
        lastResult: RESULT({ draw: true, erased: 0 }),
      }),
    )
    expect(activeQuotes(draw)).toHaveLength(0)
  })

  it('winning right after a loss draws a revenge line', () => {
    const scored = toPublic(
      playingState({
        phase: 'SCORED',
        handNumber: 5,
        tricksPlayed: 6,
        tricksWon: [4, 2],
        leader: 1,
        lastTrick: TRICK,
        lastResult: RESULT({ winnerTeam: 1, points: [8, 32] }),
        marks: [CROSSED(0, 4), CROSSED(0, 2)],
      }),
    )
    const qs = activeQuotes(scored)
    const revenge = qs.find((q) => q.key.startsWith('r'))
    expect(revenge).toBeDefined()
    expect(revenge!.seat % 2).toBe(1) // team 1 won now, lost hand 4
    expect(QUOTES.revenge).toContain(revenge!.text)

    // Same win, but hand 4 was a draw (no marks crossed): no revenge.
    const noPrev = toPublic(
      playingState({
        phase: 'SCORED',
        handNumber: 5,
        tricksPlayed: 6,
        tricksWon: [4, 2],
        leader: 1,
        lastTrick: TRICK,
        lastResult: RESULT({ winnerTeam: 1, points: [8, 32] }),
        marks: [CROSSED(0, 2)],
      }),
    )
    expect(activeQuotes(noPrev).some((q) => q.key.startsWith('r'))).toBe(false)
  })

  it('an ace opening draws a comment', () => {
    const pub = toPublic(
      playingState({ bidder: 1, trick: [{ seat: 0, card: C('S', 'A') }] }),
    )
    const qs = activeQuotes(pub)
    expect(qs).toHaveLength(1)
    expect(qs[0].key).toBe('a1')
    expect(qs[0].seat).not.toBe(0) // someone other than the leader
    expect(QUOTES.ace).toContain(qs[0].text)
  })

  it('a defender opening with trump gets "laat ze maar is zien"', () => {
    const pub = toPublic(
      playingState({ bidder: 1, trump: 'H', trick: [{ seat: 0, card: C('H', 'J') }] }),
    )
    const qs = activeQuotes(pub)
    expect(qs).toHaveLength(1)
    expect(qs[0].key).toBe('d1')
    expect(qs[0].seat % 2).toBe(1) // a playing-team seat speaks
    expect(QUOTES.showEm).toContain(qs[0].text)

    // The bidder's partner opening trump is unremarkable.
    const partner = toPublic(
      playingState({ bidder: 1, trump: 'H', trick: [{ seat: 3, card: C('H', 'J') }] }),
    )
    expect(activeQuotes(partner).some((q) => q.key.startsWith('d'))).toBe(false)
  })

  it('a low opening card announces a Hermanneke', () => {
    const pub = toPublic(
      playingState({ bidder: 1, trump: 'H', trick: [{ seat: 0, card: C('S', '10') }] }),
    )
    const qs = activeQuotes(pub)
    expect(qs).toHaveLength(1)
    expect(qs[0].key).toBe('h1')
    expect(qs[0].seat).toBe(0) // the leader owns it
    expect(QUOTES.herman).toContain(qs[0].text)
  })

  it('a proven trump void admits to having none all evening', () => {
    const pub = toPublic(
      playingState({
        trump: 'H',
        tricksPlayed: 1,
        trick: [
          { seat: 0, card: C('H', 'A') },
          { seat: 2, card: C('S', '9') },
        ],
      }),
    )
    const qs = activeQuotes(pub)
    expect(qs).toHaveLength(1)
    expect(qs[0].seat).toBe(2) // the void seat itself
    expect(QUOTES.noTrump).toContain(qs[0].text)

    // Everyone follows trump: nobody is shown void.
    const followed = toPublic(
      playingState({
        trump: 'H',
        tricksPlayed: 1,
        trick: [
          { seat: 0, card: C('H', 'A') },
          { seat: 1, card: C('H', '9') },
          { seat: 2, card: C('H', '10') },
        ],
      }),
    )
    expect(activeQuotes(followed)).toHaveLength(0)
  })

  it('two trump leads in a row by the same seat is "gemakkelijk"', () => {
    const pub = toPublic(
      playingState({
        trump: 'H',
        tricksPlayed: 2,
        tricksWon: [2, 0],
        leader: 0,
        prevTrick: TRICK,
        lastTrick: [
          { seat: 0, card: C('H', 'K') },
          { seat: 1, card: C('H', '10') },
          { seat: 2, card: C('S', '9') },
          { seat: 3, card: C('D', '9') },
        ],
      }),
    )
    const qs = activeQuotes(pub)
    const easy = qs.find((q) => q.key.startsWith('e'))
    expect(easy).toBeDefined()
    expect(easy!.seat % 2).toBe(0)
    expect(QUOTES.easy).toContain(easy!.text)

    // Led by different seats: no pull twice.
    const split = toPublic(
      playingState({
        trump: 'H',
        tricksPlayed: 2,
        tricksWon: [2, 0],
        leader: 0,
        prevTrick: [
          { seat: 2, card: C('H', 'Q') },
          { seat: 3, card: C('H', '9') },
          { seat: 0, card: C('H', 'A') },
          { seat: 1, card: C('H', '10') },
        ],
        lastTrick: TRICK,
      }),
    )
    expect(activeQuotes(split).some((q) => q.key.startsWith('e'))).toBe(false)
  })
})
