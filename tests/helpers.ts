import { apply, createMatch } from '../src/engine'
import type { Card, State, Suit, TrickCard } from '../src/engine'

export const C = (s: Suit, r: Card['r']): Card => ({ s, r })

/** Deterministic float source for bots/tests. */
export function mulberry(seed: number): () => number {
  let a = seed | 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A minimal but complete PLAYING state; override fields as needed. */
export function playingState(over: Partial<State> = {}): State {
  const lines = over.lines ?? [13, 13]
  const marks =
    over.marks ??
    [0, 1].flatMap((team) =>
      Array.from({ length: lines[team as 0 | 1] }, () => ({
        team,
        t: 'line' as const,
        crossed: false,
        batch: 0,
      })),
    )
  return {
    phase: 'PLAYING',
    rng: 1,
    seed: 1,
    handNumber: 1,
    dealer: 0,
    dealerDraw: null,
    hands: [[], [], [], []],
    turned: { first: C('H', '9'), second: C('S', '9'), secondUp: true },
    trump: 'H',
    level: 1,
    multiplier: 1,
    bidder: 1,
    bidIndex: 0,
    turn: 1,
    leader: 1,
    trick: [],
    lastTrick: null,
    prevTrick: null,
    // Default: everyone already confirmed, so plays are legal immediately.
    trickAcks: [0, 1, 2, 3],
    troefkeAsked: false,
    tricksPlayed: 0,
    tricksWon: [0, 0],
    piles: [[], []],
    points: [0, 0],
    lines,
    marks,
    koeien: [0, 0],
    lastResult: null,
    winner: null,
    stats: { doubles: [0, 0], triples: [0, 0], bidsMade: [0, 0, 0, 0], bidsWon: [0, 0, 0, 0] },
    log: [],
    ...over,
  }
}

/**
 * State at the last card of the 6th trick: 3 cards are down, `turn` holds
 * a single card. Preset points/tricksWon describe the first five tricks;
 * the engine adds the last trick itself.
 */
export function lastTrickState(opts: {
  trump?: Suit
  bidder?: number
  level?: 1 | 2
  multiplier?: number
  points?: [number, number]
  tricksWon?: [number, number]
  lines?: [number, number]
  trick: TrickCard[]
  turn: number
  card: Card
}): State {
  const hands: Card[][] = [[], [], [], []]
  hands[opts.turn] = [opts.card]
  return playingState({
    trump: opts.trump ?? 'H',
    bidder: opts.bidder ?? 1,
    level: opts.level ?? 1,
    multiplier: opts.multiplier ?? 1,
    points: opts.points ?? [0, 0],
    tricksWon: opts.tricksWon ?? [3, 2],
    lines: opts.lines ?? [13, 13],
    trick: opts.trick,
    turn: opts.turn,
    tricksPlayed: 5,
    hands,
  })
}

/**
 * Drive a fresh match into BIDDING_R1 with `dealer`.
 * Uses fixed draws and cuts and the first legal chooseDealer.
 */
export function dealtState(seed: number, dealer = 0): State {
  let s = createMatch(seed)
  s = apply(s, { type: 'start', seat: 0 })
  // draw until non-tie
  let guard = 100
  while (s.dealerDraw && s.dealerDraw.pending !== 2 && guard-- > 0) {
    const dd = s.dealerDraw
    const seat = dd.drawer[dd.pending]
    s = apply(s, { type: 'draw', seat, n: 6 })
  }
  if (!s.dealerDraw || s.dealerDraw.pending !== 2) throw new Error('draw did not finish')
  s = apply(s, { type: 'chooseDealer', seat: s.dealerDraw.winnerSeat!, dealer })
  return cutAndDeal(s)
}

/** From CUTTING: the dealer's right neighbour lifts `n` cards, then the dealer deals. */
export function cutAndDeal(s: State, n = 10): State {
  s = apply(s, { type: 'cut', seat: (s.dealer + 3) % 4, n })
  return apply(s, { type: 'deal', seat: s.dealer })
}

/** A state in BIDDING_R1 with chosen turned cards (hand contents irrelevant). */
export function biddingState(first: Card, second: Card, dealer = 0): State {
  const hands: Card[][] = [[], [], [], []]
  hands[dealer] = [C('C', '9'), C('C', '10'), C('D', '9'), C('D', '10'), second, first]
  return playingState({
    phase: 'BIDDING_R1',
    dealer,
    hands,
    turned: { first, second, secondUp: false },
    trump: null,
    level: 0,
    bidder: null,
    bidIndex: 0,
    turn: (dealer + 1) % 4,
    leader: (dealer + 1) % 4,
  })
}
