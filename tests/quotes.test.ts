import { describe, expect, it } from 'vitest'
import { apply, createMatch, legalActions, toPublic } from '../src/engine'
import type { BoomkeMark, HandResult, TrickCard } from '../src/engine'
import { activeQuotes, hurryQuote, QUOTES, QUOTE_SEAT_GAP_MS, QuoteBook } from '../src/lib/quotes'
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
    expect(q!.seat).not.toBe(0)
    expect(QUOTES.hurry).toContain(q!.text)
    expect(QUOTES.hurry).toContain('Wast weer audit opt werk vandaag?')
  })

  it('someone wishes luck at the first drawn card, not always the same seat', () => {
    const drawn = (seed: number) => {
      const s = apply(createMatch(seed), { type: 'start', seat: 0 })
      expect(activeQuotes(toPublic(s)).some((q) => q.key === 'b')).toBe(false)
      return activeQuotes(toPublic(apply(s, legalActions(s, 0)[0]))).find((q) => q.key === 'b')!
    }
    const qs = Array.from({ length: 12 }, (_, i) => drawn(i + 1))
    for (const q of qs) expect(q.text).toBe(QUOTES.start[0])
    expect(new Set(qs.map((q) => q.seat)).size).toBeGreaterThan(1)
  })

  it('a round of passes draws a comment at the cut', () => {
    const passed = toPublic(
      playingState({
        phase: 'CUTTING',
        multiplier: 2,
        log: [{ t: 'dealer-pass', seat: 0 }, { t: 'all-pass', n: 2 }],
      }),
    )
    const ap = activeQuotes(passed).find((q) => q.key === 'ap1')
    expect(ap).toBeDefined()
    expect(QUOTES.allPass).toContain(ap!.text)

    // A normal cut after a scored hand: no comment on passes.
    const normal = toPublic(playingState({ phase: 'CUTTING', log: [{ t: 'score', team: 1, n: 1 }] }))
    expect(activeQuotes(normal).some((q) => q.key.startsWith('ap'))).toBe(false)
  })

  it('small talk comes on some cuts, the same for the same state', () => {
    const cuts = Array.from({ length: 40 }, (_, i) =>
      toPublic(playingState({ phase: 'CUTTING', handNumber: i })),
    )
    const chat = cuts.map((pub) => activeQuotes(pub).find((q) => q.key.startsWith('c')))
    const hits = chat.filter((q) => q !== undefined)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.length).toBeLessThan(cuts.length / 2)
    for (const q of hits) expect(QUOTES.chat).toContain(q!.text)
    // Not a fixed rhythm of every 4th cut.
    const at = chat.flatMap((q, i) => (q ? [i] : []))
    expect(new Set(at.map((i) => i % 4)).size).toBeGreaterThan(1)
    // Deterministic: every client and every reload sees the same line.
    expect(cuts.map((pub) => activeQuotes(pub).find((q) => q.key.startsWith('c')))).toEqual(chat)
  })

  it('a scored hand draws a boomke comment, but not at the end of the match', () => {
    const scored = toPublic(
      playingState({ phase: 'SCORED', tricksPlayed: 6, lastResult: RESULT() }),
    )
    const y = activeQuotes(scored).find((q) => q.key === 'y1')
    expect(y).toBeDefined()
    expect(QUOTES.scored).toContain(y!.text)

    const over = toPublic(
      playingState({ phase: 'GAME_OVER', tricksPlayed: 6, lastResult: RESULT(), winner: 1 }),
    )
    expect(activeQuotes(over).some((q) => q.key.startsWith('y'))).toBe(false)
  })

  it('a kapot or a narrow win draws praise', () => {
    const kapot = activeQuotes(
      toPublic(
        playingState({
          phase: 'SCORED',
          tricksPlayed: 6,
          lastResult: RESULT({ kapot: true, points: [0, 40], erased: 2 }),
        }),
      ),
    )
    const won = kapot.find((q) => q.key === 'iw1')
    const lost = kapot.find((q) => q.key === 'il1')
    expect(won!.seat % 2).toBe(1)
    expect(won!.text).toBe(QUOTES.kapotWon[0])
    expect(lost!.seat % 2).toBe(0)
    expect(lost!.text).toBe(QUOTES.kapotLost[0])

    const narrow = activeQuotes(
      toPublic(
        playingState({ phase: 'SCORED', tricksPlayed: 6, lastResult: RESULT({ points: [18, 22] }) }),
      ),
    )
    const iz = narrow.find((q) => q.key === 'iz1')
    expect(iz!.seat % 2).toBe(1)
    expect(iz!.text).toBe(QUOTES.narrowWin[0])

    // A plain win (10-30): no praise.
    const plain = activeQuotes(
      toPublic(playingState({ phase: 'SCORED', tricksPlayed: 6, lastResult: RESULT() })),
    )
    expect(plain.some((q) => q.key.startsWith('i'))).toBe(false)
  })

  it('the partner of a trumped side ace asks if they count trump', () => {
    const pub = toPublic(
      playingState({
        trump: 'H',
        tricksPlayed: 1,
        tricksWon: [0, 1],
        leader: 1,
        lastTrick: [
          { seat: 0, card: C('S', 'A') },
          { seat: 1, card: C('H', '9') },
          { seat: 2, card: C('S', '9') },
          { seat: 3, card: C('S', '10') },
        ],
      }),
    )
    const t = activeQuotes(pub).find((q) => q.key === 't1-1')
    expect(t).toBeDefined()
    expect(t!.seat).toBe(2)
    expect(QUOTES.countTrump).toContain(t!.text)

    // The ace held: nothing to say.
    expect(
      activeQuotes(toPublic(playingState({ leader: 0, tricksPlayed: 1, lastTrick: TRICK }))).some((q) =>
        q.key.startsWith('t'),
      ),
    ).toBe(false)
  })

  it('a player who trumps the partner’s trick hears about it', () => {
    const bought = (last: TrickCard, winner: number) =>
      activeQuotes(
        toPublic(
          playingState({
            trump: 'H',
            tricksPlayed: 1,
            tricksWon: [winner % 2 === 0 ? 1 : 0, winner % 2],
            leader: winner,
            lastTrick: [{ seat: 0, card: C('S', '9') }, { seat: 1, card: C('S', 'K') }, { seat: 2, card: C('S', '10') }, last],
          }),
        ),
      )
    const j = bought({ seat: 3, card: C('H', '9') }, 3).find((q) => q.key === 'j1-1')
    expect(j).toBeDefined()
    expect(j!.seat).toBe(1)
    expect(QUOTES.ownTrick).toContain(j!.text)

    // Seat 3 follows suit and seat 1 keeps the trick: no complaint.
    expect(bought({ seat: 3, card: C('S', 'Q') }, 1).some((q) => q.key.startsWith('j'))).toBe(false)

    // A trump before the last card can keep the trick from the opponent after it.
    const guarded = activeQuotes(
      toPublic(
        playingState({
          trump: 'H',
          tricksPlayed: 1,
          tricksWon: [1, 0],
          leader: 2,
          lastTrick: [{ seat: 0, card: C('S', 'K') }, { seat: 1, card: C('S', '9') }, { seat: 2, card: C('H', '9') }, { seat: 3, card: C('S', '10') }],
        }),
      ),
    )
    expect(guarded.some((q) => q.key.startsWith('j'))).toBe(false)
  })

  it('"We gaan proberen" comes back only when it fired and the bidders won', () => {
    const line = (hand: number) =>
      activeQuotes(toPublic(playingState({ handNumber: hand, bidder: 1 })))[0].text
    const hands = Array.from({ length: 20 }, (_, i) => i + 1)
    const tried = hands.find((h) => line(h) === QUOTES.play[1])!
    const other = hands.find((h) => line(h) !== QUOTES.play[1])!
    const scored = (hand: number, winnerTeam: number) =>
      toPublic(
        playingState({
          phase: 'SCORED',
          handNumber: hand,
          tricksPlayed: 6,
          lastResult: RESULT({ playingTeam: 1, winnerTeam, points: winnerTeam ? [10, 30] : [30, 10] }),
        }),
      )

    const z = activeQuotes(scored(tried, 1), new Set([`p${tried}`])).find((q) => q.key.startsWith('z'))
    expect(z).toBeDefined()
    expect(z!.seat % 2).toBe(0)
    expect(z!.text).toBe(QUOTES.tried[0])
    // Only a candidate, never fired: quiet.
    expect(activeQuotes(scored(tried, 1)).some((q) => q.key.startsWith('z'))).toBe(false)
    // Fired, but the bidders lost.
    expect(activeQuotes(scored(tried, 0), new Set([`p${tried}`])).some((q) => q.key.startsWith('z'))).toBe(false)
    // The bidder said the other line.
    expect(activeQuotes(scored(other, 1), new Set([`p${other}`])).some((q) => q.key.startsWith('z'))).toBe(false)
  })

  it('a loser who played two aces says the cards were good', () => {
    const pub = toPublic(
      playingState({
        phase: 'SCORED',
        tricksPlayed: 6,
        lastResult: RESULT(),
        log: [
          { t: 'card', seat: 2, card: C('H', 'A') },
          { t: 'card', seat: 2, card: C('S', 'A') },
          { t: 'deal', seat: 0 },
          { t: 'card', seat: 0, card: C('H', 'A') },
          { t: 'card', seat: 1, card: C('D', 'A') },
          { t: 'card', seat: 0, card: C('S', 'A') },
          { t: 'card', seat: 2, card: C('C', 'A') },
        ],
      }),
    )
    const g = activeQuotes(pub).filter((q) => q.key.startsWith('3'))
    // Seat 2's earlier aces were in another hand.
    expect(g).toEqual([{ key: '31', seat: 0, text: QUOTES.goodCards[0] }])
  })

  it('at the end of the match the losers congratulate and the winners stay sporting', () => {
    const over = toPublic(
      playingState({
        phase: 'GAME_OVER',
        tricksPlayed: 6,
        tricksWon: [2, 4],
        leader: 1,
        lastTrick: TRICK,
        lastResult: RESULT(),
        winner: 1,
      }),
    )
    const qs = activeQuotes(over)
    // The last hand's lines would share the one roll at the end: left out.
    expect(qs.map((q) => q.key).sort()).toEqual(['ml', 'mw'])
    const congrats = qs.find((q) => q.key === 'ml')
    expect(congrats!.seat % 2).toBe(0)
    expect(QUOTES.matchLost).toContain(congrats!.text)
    const sporting = qs.find((q) => q.key === 'mw')
    expect(sporting!.seat % 2).toBe(1)
    expect(QUOTES.matchWon).toContain(sporting!.text)

    // A scored hand mid-match: no match-end lines.
    const mid = toPublic(
      playingState({ phase: 'SCORED', tricksPlayed: 6, leader: 1, lastTrick: TRICK, lastResult: RESULT() }),
    )
    expect(activeQuotes(mid).some((q) => q.key.startsWith('m'))).toBe(false)
  })
})

