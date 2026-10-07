import { pendingSeats } from './engine'
import type {
  BoomkeMark,
  Card,
  DealerDraw,
  HandResult,
  LogEvent,
  MatchStats,
  Phase,
  State,
  Suit,
  TrickCard,
} from './types'

/** Everything a non-host client may see. No hands, no rng, hidden cards masked. */
export interface PublicState {
  phase: Phase
  handNumber: number
  dealer: number
  dealerDraw: Omit<DealerDraw, 'deck'> | null
  turned: { first: Card; second: Card | null; secondUp: boolean } | null
  trump: Suit | null
  level: 0 | 1 | 2
  multiplier: number
  bidder: number | null
  bidIndex: number
  turn: number
  leader: number
  trick: TrickCard[]
  lastTrick: TrickCard[] | null
  prevTrick: TrickCard[] | null
  trickAcks: number[]
  troefkeAsked: boolean
  tricksPlayed: number
  tricksWon: [number, number]
  points: [number, number]
  handCounts: [number, number, number, number]
  lines: [number, number]
  marks: BoomkeMark[]
  koeien: [number, number]
  lastResult: HandResult | null
  winner: number | null
  stats: MatchStats
  actionSeats: number[]
  log: LogEvent[]
}

export function toPublic(s: State): PublicState {
  // The draw deck stays on the host: it would reveal the cards still to lift.
  const dealerDraw = s.dealerDraw && (({ deck: _, ...rest }: DealerDraw) => rest)(s.dealerDraw)
  return {
    phase: s.phase,
    handNumber: s.handNumber,
    dealer: s.dealer,
    dealerDraw,
    turned: s.turned
      ? {
          first: s.turned.first,
          second: s.turned.secondUp ? s.turned.second : null,
          secondUp: s.turned.secondUp,
        }
      : null,
    trump: s.trump,
    level: s.level,
    multiplier: s.multiplier,
    bidder: s.bidder,
    bidIndex: s.bidIndex,
    turn: s.turn,
    leader: s.leader,
    trick: s.trick,
    lastTrick: s.lastTrick,
    prevTrick: s.prevTrick,
    trickAcks: s.trickAcks,
    troefkeAsked: s.troefkeAsked,
    tricksPlayed: s.tricksPlayed,
    tricksWon: s.tricksWon,
    points: s.points,
    handCounts: [0, 1, 2, 3].map((i) => s.hands[i].length) as PublicState['handCounts'],
    lines: s.lines,
    marks: s.marks,
    koeien: s.koeien,
    lastResult: s.lastResult,
    winner: s.winner,
    stats: s.stats,
    actionSeats: pendingSeats(s),
    log: s.log,
  }
}

/** The turned cards sit at the dealer's seat while bidding runs, and until
 *  the first card of the hand falls — not only until all four confirmed:
 *  the first leader is auto-confirmed and bots confirm at once, so a human
 *  leader would otherwise never get to see the second card. */
export function turnedVisible(pub: PublicState): boolean {
  if (pub.turned === null) return false
  if (pub.phase === 'BIDDING_R1' || pub.phase === 'BIDDING_R2' || pub.phase === 'DEALER_CHOICE')
    return true
  return pub.phase === 'PLAYING' && pub.tricksPlayed === 0 && pub.trick.length === 0
}

const PLACEHOLDER: Card = { s: 'S', r: '9' }

/**
 * Rebuild an engine-shaped state for one client. Other hands are empty;
 * the client's own hand comes from its private hand document.
 * Used only to compute that seat's legal actions — never to mutate.
 */
export function clientState(
  pub: PublicState,
  mySeat: number,
  myHand: Card[] | null,
): State {
  const hands: Card[][] = [[], [], [], []]
  if (mySeat >= 0) {
    hands[mySeat] = myHand ?? []
  }
  return {
    phase: pub.phase,
    rng: 0,
    seed: 0,
    handNumber: pub.handNumber,
    dealer: pub.dealer,
    dealerDraw: pub.dealerDraw ? { ...pub.dealerDraw, deck: null } : null,
    hands,
    turned: pub.turned
      ? {
          first: pub.turned.first,
          second: pub.turned.second ?? PLACEHOLDER,
          secondUp: pub.turned.secondUp,
        }
      : null,
    trump: pub.trump,
    level: pub.level,
    multiplier: pub.multiplier,
    bidder: pub.bidder,
    bidIndex: pub.bidIndex,
    turn: pub.turn,
    leader: pub.leader,
    trick: pub.trick,
    lastTrick: pub.lastTrick,
    prevTrick: pub.prevTrick,
    trickAcks: pub.trickAcks,
    troefkeAsked: pub.troefkeAsked,
    tricksPlayed: pub.tricksPlayed,
    tricksWon: pub.tricksWon,
    piles: [[], []],
    points: pub.points,
    lines: pub.lines,
    marks: pub.marks,
    koeien: pub.koeien,
    lastResult: pub.lastResult,
    winner: pub.winner,
    stats: pub.stats,
    log: pub.log,
  }
}
