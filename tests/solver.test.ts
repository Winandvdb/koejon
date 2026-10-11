import { describe, expect, it } from 'vitest'
import { apply, fullDeck, legalActions, SUITS, teamOf } from '../src/engine'
import type { Card, State } from '../src/engine'
import { solve } from '../src/bots/solver'
import { handValue } from '../src/bots/value'
import { seededRandom } from '../src/lib/seed'
import { biddingState, C, lastTrickState, playingState } from './helpers'

/** All four seats confirm the trick that just fell: the next lead is legal. */
function settle(s: State): State {
  while (s.phase === 'PLAYING' && s.trickAcks.length < 4) {
    s = apply(s, { type: 'ack', seat: [0, 1, 2, 3].find((x) => !s.trickAcks.includes(x))! })
  }
  return s
}

/** Plain minimax on the engine itself: no pruning, no cache, no tricks. */
function minimax(s: State, team: number, before: [number, number]): number {
  s = settle(s)
  if (s.phase !== 'PLAYING') return handValue({ lines: before }, { lines: s.lines }, team)
  const seat = s.turn
  const values = legalActions(s, seat)
    .filter((a) => a.type === 'play')
    .map((a) => minimax(apply(s, a), team, before))
  return teamOf(seat) === team ? Math.max(...values) : Math.min(...values)
}

/** The solver's value of each card the seat to move may play, in legal order. */
const values = (s: State): number[] => solve(s, s.turn).map((v) => v.value)

describe('solver, last trick', () => {
  const trick = [
    { seat: 1, card: C('S', 'K') },
    { seat: 2, card: C('S', '9') },
    { seat: 3, card: C('S', 'J') },
  ]

  it('values a won hand: the bidder crosses its stake', () => {
    // Seat 0 takes 8 points with the ace; seat 1 (the bidder) ends on 22.
    const s = lastTrickState({ trick, turn: 0, card: C('S', 'A'), points: [10, 22] })
    expect(values(s)).toEqual([-1])
    expect(solve(s, 1, [{ type: 'ack', seat: 1 }]).map((v) => v.value)).toEqual([1])
  })

  it('values a lost hand: the defenders cross the stake and the bidder gets a koei', () => {
    const s = lastTrickState({ trick, turn: 0, card: C('S', 'A'), points: [10, 14] })
    // Team 1 ends on 14: team 0 crosses 1 line, team 1 takes a koei line.
    expect(values(s)).toEqual([1 + 1])
  })

  it('values 20-20 as a draw', () => {
    const s = lastTrickState({ trick, turn: 0, card: C('S', 'A'), points: [12, 20] })
    expect(values(s)).toEqual([0])
  })

  it('counts the multiplier of a level-1 stake, and level 2 as 2', () => {
    const won = { trick, turn: 0, card: C('S', 'A'), points: [10, 22] as [number, number] }
    expect(values(lastTrickState({ ...won, multiplier: 2 }))).toEqual([-2])
    expect(values(lastTrickState({ ...won, multiplier: 2, level: 2 }))).toEqual([-2])
    expect(values(lastTrickState({ ...won, multiplier: 1, level: 2 }))).toEqual([-2])
  })

  it('adds a line for a kapot', () => {
    // The bidder's team won the first 5 tricks, seat 0 takes the 6th: no kapot.
    const kapot = lastTrickState({ trick, turn: 0, card: C('S', 'A'), tricksWon: [0, 5], points: [0, 32] })
    expect(values(kapot)).toEqual([-1])
    // The bidder's team also takes the 6th: kapot, one more line.
    const sweep = lastTrickState({
      trick: [
        { seat: 1, card: C('S', 'A') },
        { seat: 2, card: C('S', '9') },
        { seat: 3, card: C('S', 'J') },
      ],
      turn: 0,
      card: C('S', '10'),
      tricksWon: [0, 5],
      points: [0, 32],
    })
    expect(values(sweep)).toEqual([-2])
  })

  it('crosses no more lines than a team has', () => {
    // Team 1 wins a stake of 2 but has only 1 line left to cross.
    const won = lastTrickState({ trick, turn: 0, card: C('S', 'A'), points: [10, 22], lines: [13, 1], multiplier: 2 })
    expect(values(won)).toEqual([-1])
    // Team 0 wins a stake of 2 with 1 line left; the bidder still gets its koei.
    const lost = lastTrickState({ trick, turn: 0, card: C('S', 'A'), points: [10, 14], lines: [1, 13], multiplier: 2 })
    expect(values(lost)).toEqual([1 + 1])
  })
})

