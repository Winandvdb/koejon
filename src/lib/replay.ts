import { teamOf, trickWinnerIndex } from '../engine'
import type { Action, State, Suit } from '../engine'
import type { KjnMatch, KjnResult } from './kjn'

/** Room for a move rating (#105): a class on the item and an icon next to it. */
export interface MoveRating {
  cls: string
  icon: string
  label?: string
}

/** One recorded decision: a bid, the dealer's choice, troefke or a card. */
export interface MoveItem {
  /** Index into `steps` of the state right after this action. */
  step: number
  seat: number
  /** The action of the own seat. */
  own: boolean
  action: Extract<Action, { type: 'bid' | 'choose' | 'troefke' | 'play' }>
  /** A card that won its trick. */
  winner: boolean
  rating?: MoveRating
}

export interface MoveTrick {
  leader: number
  winner: number
  /** The cards in play order. */
  items: MoveItem[]
}

export interface MoveHand {
  /** 1-based hand number. */
  n: number
  /** Step of the deal: the first step of this hand. */
  start: number
  /** Last step of this hand. */
  end: number
  dealer: number
  contract: { bidder: number; trump: Suit; level: 1 | 2 } | null
  /** Bids, the dealer's choice and troefke, in order. */
  bids: MoveItem[]
  tricks: MoveTrick[]
  tricksWon: [number, number]
  result: KjnResult | null
  /** Lines of both teams after this hand. */
  lines: [number, number]
}

/** The move list of a match: per hand its bids and tricks, each item with its step in `steps` (`replaySteps`). */
export function replayMoves(match: KjnMatch, steps: State[], seat: number): MoveHand[] {
  let k = 0
  return match.hands.map((h, i) => {
    const start = k
    const item = (action: MoveItem['action']): MoveItem => {
      k++
      return {
        step: k,
        seat: action.seat,
        own: action.seat === seat,
        action,
        winner: false,
      }
    }
    const bids: MoveItem[] = h.auction.flat().map((b) => item({ type: 'bid', seat: b.seat, play: b.play }))
    if (h.choice !== undefined) bids.push(item({ type: 'choose', seat: h.dealer, suit: h.choice }))
    if (h.troefke && h.contract) bids.push(item({ type: 'troefke', seat: h.contract.bidder }))
    const tricks: MoveTrick[] = h.tricks.map((t) => {
      const items = t.cards.map((card, j) => item({ type: 'play', seat: (t.leader + j) % 4, card }))
      const w = trickWinnerIndex(
        t.cards.map((card, j) => ({ seat: (t.leader + j) % 4, card })),
        h.contract!.trump,
      )
      items[w].winner = true
      return { leader: t.leader, winner: items[w].seat, items }
    })
    const tricksWon: [number, number] = [0, 0]
    for (const t of tricks) tricksWon[teamOf(t.winner)]++
    const end = k
    k++
    return {
      n: i + 1,
      start,
      end,
      dealer: h.dealer,
      contract: h.contract,
      bids,
      tricks,
      tricksWon,
      result: h.result,
      lines: [steps[end].lines[0], steps[end].lines[1]],
    }
  })
}
