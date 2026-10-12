import { choiceSuits, leftOf, legalActions, RANK_POINTS, RANKS, sameCard, SUITS, teamOf } from '../engine'
import type { Action, Card, State, Suit } from '../engine'
import { handValue } from './value'

/** An action of the seat to move and the value of the hand for that seat's team (see `handValue`). */
export interface ActionValue {
  action: Action
  value: number
}

// Cards are numbers 0..23: suit * 6 + rank, rank 0 (9) to 5 (ace). A hand is a
// 24-bit mask, so a card is played and taken back with one XOR. `mcts` plays
// hands on the same cards.
export const cardIndex = (c: Card): number => SUITS.indexOf(c.s) * 6 + RANKS.indexOf(c.r)
export const SUIT_OF = Array.from({ length: 24 }, (_, i) => Math.floor(i / 6))
export const RANK_OF = Array.from({ length: 24 }, (_, i) => i % 6)
export const POINTS_OF = RANK_OF.map((r) => RANK_POINTS[RANKS[r]])
export const SUIT_MASK = [0, 1, 2, 3].map((s) => 0x3f << (6 * s))
export const maskOf = (cards: Card[]): number => cards.reduce((m, c) => m | (1 << cardIndex(c)), 0)

const INF = 1000

/** What decides the score of a hand once the cards are played. */
interface Contract {
  trump: number
  level: 1 | 2
  bidder: number
  multiplier: number
  lines: [number, number]
}

interface Position {
  hands: number[]
  /** Seat to move. */
  turn: number
  /** Cards of the running trick, in play order; the first one's seat is `turn` minus their count. */
  trick: number[]
  points: [number, number]
  tricksWon: [number, number]
  tricksPlayed: number
}

/** A position's value is between `lo` and `hi`; `best` is the move that gave `lo` or `hi` last. */
interface Entry {
  lo: number
  hi: number
  best: number
}

/**
 * Exact value, for `team`, of the rest of a hand when all four hands are
 * known: alpha-beta over the cards, the two teams playing against each other.
 * Position values are cached when a trick starts (hands, who leads, the
 * points that still decide the score), so the search of each root move
 * reuses what the others found.
 */
