import { partnerOf, RANK_ORDER } from '../engine'
import type { Card, State, Suit } from '../engine'
import { playedCards } from './determinize'
import type { Observation } from './observation'

// The troefke is a convention, not an engine rule: the partner may ignore it.
// Every algorithm that gives, obeys or reads it uses these, so they agree.

/**
 * A hand that may ask a troefke: our trumps can take over after the trump
 * lead — 3 trumps, or 2 with the king or ace. Search bots read a troefke as
 * this hand.
 */
export function troefkeHand(cards: Card[], trump: Suit): boolean {
  const trumps = cards.filter((c) => c.s === trump)
  return trumps.length >= 3 || (trumps.length >= 2 && trumps.some((c) => RANK_ORDER[c.r] >= RANK_ORDER['K']))
}

/** Obey: the partner of the bidder leads the first trick after a troefke, with a trump. */
export function troefkeLead(obs: Observation): boolean {
  return (
    obs.troefkeAsked &&
    obs.tricksPlayed === 0 &&
    obs.trick.length === 0 &&
    obs.bidder !== null &&
    obs.seat === partnerOf(obs.bidder) &&
    obs.hand.some((c) => c.s === obs.trump)
  )
}

/**
 * Keep-chance of a world where the bidder asked a troefke without a troefke
 * hand: unlikely, not impossible (a human asks as it likes). Not 0, so a
 * deal where no such hand fits does not spend every try of `sampleWorld`.
 */
const WEAK_TROEFKE = 0.1

/**
 * Read: after a troefke, every seat but the bidder reads it as a troefke hand
 * (`troefkeHand`: the cards the bidder holds in the world plus the ones it
 * played this hand) and keeps worlds without one only by `WEAK_TROEFKE`.
 * Undefined when there is nothing to learn: no troefke, or the bidder itself.
 */
export function troefkeWeight(obs: Observation): ((world: State) => number) | undefined {
  const bidder = obs.bidder
  if (!obs.troefkeAsked || bidder === null || bidder === obs.seat || !obs.trump) return undefined
  const trump = obs.trump
  const played = playedCards(obs).flatMap((tc) => (tc.seat === bidder ? [tc.card] : []))
  return (world) => (troefkeHand([...world.hands[bidder], ...played], trump) ? 1 : WEAK_TROEFKE)
}
