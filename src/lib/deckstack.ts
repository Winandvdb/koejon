import type { PublicState } from '../engine'

/** One packet that goes onto the next deck: a team's trick pile (one card back
 *  per trick, as on the table) or a thrown-in hand. */
export type StackPart =
  | { from: 'pile'; team: number; count: number }
  | { from: 'hand'; seat: number; count: number }

/**
 * How the next deck forms at the start of the cut, bottom packet first, so the
 * table can animate it. It follows the engine (`cutDeck`, `allPassed`): after a
 * scored hand team 0's pile goes on team 1's; after an all-passed deal the hands
 * are thrown in with seat 0's on top. Derived from the public state only, so
 * every client stacks the same way. Null for the first deal: a fresh shuffle.
 */
export function deckStack(pub: PublicState): StackPart[] | null {
  if (pub.phase !== 'CUTTING') return null
  if (pub.log.at(-1)?.t === 'all-pass') {
    return [3, 2, 1, 0].map((seat) => ({ from: 'hand', seat, count: 1 }))
  }
  if (pub.tricksWon[0] + pub.tricksWon[1] !== 6) return null
  // Kapot: the losing team has no pile.
  return [1, 0]
    .filter((team) => pub.tricksWon[team] > 0)
    .map((team) => ({ from: 'pile', team, count: pub.tricksWon[team] }))
}
