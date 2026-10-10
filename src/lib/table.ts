import { teamOf, type LogEvent, type PublicState, type TrickCard } from '../engine'

/** Log events that start a new bidding round: bids before them are old. */
const BID_RESET = new Set(['deal', 'first-dealer', 'all-pass', 'second-card', 'score', 'tied'])

/** Latest bid ("Ik ga"/"Pas") each seat announced this hand, read back from the log. */
export function lastBids(log: LogEvent[]): Map<number, 'play' | 'pass'> {
  const map = new Map<number, 'play' | 'pass'>()
  for (let i = log.length - 1; i >= 0; i--) {
    const ev = log[i]
    if (BID_RESET.has(ev.t)) break
    if (ev.seat === undefined || map.has(ev.seat)) continue
    if (ev.t === 'pass' || ev.t === 'dealer-pass') map.set(ev.seat, 'pass')
    else if (ev.t === 'play-call') map.set(ev.seat, 'play')
  }
  return map
}

/** Bid bubbles stay up during bidding, the dealer announce and until the first card falls. */
export function showBids(pub: PublicState): boolean {
  return (
    pub.phase === 'BIDDING_R1' ||
    pub.phase === 'BIDDING_R2' ||
    pub.phase === 'DEALER_CHOICE' ||
    pub.phase === 'DEALING' ||
    (pub.phase === 'PLAYING' && pub.tricksPlayed === 0 && pub.trick.length === 0)
  )
}

/** The bidder's "troefke" bubble: from the ask until the first card falls. */
export const troefkeBubble = (pub: PublicState, seat: number): boolean =>
  pub.troefkeAsked && seat === pub.bidder && pub.tricksPlayed === 0 && pub.trick.length === 0

/** Cards are being played, or the hand or match is over. */
export const isPlaying = (pub: PublicState): boolean =>
  pub.phase === 'PLAYING' || pub.phase === 'SCORED' || pub.phase === 'GAME_OVER'

/** Team colour of a seat once a bidder is known and play has begun: playing or defending. */
export function sideOf(pub: PublicState, seat: number): 'decl' | 'def' | null {
  if (pub.bidder === null || !isPlaying(pub)) return null
  return teamOf(seat) === teamOf(pub.bidder) ? 'decl' : 'def'
}

/** A completed trick lingers on the felt until the winner leads again. */
export const lingerTrick = (pub: PublicState): TrickCard[] | null =>
  isPlaying(pub) && pub.trick.length === 0 ? pub.lastTrick : null

/** Trick cards to show: the trick in progress, or the lingering last one. */
export const shownTrick = (pub: PublicState): TrickCard[] | null =>
  pub.phase === 'PLAYING' && pub.trick.length > 0 ? pub.trick : lingerTrick(pub)

/** Fly direction from each screen position (0 bottom, 1 left, 2 top, 3 right) toward the centre. */
export const DIR = [
  { x: 0, y: 160 },
  { x: -180, y: 0 },
  { x: 0, y: -160 },
  { x: 180, y: 0 },
]
export const TILT = [-4, 3, -2, 5]

/** Relative position of `seat` seen from `my`: 0 bottom (me), 1 left, 2 top, 3 right. */
export const relSeat = (seat: number, my: number): number => (seat - my + 4) % 4
