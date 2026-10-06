import { describe, expect, it } from 'vitest'
import { toPublic } from '../src/engine'
import type { BoomkeMark, HandResult, TrickCard } from '../src/engine'
import { activeQuotes, hurryQuote, QUOTES } from '../src/lib/quotes'
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
    const g = activeQuotes(pub).find((q) => q.key.startsWith('g'))
    expect(g).toBeDefined()
    expect(g!.seat % 2).toBe(0) // a winner-team seat
    expect(QUOTES.gouwe).toContain(g!.text)
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
    expect(activeQuotes(pub).some((q) => q.key.startsWith('g'))).toBe(false)
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
    const dqs = activeQuotes(draw)
    expect(dqs.some((q) => q.key.startsWith('l'))).toBe(false)
    expect(dqs.some((q) => q.key.startsWith('r'))).toBe(false)
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

  it('a proven void in the led suit asks "wat was ook alweer troef?"', () => {
    const pub = toPublic(
      playingState({
        trump: 'H',
        tricksPlayed: 1,
        trick: [
          { seat: 0, card: C('S', 'K') },
          { seat: 2, card: C('D', '9') }, // cannot follow spades, no trump played
        ],
      }),
    )
    const qs = activeQuotes(pub)
    expect(qs).toHaveLength(1)
    expect(qs[0].seat).toBe(2)
    expect(QUOTES.forgot).toContain(qs[0].text)
  })

  it('overtrumping the trump that took the partner ace apologises', () => {
    // Partner seat 0 leads S-A, opponent seat 1 buys with H-9, seat 2 overbuys H-Q.
    const open = toPublic(
      playingState({
        trump: 'H',
        tricksPlayed: 0,
        trick: [
          { seat: 0, card: C('S', 'A') },
          { seat: 1, card: C('H', '9') },
          { seat: 2, card: C('H', 'Q') },
        ],
      }),
    )
    const o = activeQuotes(open).find((q) => q.key.startsWith('o'))
    expect(o).toBeDefined()
    expect(o!.seat).toBe(2)
    expect(QUOTES.notAce).toContain(o!.text)

    // Same catch on the lingering finished trick (position-4 resolves instantly).
    const linger = toPublic(
      playingState({
        trump: 'H',
        tricksPlayed: 1,
        tricksWon: [1, 0],
        leader: 2,
        lastTrick: [
          { seat: 0, card: C('S', 'A') },
          { seat: 1, card: C('H', '9') },
          { seat: 3, card: C('D', '9') },
          { seat: 2, card: C('H', 'Q') },
        ],
      }),
    )
    expect(activeQuotes(linger).some((q) => q.key.startsWith('o'))).toBe(true)

    // No partner ace in the trick: no apology.
    const noAce = toPublic(
      playingState({
        trump: 'H',
        tricksPlayed: 0,
        trick: [
          { seat: 0, card: C('S', 'K') },
          { seat: 1, card: C('H', '9') },
          { seat: 2, card: C('H', 'Q') },
        ],
      }),
    )
    expect(activeQuotes(noAce).some((q) => q.key.startsWith('o'))).toBe(false)
  })

  it('a fat trick (over 10 points) is a goeie slag', () => {
    const fat = [
      { seat: 0, card: C('S', 'A') },
      { seat: 1, card: C('S', 'K') },
      { seat: 2, card: C('D', 'A') },
      { seat: 3, card: C('S', 'Q') },
    ] // 4 + 3 + 4 + 2 = 13 points
    const pub = toPublic(
      playingState({
        trump: 'H',
        tricksPlayed: 3,
        tricksWon: [2, 1],
        leader: 0,
        lastTrick: fat,
      }),
    )
    const s = activeQuotes(pub).find((q) => q.key.startsWith('s'))
    expect(s).toBeDefined()
    expect(s!.seat % 2).toBe(0)
    expect(QUOTES.goodTrick).toContain(s!.text)

    // A cheap trick stays quiet.
    const lean = toPublic(
      playingState({
        trump: 'H',
        tricksPlayed: 3,
        tricksWon: [2, 1],
        leader: 0,
        lastTrick: TRICK, // 5 points
      }),
    )
    expect(activeQuotes(lean).some((q) => q.key.startsWith('s'))).toBe(false)
  })

  it('the defenders celebrate their first trick: not kapot anymore', () => {
    const pub = toPublic(
      playingState({
        trump: 'H',
        bidder: 0, // team 0 is playing
        tricksPlayed: 3,
        tricksWon: [2, 1],
        leader: 1, // team 1 just won its first trick
        lastTrick: TRICK,
      }),
    )
    const qs = activeQuotes(pub)
    const k = qs.find((q) => q.key.startsWith('k'))
    expect(k).toBeDefined()
    expect(k!.seat % 2).toBe(1) // a defending seat
    expect(QUOTES.noKapot).toContain(k!.text)

    // The playing team winning tricks does not trigger it.
    const playing = toPublic(
      playingState({
        trump: 'H',
        bidder: 0,
        tricksPlayed: 3,
        tricksWon: [1, 2],
        leader: 0, // team 0 = playing team
        lastTrick: TRICK,
      }),
    )
    expect(activeQuotes(playing).some((q) => q.key.startsWith('k'))).toBe(false)
  })

  it('reaching 21 points mid-hand gets a "we zijn er al se"', () => {
    const pub = toPublic(
      playingState({
        trump: 'H',
        tricksPlayed: 4,
        tricksWon: [2, 2],
        leader: 0,
        points: [21, 8],
        lastTrick: TRICK,
      }),
    )
    const q = activeQuotes(pub).find((x) => x.key === '2p1-0')
    expect(q).toBeDefined()
    expect(q!.seat % 2).toBe(0)
    expect(QUOTES.there).toContain(q!.text)

    // 20 points is not enough anymore.
    const short = toPublic(
      playingState({
        trump: 'H',
        tricksPlayed: 4,
        tricksWon: [2, 2],
        leader: 0,
        points: [20, 8],
        lastTrick: TRICK,
      }),
    )
    expect(activeQuotes(short).some((x) => x.key === '2p1-0')).toBe(false)
  })

  it('leading again the suit that just won the trick is worth another try', () => {
    // Seat 0 took the previous trick with a spade and leads spades again.
    const wonSpades: TrickCard[] = [
      { seat: 0, card: C('S', 'A') },
      { seat: 1, card: C('S', '9') },
      { seat: 2, card: C('S', '10') },
      { seat: 3, card: C('S', 'J') },
    ]
    const pub = toPublic(
      playingState({
        trump: 'H',
        tricksPlayed: 1,
        tricksWon: [1, 0],
        leader: 0,
        trick: [{ seat: 0, card: C('S', 'K') }],
        lastTrick: wonSpades,
      }),
    )
    const n = activeQuotes(pub).find((q) => q.key.startsWith('n'))
    expect(n).toBeDefined()
    expect(n!.seat).toBe(0)
    expect(QUOTES.again).toContain(n!.text)

    // A different suit is a different plan: quiet.
    const other = toPublic(
      playingState({
        trump: 'H',
        tricksPlayed: 1,
        tricksWon: [1, 0],
        leader: 0,
        trick: [{ seat: 0, card: C('D', 'K') }],
        lastTrick: wonSpades,
      }),
    )
    expect(activeQuotes(other).some((q) => q.key.startsWith('n'))).toBe(false)
  })

  it('a lost trick draws a grumble from the losing team', () => {
    const pub = toPublic(
      playingState({
        trump: 'H',
        tricksPlayed: 3,
        tricksWon: [2, 1],
        leader: 0, // team 0 took the trick
        lastTrick: TRICK,
      }),
    )
    const x = activeQuotes(pub).find((q) => q.key.startsWith('x'))
    expect(x).toBeDefined()
    expect(x!.seat % 2).toBe(1) // a losing-team seat speaks
    expect(QUOTES.trickLost).toContain(x!.text)
  })

  it('reaching 21 points only on the last trick gets a cheer', () => {
    // Team 0 had 19 before the last 5-point trick: it makes 21+ on it.
    const pub = toPublic(
      playingState({
        phase: 'SCORED',
        trump: 'H',
        tricksPlayed: 6,
        tricksWon: [3, 3],
        leader: 0,
        points: [24, 16],
        lastTrick: TRICK,
        lastResult: RESULT({ winnerTeam: 0, playingTeam: 1, points: [24, 16] }),
      }),
    )
    const u = activeQuotes(pub).find((q) => q.key.startsWith('u'))
    expect(u).toBeDefined()
    expect(u!.seat % 2).toBe(0)
    expect(QUOTES.madeIt).toContain(u!.text)

    // Already past 20 before the last trick: the cheer is stale.
    const early = toPublic(
      playingState({
        phase: 'SCORED',
        trump: 'H',
        tricksPlayed: 6,
        tricksWon: [3, 3],
        leader: 0,
        points: [26, 14],
        lastTrick: TRICK,
        lastResult: RESULT({ winnerTeam: 0, playingTeam: 1, points: [26, 14] }),
      }),
    )
    expect(activeQuotes(early).some((q) => q.key.startsWith('u'))).toBe(false)

    // 21 mid-hand is too early for "still ours".
    const mid = toPublic(
      playingState({
        trump: 'H',
        tricksPlayed: 5,
        tricksWon: [3, 2],
        leader: 0,
        points: [21, 10],
        lastTrick: TRICK,
      }),
    )
    expect(activeQuotes(mid).some((q) => q.key.startsWith('u'))).toBe(false)
  })

  it('a team without a single crossed mark asks when the cards will turn', () => {
    const pub = toPublic(
      playingState({
        phase: 'SCORED',
        tricksPlayed: 6,
        tricksWon: [2, 4],
        leader: 1,
        lastTrick: TRICK,
        lastResult: RESULT(),
        marks: [CROSSED(0, 1)],
      }),
    )
    const qs = activeQuotes(pub)
    const w = qs.find((q) => q.key === 'w1-1')
    expect(w).toBeDefined()
    expect(w!.seat % 2).toBe(1)
    expect(QUOTES.noMarks).toContain(w!.text)
    // Team 0 already crossed a mark: it stays quiet.
    expect(qs.some((q) => q.key === 'w1-0')).toBe(false)
  })

  it('hurryQuote picks a bystander and a nag line', () => {
    const q = hurryQuote(0)
    expect(q.seat).not.toBe(0)
    expect(QUOTES.hurry).toContain(q.text)
  })
})
