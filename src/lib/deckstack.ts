import { dealOrder } from '../engine'
import type { PublicState } from '../engine'

/** One packet that goes onto the next deck: a team's trick pile (one card back
 *  per trick, as on the table) or a thrown-in hand. */
export type StackPart =
  | { from: 'pile'; team: number; count: number }
  | { from: 'hand'; seat: number; count: number }

/**
 * How the next deck forms at the cut, bottom packet first, so the table can
 * animate it. It follows the engine (`cutDeck`, `allPassed`): after a scored
 * hand team 0's pile goes on team 1's; after an all-passed deal the hands are
 * thrown in with seat 0's on top. Derived from the public state only, so every
 * client stacks the same way. The deck stays through the deal announcement: a
 * bot cuts sooner than the animation ends. Null for the first deal: a fresh shuffle.
 */
export function deckStack(pub: PublicState): StackPart[] | null {
  if (pub.phase !== 'CUTTING' && pub.phase !== 'DEALING') return null
  if (pub.log.findLast((ev) => ev.t !== 'cut')?.t === 'all-pass') {
    return [3, 2, 1, 0].map((seat) => ({ from: 'hand', seat, count: 1 }))
  }
  if (pub.tricksWon[0] + pub.tricksWon[1] !== 6) return null
  // Kapot: the losing team has no pile.
  return [1, 0]
    .filter((team) => pub.tricksWon[team] > 0)
    .map((team) => ({ from: 'pile', team, count: pub.tricksWon[team] }))
}

/** Deal timing, shared by the table (animation) and the host (it waits for it). */
export const DEAL_STEP = 130
export const DEAL_FLY = 300
/** The last pair has landed. */
export const DEAL_MS = 11 * DEAL_STEP + DEAL_FLY

/** One pair of the deal: two deck positions, counted from the top, to one seat. */
export interface DealPair {
  seat: number
  from: [number, number]
}

/** The deal as the engine does it (`doDeal`): 3 rounds of two cards to each
 *  seat, from the top of the deck, the dealer's left neighbour first. */
export function dealPairs(dealer: number): DealPair[] {
  return Array.from({ length: 12 }, (_, i) => ({
    seat: dealOrder(dealer)[i % 4],
    from: [2 * i, 2 * i + 1],
  }))
}

/** The pair (index in `dealPairs`) that brings card `k` of `seat`'s dealt hand. */
export function pairOfCard(dealer: number, seat: number, k: number): number {
  return Math.floor(k / 2) * 4 + dealOrder(dealer).indexOf(seat)
}