describe('quote book', () => {
  // PLAYING just started: the "Ik ga" comment is the only candidate.
  const called = toPublic(playingState({ bidder: 2 }))

  it('a met condition fires only when the roll passes', () => {
    const book = new QuoteBook()
    expect(book.pick(called, 1_000, () => 0.99)).toBeNull()
    const q = book.pick(called, 2_000, () => 0)
    expect(q).not.toBeNull()
    expect(q!.seat).toBe(2)
    expect(QUOTES.play).toContain(q!.text)
    expect(q!.n).toBe(1)
    expect(q!.at).toBe(2_000)
  })

  it('a line is spoken at most once per match, whichever seat would say it', () => {
    const book = new QuoteBook()
    const first = book.pick(
      toPublic(
        playingState({
          trump: 'H',
          tricksPlayed: 1,
          trick: [
            { seat: 0, card: C('S', 'K') },
            { seat: 2, card: C('D', '9') }, // seat 2 cannot follow
          ],
        }),
      ),
      1_000,
      () => 0,
    )
    expect(first!.text).toBe(QUOTES.forgot[0])

    // Same line, would-be speaker is seat 3 this time: still blocked.
    const again = book.pick(
      toPublic(
        playingState({
          trump: 'H',
          tricksPlayed: 1,
          trick: [
            { seat: 0, card: C('S', 'K') },
            { seat: 3, card: C('D', '9') }, // seat 3 cannot follow
          ],
        }),
      ),
      2_000,
      () => 0,
    )
    expect(again).toBeNull()
  })

  it('a seat stays quiet for a minute after speaking', () => {
    const book = new QuoteBook()
    book.pick(called, 1_000, () => 0) // seat 2 speaks

    // Seat 2 leads low right after: too soon for another line.
    const low2 = toPublic(
      playingState({ bidder: 1, trump: 'H', trick: [{ seat: 2, card: C('S', '10') }] }),
    )
    expect(book.pick(low2, 30_000, () => 0)).toBeNull()
    const later = book.pick(low2, 1_000 + QUOTE_SEAT_GAP_MS, () => 0)
    expect(later!.seat).toBe(2)
    expect(later!.text).toBe(QUOTES.herman[0])

    // Another seat was never on cooldown: it may speak whenever.
    const void0 = toPublic(
      playingState({
        trump: 'H',
        tricksPlayed: 1,
        trick: [
          { seat: 1, card: C('H', 'A') },
          { seat: 0, card: C('S', '9') }, // seat 0 is out of trump
        ],
      }),
    )
    expect(book.pick(void0, 5_000, () => 0)!.seat).toBe(0)
  })

  it('remembers the keys that fired, also across a reload', () => {
    const book = new QuoteBook()
    book.pick(called, 1_000, () => 0)
    expect(book.toJSON().fired).toEqual(['p1'])
    expect(QuoteBook.fromJSON(book.toJSON()).toJSON().fired).toEqual(['p1'])
    // A save from an older build has no `fired`.
    expect(QuoteBook.fromJSON({ said: [], spokeAt: [0, 0, 0, 0], n: 3 }).toJSON().fired).toEqual([])
  })

  it('hurry lines may repeat — they never enter the once-per-match list', () => {
    const book = new QuoteBook()
    const a = book.hurry(0, 1_000, () => 0)
    expect(a).not.toBeNull()
    expect(QUOTES.hurry).toContain(a!.text)
    const b = book.hurry(0, 1_000 + QUOTE_SEAT_GAP_MS, () => 0)
    expect(b).not.toBeNull()
    expect(b!.n).toBe(2)
  })

  it('a nag skips bystanders still on cooldown', () => {
    const book = new QuoteBook()
    expect(book.hurry(0, 1_000, () => 0)!.seat).toBe(1)
    expect(book.hurry(0, 31_000, () => 0)!.seat).toBe(2) // seat 1 cooling down
    expect(book.hurry(0, 46_000, () => 0)!.seat).toBe(3) // seats 1+2 cooling down
    // All bystanders spoke within the minute: nobody left to nag.
    expect(book.hurry(0, 50_000, () => 0)).toBeNull()
  })

  it('bookkeeping survives a storage round trip', () => {
    const book = new QuoteBook()
    book.pick(called, 1_000, () => 0)
    const back = QuoteBook.fromJSON(JSON.parse(JSON.stringify(book)))
    // The 'play' line was already said: the same state stays quiet.
    expect(back.pick(called, 2_000, () => 0)).toBeNull()
  })
})
