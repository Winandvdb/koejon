import {
  choiceSuits,
  legalActions,
  legalCards,
  RANK_ORDER,
  RANK_POINTS,
  trickWinnerIndex,
} from '../engine'
import type { Action, Card, State, Suit, TrickCard } from '../engine'

const teamOf = (seat: number) => seat % 2

/** Rough strength of a hand for a given trump suit. */
function rateHand(hand: Card[], trump: Suit): number {
  let score = 0
  for (const c of hand) {
    if (c.s === trump) {
      // Trump count and trump honours.
      score += 2 + [0, 0, 1.5, 1, 2, 3][RANK_ORDER[c.r] - 1]
    } else if (c.r === 'A') {
      score += 3
    } else if (c.r === 'K') {
      score += 1.5
    }
  }
  return score
}

const BID_THRESHOLD = 8

function wouldWin(trick: TrickCard[], seat: number, card: Card, trump: Suit): boolean {
  const next = [...trick, { seat, card }]
  return trickWinnerIndex(next, trump) === next.length - 1
}

function lowest(cards: Card[]): Card {
  return cards.reduce((a, b) => (RANK_ORDER[a.r] <= RANK_ORDER[b.r] ? a : b))
}

function highest(cards: Card[]): Card {
  return cards.reduce((a, b) => (RANK_ORDER[a.r] >= RANK_ORDER[b.r] ? a : b))
}

/** Highest point value among cards (A=4 .. J=1, else 0). */
function highestPoint(cards: Card[]): Card {
  return cards.reduce((a, b) =>
    RANK_POINTS[a.r] > RANK_POINTS[b.r] ||
    (RANK_POINTS[a.r] === RANK_POINTS[b.r] && RANK_ORDER[a.r] >= RANK_ORDER[b.r])
      ? a
      : b,
  )
}

function choosePlayCard(s: State, seat: number, rand: () => number): Card {
  const legal = legalCards(s, seat)
  const trump = s.trump!
  const partner = (seat + 2) % 4
  const playing = s.bidder !== null && teamOf(seat) === teamOf(s.bidder)

  // Leading.
  if (s.trick.length === 0) {
    if (playing) {
      // Lead a strong card.
      return highest(legal)
    }
    const plain = legal.filter((c) => c.s !== trump)
    return lowest(plain.length ? plain : legal)
  }

  // Following.
  const winnerIdx = trickWinnerIndex(s.trick, trump)
  const partnerWinning = s.trick[winnerIdx].seat === partner

  if (partnerWinning) {
    // Feed points without overtaking if possible.
    const safe = legal.filter((c) => !wouldWin(s.trick, seat, c, trump))
    const pool = safe.length ? safe : legal
    const pointCards = pool.filter((c) => RANK_POINTS[c.r] > 0)
    if (pointCards.length) return highestPoint(pointCards)
    return lowest(pool)
  }

  // Opponent winning: cheapest winning card, else lowest legal dump.
  const winning = legal.filter((c) => wouldWin(s.trick, seat, c, trump))
  if (winning.length) return lowest(winning)
  void rand
  return lowest(legal)
}

/**
 * Pick an engine action for a bot seat. Uses only legalActions,
 * so the no-underbuy and follow rules are always respected.
 */
export function botAction(s: State, seat: number, rand: () => number = Math.random): Action {
  const legal = legalActions(s, seat)
  if (legal.length === 0) throw new Error(`bot seat ${seat} has no legal action in ${s.phase}`)

  const first = legal[0]
  switch (first.type) {
    case 'start':
    case 'draw':
    case 'deal':
    case 'ack':
    case 'next':
      return first
    case 'chooseDealer': {
      // Pick a random member of the winner's own team.
      const mate = (seat + 2) % 4
      return { type: 'chooseDealer', seat, dealer: rand() < 0.5 ? seat : mate }
    }
    case 'bid': {
      const suit = s.phase === 'BIDDING_R1' ? s.turned!.first.s : s.turned!.second.s
      const play = rateHand(s.hands[seat], suit) >= BID_THRESHOLD
      return { type: 'bid', seat, play }
    }
    case 'choose': {
      let best: Suit | null = null
      let bestScore = -1
      for (const suit of choiceSuits(s)) {
        const score = rateHand(s.hands[seat], suit)
        if (score > bestScore) {
          bestScore = score
          best = suit
        }
      }
      if (best !== null && bestScore >= BID_THRESHOLD) return { type: 'choose', seat, suit: best }
      return { type: 'choose', seat, suit: null }
    }
    case 'play':
      return { type: 'play', seat, card: choosePlayCard(s, seat, rand) }
  }
}
