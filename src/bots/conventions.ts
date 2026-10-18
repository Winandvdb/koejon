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
 * Keep-chance of a world that goes against a troefke: the bidder asked
 * without a troefke hand, or its partner ignored it while holding trump.
 * Unlikely, not impossible (a human asks and leads as it likes). Not 0, so a
 * deal where no such hand fits does not spend every try of `sampleWorld`.
 */
const WEAK_TROEFKE = 0.1

/**
 * Read: the partner of the bidder ignored the troefke, that is led a
 * non-trump to the first trick. A bot obeys whenever it holds a trump
 * (`troefkeLead`), so that partner (almost) surely has none. Its seat, or
 * null when no troefke was ignored.
 */
export function troefkeIgnored(obs: Observation): number | null {
  if (!obs.troefkeAsked || obs.bidder === null || !obs.trump) return null
  const partner = partnerOf(obs.bidder)
  const first = playedCards(obs)[0]
  return first && first.seat === partner && first.card.s !== obs.trump ? partner : null
}

/**
 * Read: after a troefke, every seat but the bidder reads it as a troefke hand
 * (`troefkeHand`: the cards the bidder holds in the world plus the ones it
 * played this hand) and keeps worlds without one only by `WEAK_TROEFKE`.
 * After an ignored troefke (`troefkeIgnored`), every seat but that partner
 * also keeps worlds where the partner holds a trump only by `WEAK_TROEFKE`.
 * Undefined when there is nothing to learn.
 */
export function troefkeWeight(obs: Observation): ((world: State) => number) | undefined {
  const bidder = obs.bidder
  if (!obs.troefkeAsked || bidder === null || !obs.trump) return undefined
  const trump = obs.trump
  const played = playedCards(obs)
  const parts: ((world: State) => number)[] = []
  if (bidder !== obs.seat) {
    const own = played.flatMap((tc) => (tc.seat === bidder ? [tc.card] : []))
    parts.push((world) => (troefkeHand([...world.hands[bidder], ...own], trump) ? 1 : WEAK_TROEFKE))
  }
  const ignored = troefkeIgnored(obs)
  // A trump it played later proves it ignored with trump: every world agrees.
  if (ignored !== null && ignored !== obs.seat && !played.some((tc) => tc.seat === ignored && tc.card.s === trump)) {
    parts.push((world) => (world.hands[ignored].some((c) => c.s === trump) ? WEAK_TROEFKE : 1))
  }
  if (parts.length === 0) return undefined
  return (world) => parts.reduce((w, part) => w * part(world), 1)
}