describe('solver, hand-made endgames', () => {
  it('knows that the top trumps take every trick, and kapot with them', () => {
    // Seat 0 holds the three best trumps, nobody else has one.
    const hands: Card[][] = [
      [C('H', 'A'), C('H', 'K'), C('H', 'Q')],
      [C('S', '9'), C('S', '10'), C('C', '9')],
      [C('D', '9'), C('D', '10'), C('C', '10')],
      [C('S', 'J'), C('D', 'J'), C('C', 'J')],
    ]
    const s = playingState({
      hands,
      trump: 'H',
      bidder: 0,
      turn: 0,
      leader: 0,
      tricksPlayed: 3,
      tricksWon: [3, 0],
      points: [12, 0],
    })
    // Every lead takes the trick; 6 tricks to the bidder's team: 1 line + 1 for the kapot.
    expect(values(s)).toEqual([2, 2, 2])
    // Seen from the opponents: the same hand, and the same value negated.
    expect(solve(s, 1, [{ type: 'ack', seat: 1 }]).map((v) => v.value)).toEqual([-2])
  })

  it('gives the kapot to the team that holds the top trumps even when it defends', () => {
    const hands: Card[][] = [
      [C('S', '9'), C('S', '10'), C('C', '9')],
      [C('H', 'A'), C('H', 'K'), C('H', 'Q')],
      [C('D', '9'), C('D', '10'), C('C', '10')],
      [C('S', 'J'), C('D', 'J'), C('C', 'J')],
    ]
    const s = playingState({
      hands,
      trump: 'H',
      bidder: 0,
      turn: 1,
      leader: 1,
      tricksPlayed: 3,
      tricksWon: [0, 3],
      points: [0, 30],
    })
    // Team 1 defends and wins everything: 1 line + 1 for the kapot, and a koei for team 0.
    expect(values(s)).toEqual([3, 3, 3])
  })

  it('does not lead a king into the only trump: a 2-trick choice', () => {
    // Seat 0 (the bidder, on 18 points) needs 3 more. The king of diamonds
    // is ruffed by seat 3's king of hearts; the 10 of clubs costs nothing.
    const hands: Card[][] = [
      [C('C', '10'), C('D', 'K')],
      [C('S', 'K'), C('S', 'Q')],
      [C('S', '9'), C('C', 'K')],
      [C('D', 'Q'), C('H', 'K')],
    ]
    const s = playingState({
      hands,
      trump: 'H',
      bidder: 0,
      turn: 0,
      leader: 0,
      tricksPlayed: 4,
      tricksWon: [2, 2],
      points: [18, 10],
    })
    // Won hand: team 0 crosses 1 line. Lost hand: team 1 crosses 1, team 0 gets a koei.
    expect(solve(s, 0).map((v) => [v.action, v.value])).toEqual([
      [{ type: 'play', seat: 0, card: C('C', '10') }, 1],
      [{ type: 'play', seat: 0, card: C('D', 'K') }, -2],
    ])
  })
})

/** `n` random cards from the deck, none twice. */
function deal(rand: () => number, n: number): Card[] {
  const deck = fullDeck()
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck.slice(0, n)
}

/** A random PLAYING position with 3 tricks left, `fallen` cards already in the running trick. */
function randomPosition(seed: number, fallen: number): State {
  const rand = seededRandom(seed)
  const pick = (n: number) => Math.floor(rand() * n)
  const cards = deal(rand, 12)
  const hands = [0, 1, 2, 3].map((i) => cards.slice(i * 3, i * 3 + 3))
  const leader = pick(4)
  const trick = Array.from({ length: fallen }, (_, i) => {
    const seat = (leader + i) % 4
    return { seat, card: hands[seat].pop()! }
  })
  const bidder = pick(4)
  const won0 = pick(4)
  const lines: [number, number] = [1 + pick(13), 1 + pick(13)]
  return playingState({
    hands,
    trump: SUITS[pick(4)],
    bidder,
    level: pick(2) === 0 ? 1 : 2,
    multiplier: pick(2) + 1,
    turn: (leader + fallen) % 4,
    leader,
    trick,
    tricksPlayed: 3,
    tricksWon: [won0, 3 - won0],
    // Near 20 for the bidder's team: the draw and the win line are both in reach.
    points: bidder % 2 === 0 ? [8 + pick(10), 4 + pick(10)] : [4 + pick(10), 8 + pick(10)],
    lines,
  })
}

