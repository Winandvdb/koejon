import { legalActions, toPublic, visibleHand } from '../engine'
import type { Action, Card, PublicState, State } from '../engine'

/**
 * What one seat may know: the public state, its own hand and its legal
 * actions. No other hands, no deck order, no RNG state. Algorithms get only
 * this, so they cannot read other players' cards. It shares arrays with the
 * engine state: read it, never change it.
 */
export interface Observation extends PublicState {
  seat: number
  /** Own hand; empty while the seat may not look at it (the dealer while bidding). */
  hand: Card[]
  legal: Action[]
}

export function observe(s: State, seat: number): Observation {
  return { ...toPublic(s), seat, hand: visibleHand(s, seat) ?? [], legal: legalActions(s, seat) }
}

export type DecisionPhase = 'bidding' | 'play'

/**
 * The one place that says which real decisions count as bidding: bids, the
 * troefke choice (asked with the ack) and the dealer's choice of suit. Only
 * card play counts as play.
 */
export function decisionPhase(obs: Observation): DecisionPhase {
  return obs.legal[0]?.type === 'play' ? 'play' : 'bidding'
}