function createSearch(ct: Contract, team: number, pos: Position) {
  const { trump } = ct
  const hands = [...pos.hands]
  const trick = [...pos.trick]
  let trickLen = trick.length
  let turn = pos.turn
  let trickLeader = (turn - trickLen + 4) & 3
  const points = [...pos.points]
  const won = [...pos.tricksWon]
  let played = pos.tricksPlayed
  const tt = new Map<string, Entry>()
  const playing = ct.bidder & 1
  const base = ct.level === 1 ? ct.multiplier : 2
  // Points of the cards not yet in a finished trick: hands and the running trick.
  let rest = 0
  for (const c of trick) rest += POINTS_OF[c]
  for (const h of hands) for (let m = h; m; m &= m - 1) rest += POINTS_OF[31 - Math.clz32(m & -m)]

  /**
   * The hand's score for `team`, as `scoreHand` in the engine computes it.
   * It depends on the bidder's points only through `side` (0: under 20,
   * 1: exactly 20, 2: over 20) and on whether the winner took all 6 tricks.
   */
  const outcome = [0, 1, 2].map((side) =>
    [false, true].map((kapot) => {
      const defending = 1 - playing
      const winner = side === 2 ? playing : defending
      const after: [number, number] = [ct.lines[0], ct.lines[1]]
      if (side !== 1) {
        after[winner] = Math.max(0, after[winner] - (base + (kapot ? 1 : 0)))
        if (winner === defending) after[playing]++
      }
      return handValue({ lines: ct.lines }, { lines: after }, team)
    }),
  )
  const sideOf = (p: number): number => (p < 20 ? 0 : p === 20 ? 1 : 2)

  function terminal(): number {
    const side = sideOf(points[playing])
    return outcome[side][side !== 1 && won[side === 2 ? playing : 1 - playing] === 6 ? 1 : 0]
  }

  /**
   * What the hand can still be worth for `team`: the best and worst result
   * the points left to win and a possible sweep allow. Cheap, and it decides
   * most positions once the points are settled.
   */
  function bounds(): [number, number] {
    const least = points[playing]
    const most = least + rest
    let lo = INF
    let hi = -INF
    const take = (side: number, sweep: boolean) => {
      const v = outcome[side][sweep ? 1 : 0]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    if (least < 20) {
      take(0, false)
      if (won[playing] === 0) take(0, true)
    }
    if (least <= 20 && most >= 20) take(1, false)
    if (most > 20) {
      take(2, false)
      if (won[1 - playing] === 0) take(2, true)
    }
    return [lo, hi]
  }

  function beats(c: number, best: number): boolean {
    if (SUIT_OF[c] === trump) return SUIT_OF[best] !== trump || RANK_OF[c] > RANK_OF[best]
    return SUIT_OF[best] !== trump && SUIT_OF[c] === SUIT_OF[best] && RANK_OF[c] > RANK_OF[best]
  }

  /** Cards of `hand` that may be played now, as `legalCards` in the engine. */
  function legalMask(hand: number): number {
    if (trickLen === 0) return hand
    const led = SUIT_OF[trick[0]]
    if (led === trump) return hand & SUIT_MASK[trump] || hand
    const follow = hand & SUIT_MASK[led]
    if (follow === 0) return hand
    // No underbuy: a trump only counts when it beats the trumps already down.
    let top = -1
    for (let i = 1; i < trickLen; i++) if (SUIT_OF[trick[i]] === trump && RANK_OF[trick[i]] > top) top = RANK_OF[trick[i]]
    const over = ((hand & SUIT_MASK[trump]) >> (6 * trump)) >> (top + 1) << (top + 1)
    return follow | (over << (6 * trump))
  }

  /** Moves worth trying first: win cheaply, feed a winning partner, otherwise duck low. */
  function ordered(mask: number, best: number): number[] {
    const cards: number[] = []
    for (let m = mask; m; m &= m - 1) cards.push(31 - Math.clz32(m & -m))
    if (cards.length === 1) return cards
    const score: number[] = []
    let winning = -1
    let winningCard = -1
    for (let i = 0; i < trickLen; i++) {
      if (winningCard < 0 || beats(trick[i], winningCard)) {
        winningCard = trick[i]
        winning = (trickLeader + i) & 3
      }
    }
    for (const c of cards) {
      const cost = RANK_OF[c] + (SUIT_OF[c] === trump ? 6 : 0)
      if (c === best) score.push(1000)
      else if (trickLen === 0) score.push(cost)
      else if (beats(c, winningCard)) score.push(100 - cost)
      else if (((winning ^ turn) & 1) === 0) score.push(50 + POINTS_OF[c])
      else score.push(-cost)
    }
    // At most 6 cards: insertion sort, best first.
    for (let i = 1; i < cards.length; i++) {
      const c = cards[i]
      const v = score[i]
      let j = i - 1
      for (; j >= 0 && score[j] < v; j--) {
        cards[j + 1] = cards[j]
        score[j + 1] = score[j]
      }
      cards[j + 1] = c
      score[j + 1] = v
    }
    return cards
  }

  /** Play `c`, search the rest, take the move back. */
  function child(c: number, alpha: number, beta: number): number {
    const seat = turn
    hands[seat] ^= 1 << c
    trick[trickLen++] = c
    let v: number
    if (trickLen < 4) {
      turn = (seat + 1) & 3
      v = search(alpha, beta)
      turn = seat
      trickLen--
    } else {
      let top = 0
      let pts = 0
      for (let i = 0; i < 4; i++) {
        if (i > 0 && beats(trick[i], trick[top])) top = i
        pts += POINTS_OF[trick[i]]
      }
      const leader = trickLeader
      const winner = (leader + top) & 3
      const t = winner & 1
      // The next tricks reuse the slots of this one.
      const [c0, c1, c2] = trick
      points[t] += pts
      rest -= pts
      won[t]++
      played++
      trickLen = 0
      trickLeader = turn = winner
      v = search(alpha, beta)
      trickLeader = leader
      turn = seat
      played--
      won[t]--
      rest += pts
      points[t] -= pts
      trickLen = 3
      trick[0] = c0
      trick[1] = c1
      trick[2] = c2
    }
    hands[seat] ^= 1 << c
    return v
  }

  function search(alpha: number, beta: number): number {
    if (played === 6) return terminal()
    const [lo, hi] = bounds()
    if (lo >= beta) return lo
    if (hi <= alpha) return hi
    if (lo === hi) return lo
    alpha = Math.max(alpha, lo)
    beta = Math.min(beta, hi)
    let key = ''
    let entry: Entry | undefined
    let best = -1
    if (trickLen === 0) {
      // Which team holds the points also decides a kapot (all tricks to one team).
      const sweep = won[playing] === played ? 1 : won[1 - playing] === played ? 2 : 0
      key = `${hands[0] + hands[1] * 0x1000000}|${hands[2] + hands[3] * 0x1000000}|${(points[playing] * 3 + sweep) * 4 + turn}`
      entry = tt.get(key)
      if (entry) {
        if (entry.lo >= beta) return entry.lo
        if (entry.hi <= alpha) return entry.hi
        if (entry.lo === entry.hi) return entry.lo
        alpha = Math.max(alpha, entry.lo)
        beta = Math.min(beta, entry.hi)
        best = entry.best
      }
    }
    const a0 = alpha
    const b0 = beta
    const maximizing = (turn & 1) === team
    let value = maximizing ? -INF : INF
    let bestMove = -1
    for (const c of ordered(legalMask(hands[turn]), best)) {
      const v = child(c, alpha, beta)
      if (maximizing ? v > value : v < value) {
        value = v
        bestMove = c
      }
      if (maximizing) alpha = Math.max(alpha, value)
      else beta = Math.min(beta, value)
      if (alpha >= beta) break
    }
    if (key) {
      const e = entry ?? { lo: -INF, hi: INF, best: -1 }
      if (value <= a0) e.hi = Math.min(e.hi, value)
      else if (value >= b0) e.lo = Math.max(e.lo, value)
      else e.lo = e.hi = value
      e.best = bestMove
      tt.set(key, e)
    }
    return value
  }

  return {
    /** Value with the seat to move free to choose. */
    value: () => search(-INF, INF),
    /** Value after the seat to move plays `card`. */
    after: (card: number) => child(card, -INF, INF),
  }
}

type Search = ReturnType<typeof createSearch>

/** Search of the running hand in `s`, with the seat to move already known. */
function playSearch(s: State, team: number): Search {
  const ct: Contract = {
    trump: SUITS.indexOf(s.trump!),
    level: s.level as 1 | 2,
    bidder: s.bidder!,
    multiplier: s.multiplier,
    lines: s.lines,
  }
  return createSearch(ct, team, {
    hands: s.hands.map(maskOf),
    turn: s.turn,
    trick: s.trick.map((tc) => cardIndex(tc.card)),
    points: s.points,
    tricksWon: s.tricksWon,
    tricksPlayed: s.tricksPlayed,
  })
}

/**
 * The values of the bid decisions in a deal where every hand is known. Each
 * choice (go, pass, a suit) is a hand played out exactly; the seats after it
 * choose for their own team the same way, down to the dealer's choice. All
 * passed counts as 0: nobody crosses a line (the doubled stake that follows is not weighed).
 */
function solveBids(s: State, seat: number, actions: Action[]): ActionValue[] {
  const team = teamOf(seat)
  const hands = s.hands.map(maskOf)
  const t = s.turned!
  const cache = new Map<string, number>()
  /** Value of playing out the hand when `bidder` plays `suit` at `level`. */
  const play = (suit: Suit, level: 1 | 2, bidder: number): number => {
    // The search needs only the bidder's team: partners share a solved hand.
    const k = `${suit}${level}${teamOf(bidder)}`
    let v = cache.get(k)
    if (v === undefined) {
      const ct: Contract = { trump: SUITS.indexOf(suit), level, bidder, multiplier: s.multiplier, lines: s.lines }
      v = createSearch(ct, team, {
        hands,
        turn: leftOf(s.dealer),
        trick: [],
        points: [0, 0],
        tricksWon: [0, 0],
        tricksPlayed: 0,
      }).value()
      cache.set(k, v)
    }
    return v
  }
  const best = (who: number, a: number, b: number) => (teamOf(who) === team ? Math.max(a, b) : Math.min(a, b))
  // The dealer chooses after both rounds, so with both turned cards face up,
  // also when the world is still in round 1.
  const suits = choiceSuits({ ...s, turned: { ...t, secondUp: true } })
  const dealer = (): number => {
    const values = [...suits.map((suit) => play(suit, 2, s.dealer)), 0]
    return teamOf(s.dealer) === team ? Math.max(...values) : Math.min(...values)
  }
  const afterRound = (r1: boolean): number => (r1 && t.second.s !== t.first.s ? round(false, 0) : dealer())
  const passed = (r1: boolean, i: number): number => (i + 1 < 3 ? round(r1, i + 1) : afterRound(r1))
  const go = (r1: boolean, i: number): number =>
    play(r1 ? t.first.s : t.second.s, r1 ? 1 : 2, (s.dealer + 1 + i) & 3)
  function round(r1: boolean, i: number): number {
    return best((s.dealer + 1 + i) & 3, go(r1, i), passed(r1, i))
  }

  const r1 = s.phase === 'BIDDING_R1'
  return actions.map((action) => {
    if (action.type === 'bid') return { action, value: action.play ? go(r1, s.bidIndex) : passed(r1, s.bidIndex) }
    if (action.type === 'choose') return { action, value: action.suit ? play(action.suit, 2, s.dealer) : 0 }
    throw new Error(`solver cannot value ${action.type} in ${s.phase}`)
  })
}

/**
 * Double-dummy values of `actions` (default: all the legal ones) for `seat`
 * in `s`, a state where all four hands are known, so a sampled world. Value
 * is the hand's result for the seat's team: lines crossed minus lines the
 * other team crossed, as `handValue`. Both teams play their best.
 *
 * In PLAYING: a card, or an ack / troefke, which only has the value of the
 * position itself (a troefke asks the partner, who may ignore it, so in the
 * engine it changes no play). In bidding: a bid, or the dealer's choice,
 * every deal after it played out the same way.
 */
export function solve(s: State, seat: number, actions: Action[] = legalActions(s, seat)): ActionValue[] {
  switch (s.phase) {
    case 'PLAYING': {
      const search = playSearch(s, teamOf(seat))
      return actions.map((action) => {
        if (action.type !== 'play') return { action, value: search.value() }
        // The search flips the card's bit: a card from outside the hand would make one up.
        if (action.seat !== s.turn || !s.hands[s.turn].some((c) => sameCard(c, action.card)))
          throw new Error(`solver: seat ${action.seat} cannot play ${action.card.r}${action.card.s} now`)
        return { action, value: search.after(cardIndex(action.card)) }
      })
    }
    case 'BIDDING_R1':
    case 'BIDDING_R2':
    case 'DEALER_CHOICE':
      return solveBids(s, seat, actions)
    default:
      throw new Error(`solver has nothing to solve in ${s.phase}`)
  }
}