describe('solver against plain minimax', () => {
  it.each([0, 1, 2, 3])('matches the engine on random positions, %i cards in the trick', (fallen) => {
    for (let seed = 1; seed <= 25; seed++) {
      const s = randomPosition(seed * 10 + fallen, fallen)
      const solved = solve(s, s.turn)
      expect(solved.length).toBeGreaterThan(0)
      for (const { action, value } of solved) {
        expect(value, `seed ${seed}, ${JSON.stringify(action)}`).toBe(minimax(apply(s, action), s.turn % 2, s.lines))
      }
    }
  })
})

describe('solver, bidding', () => {
  /** Seat 1 holds the top hearts and spades; the turned cards are the 9 of hearts and the 9 of spades. */
  const strongSeat1 = (): State => {
    const s = biddingState(C('H', '9'), C('S', '9'), 0)
    s.hands = [
      [C('C', '9'), C('C', '10'), C('D', '9'), C('D', '10'), C('S', '9'), C('H', '9')],
      [C('H', 'A'), C('H', 'K'), C('H', 'Q'), C('H', 'J'), C('S', 'A'), C('S', 'K')],
      [C('C', 'J'), C('C', 'Q'), C('D', 'J'), C('D', 'Q'), C('S', '10'), C('S', 'J')],
      [C('C', 'K'), C('C', 'A'), C('D', 'K'), C('D', 'A'), C('S', 'Q'), C('H', '10')],
    ]
    return s
  }

  /** Value for `team` of the hand after `s` (a bid or choice just made), the seat to move playing for its own team. */
  const played = (s: State, team: number): number => {
    const t = settle(s)
    const best = Math.max(...solve(t, t.turn).map((v) => v.value))
    return teamOf(t.turn) === team ? best : -best
  }

  it('values go as the hand played out with that trump, level and bidder', () => {
    const s = strongSeat1()
    const [go] = solve(s, 1)
    expect(go.action).toEqual({ type: 'bid', seat: 1, play: true })
    expect(go.value).toBe(played(apply(s, go.action), 1))
    expect(go.value).toBeGreaterThan(0)
  })

  it('values pass as the choice the next seat makes for the other team', () => {
    const s = strongSeat1()
    const [, pass] = solve(s, 1)
    expect(pass.action).toEqual({ type: 'bid', seat: 1, play: false })
    const next = solve(apply(s, pass.action), 2)
    expect(pass.value).toBe(-Math.max(...next.map((v) => v.value)))
  })

  it('values every pass as the best choice of the seat after it, in random deals', () => {
    let checked = 0
    for (let seed = 1; seed <= 12; seed++) {
      const cards = deal(seededRandom(seed), 24)
      const hands = [0, 1, 2, 3].map((i) => cards.slice(i * 6, i * 6 + 6))
      // Both turned cards of the same suit in some deals: then the dealer chooses after round 1.
      let s = biddingState(hands[0][5], hands[0][4], 0)
      s.hands = hands
      while (s.phase === 'BIDDING_R1' || s.phase === 'BIDDING_R2') {
        const seat = (s.dealer + 1 + s.bidIndex) % 4
        const pass = solve(s, seat).find((v) => v.action.type === 'bid' && !v.action.play)!
        s = apply(s, pass.action)
        const next = s.phase === 'DEALER_CHOICE' ? s.dealer : (s.dealer + 1 + s.bidIndex) % 4
        const best = Math.max(...solve(s, next).map((v) => v.value))
        // 0 - best: never -0, which toBe tells apart from 0.
        expect(pass.value, `seed ${seed}, ${s.phase}`).toBe(teamOf(next) === teamOf(seat) ? best : 0 - best)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(50)
  }, 60_000)

  it('values the dealer passing as 0 and a suit as a level-2 hand', () => {
    let s = strongSeat1()
    // Both rounds pass: seats 1, 2, 3 twice.
    for (const seat of [1, 2, 3, 1, 2, 3]) s = apply(s, { type: 'bid', seat, play: false })
    expect(s.phase).toBe('DEALER_CHOICE')
    const solved = solve(s, 0)
    expect(solved.find((v) => v.action.type === 'choose' && v.action.suit === null)!.value).toBe(0)
    for (const v of solved) {
      if (v.action.type === 'choose' && v.action.suit) expect(v.value).toBe(played(apply(s, v.action), 0))
    }
  })
})
