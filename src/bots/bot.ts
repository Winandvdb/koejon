import {
  choiceSuits,
  legalActions,
  legalCards,
  RANK_ORDER,
  RANK_POINTS,
  RANKS,
  trickPoints,
  trickWinnerIndex,
} from '../engine'
import type { Action, Card, Rank, State, Suit, TrickCard } from '../engine'

const teamOf = (seat: number) => seat % 2
const partnerOf = (seat: number) => (seat + 2) % 4
const oppSeatsOf = (seat: number) => [(seat + 1) % 4, (seat + 3) % 4]

// ---- Tunables --------------------------------------------------------------

/** Share of card decisions that use the smart rule; the rest dump low. */
const SKILL = 0.9
const BID_THRESHOLD = 8
/** Knijpen: minimum rating for a squeeze bid, and odds of going anyway. */
const KNIJP_MIN = 4
const KNIJP_CHANCE = 0.85
const TROEFKE_CHANCE = 0.9
/** Dealer blind-choice probabilities. */
const DEALER_SAME_SUIT = 0.9
const DEALER_LOW_SAME = 0.15
const DEALER_ACE = 0.6
const DEALER_KING = 0.25
const DEALER_WEAK = 0.05
/** Trick points worth a fight, and the winner cost allowed for a cheap steal. */
const CONTEST_MIN = 5
const CHEAP_WIN = 6
/** Max points to feed a trick the partner may still lose. */
const VET_MAX_RISK = 2

// ---- Small helpers -----------------------------------------------------------

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

/** Cost of throwing a card away: give no points, keep real winners. */
const dumpCost = (c: Card, trump: Suit) =>
  RANK_POINTS[c.r] * 10 + (c.s === trump ? 4 : 0) + RANK_ORDER[c.r]

/** Cost of spending a card to win a trick: a low trump is the cheapest way. */
const winCost = (c: Card, trump: Suit) =>
  RANK_POINTS[c.r] * 2 + RANK_ORDER[c.r] + (c.s === trump ? 3 : 0)

function cheapest(cards: Card[], trump: Suit): Card {
  return cards.reduce((a, b) => (dumpCost(a, trump) <= dumpCost(b, trump) ? a : b))
}

function wouldWin(trick: TrickCard[], seat: number, card: Card, trump: Suit): boolean {
  const next = [...trick, { seat, card }]
  return trickWinnerIndex(next, trump) === next.length - 1
}

// ---- Hand reading ------------------------------------------------------------

interface HandRead {
  /** Trump ranks already played this hand. */
  trumpsGone: Set<Rank>
  /** Trumps held by the other three players: 6 minus gone minus mine. */
  trumpsOut: number
  /** Highest trump rank someone else may still hold; null = none left. */
  bossOut: Rank | null
  /** 'seat:suit' — the seat has shown out of that suit this hand. */
  voids: Set<string>
}

/**
 * Human-like memory rebuilt from the public log: which trumps are gone and who
 * has shown out of a suit. Side-suit ranks are deliberately not counted, so the
 * bot still misjudges some tricks — like a human does.
 */
function readHand(s: State, seat: number): HandRead {
  const trump = s.trump!
  // Cards played this hand: 4 per finished trick plus the open one.
  const want = s.tricksPlayed * 4 + s.trick.length
  const played: TrickCard[] = []
  for (let i = s.log.length - 1; i >= 0 && played.length < want; i--) {
    const ev = s.log[i]
    if (ev.t === 'card' && ev.card && ev.seat !== undefined) {
      played.unshift({ seat: ev.seat, card: ev.card })
    }
  }
  // A sluff of a third suit, a trump under an existing trump, or any non-trump
  // under a trump lead means the led suit was missing.
  const voids = new Set<string>()
  for (let t = 0; t + 1 < played.length; t += 4) {
    const w = played.slice(t, t + 4)
    const led = w[0].card.s
    let topTrump = led === trump ? RANK_ORDER[w[0].card.r] : 0
    for (let i = 1; i < w.length; i++) {
      const c = w[i].card
      if (c.s === trump) {
        if (led !== trump && RANK_ORDER[c.r] < topTrump) voids.add(`${w[i].seat}:${led}`)
        topTrump = Math.max(topTrump, RANK_ORDER[c.r])
      } else if (led === trump || c.s !== led) {
        voids.add(`${w[i].seat}:${led}`)
      }
    }
  }
  const mine = s.hands[seat].filter((c) => c.s === trump)
  const trumpsGone = new Set<Rank>()
  for (const tc of played) if (tc.card.s === trump) trumpsGone.add(tc.card.r)
  let bossOut: Rank | null = null
  for (let i = RANKS.length - 1; i >= 0; i--) {
    const r = RANKS[i]
    if (!trumpsGone.has(r) && !mine.some((c) => c.r === r)) {
      bossOut = r
      break
    }
  }
  return { trumpsGone, trumpsOut: 6 - trumpsGone.size - mine.length, bossOut, voids }
}

/** Highest trump of `cards` that still tops everything left outside our hand. */
function bossTrump(cards: Card[], read: HandRead): Card | null {
  const beat = cards.filter(
    (c) => read.bossOut === null || RANK_ORDER[c.r] > RANK_ORDER[read.bossOut],
  )
  return beat.length ? highest(beat) : null
}

// ---- Bidding -----------------------------------------------------------------

/** Rough strength of a hand for a given trump suit. */
function rateHand(hand: Card[], trump: Suit): number {
  const suitLen: Record<Suit, number> = { S: 0, H: 0, D: 0, C: 0 }
  for (const c of hand) suitLen[c.s]++
  let score = 0
  let trumps = 0
  for (const c of hand) {
    if (c.s === trump) {
      trumps++
      score += 2 + [0, 0, 1.5, 1, 2, 3][RANK_ORDER[c.r] - 1]
    } else if (c.r === 'A') {
      score += 3
    } else if (c.r === 'K') {
      score += suitLen[c.s] >= 2 ? 1.5 : 0.5 // a bare king is easy prey
    }
  }
  if (trumps > 2) score += trumps - 2 // trump length is pulling power
  return score
}

/** Ask for the trump lead only when our trumps can take over afterwards. */
function wantsTroefke(s: State, seat: number, rand: () => number): boolean {
  const trumps = s.hands[seat].filter((c) => c.s === s.trump)
  const strong =
    trumps.length >= 3 ||
    (trumps.length >= 2 && trumps.some((c) => RANK_ORDER[c.r] >= RANK_ORDER['K']))
  return strong && rand() < TROEFKE_CHANCE
}

// ---- Card play -----------------------------------------------------------------

function leadCard(s: State, seat: number, legal: Card[], read: HandRead): Card {
  const trump = s.trump!
  const myTeam = teamOf(seat)
  const trumps = legal.filter((c) => c.s === trump)
  const oppVoid = (suit: Suit) => oppSeatsOf(seat).some((o) => read.voids.has(`${o}:${suit}`))

  // Honour the partner's troefke request: open with the best trump.
  if (
    s.troefkeAsked &&
    s.tricksPlayed === 0 &&
    seat === partnerOf(s.bidder!) &&
    trumps.length > 0
  ) {
    return highest(trumps)
  }
  // Protect a live sweep: lead the surest winner first.
  if (s.tricksPlayed > 0 && s.tricksWon[myTeam] === s.tricksPlayed) {
    const boss = bossTrump(trumps, read)
    if (boss) return boss
    const ace = legal.find((c) => c.r === 'A' && c.s !== trump && !oppVoid(c.s))
    if (ace) return ace
    return highest(legal)
  }
  const playing = teamOf(s.bidder!) === myTeam
  const boss = bossTrump(trumps, read)
  // Pull trumps when we hold the boss and others still hold trumps. Defenders
  // pull only when they hold the majority of what is left.
  if (boss && read.trumpsOut > 0 && (playing || trumps.length > read.trumpsOut)) return boss
  // Length pull: with enough trumps a low one still draws enemy trumps.
  if (playing && trumps.length >= 3 && read.trumpsOut >= 2) return lowest(trumps)
  // Cash a safe ace — skip suits where an opponent has shown out.
  const aces = legal.filter((c) => c.r === 'A' && c.s !== trump && !oppVoid(c.s))
  if (aces.length) return highest(aces)
  // Otherwise a low card from a suit nobody is known void in.
  const plain = legal.filter((c) => c.s !== trump)
  const pool = plain.length ? plain : legal
  const safe = pool.filter((c) => !oppVoid(c.s) && !read.voids.has(`${partnerOf(seat)}:${c.s}`))
  const ok = safe.length ? safe : pool.filter((c) => !oppVoid(c.s))
  return lowest(ok.length ? ok : pool)
}

function followCard(s: State, seat: number, legal: Card[], read: HandRead): Card {
  const trump = s.trump!
  const myTeam = teamOf(seat)
  const winnerIdx = trickWinnerIndex(s.trick, trump)
  const partnerWinning = s.trick[winnerIdx].seat === partnerOf(seat)
  const tPts = trickPoints(s.trick)
  const oppToAct = oppSeatsOf(seat).filter((o) => !s.trick.some((tc) => tc.seat === o))
  const sweep = s.tricksPlayed > 0 && s.tricksWon[myTeam] === s.tricksPlayed
  const antiKapot = s.tricksPlayed > 0 && s.tricksWon[1 - myTeam] === s.tricksPlayed
  // 21 points already settled the hand; only a live kapot still matters.
  const decided = s.points[0] >= 21 || s.points[1] >= 21
  if (decided && !sweep && !antiKapot) return cheapest(legal, trump)

  if (partnerWinning) {
    // Vet the trick — never overtake, and mind who can still beat partner.
    const safe = legal.filter((c) => !wouldWin(s.trick, seat, c, trump))
    if (safe.length === 0) return cheapest(legal, trump) // forced to overtake
    const pts = safe.filter((c) => RANK_POINTS[c.r] > 0)
    if (pts.length === 0) return lowest(safe)
    const pc = s.trick[winnerIdx].card
    const partnerSafe =
      oppToAct.length === 0 ||
      (pc.s === trump &&
        (read.bossOut === null || RANK_ORDER[pc.r] >= RANK_ORDER[read.bossOut])) ||
      (pc.r === 'A' &&
        (read.trumpsOut === 0 || oppToAct.every((o) => read.voids.has(`${o}:${trump}`))))
    if (partnerSafe) {
      // Feed real points — but keep aces, they win tricks of their own.
      const nonAce = pts.filter((c) => c.r !== 'A')
      return highestPoint(nonAce.length ? nonAce : pts)
    }
    // Partner's win is not sealed: feed only cheap points.
    const cheap = pts.filter((c) => RANK_POINTS[c.r] <= VET_MAX_RISK)
    return cheap.length ? highestPoint(cheap) : lowest(safe)
  }

  // Opponent winning: fight for rich tricks, duck the rest.
  const winners = legal.filter((c) => wouldWin(s.trick, seat, c, trump))
  if (winners.length === 0) return cheapest(legal, trump)
  const cheapestWin = winners.reduce((a, b) =>
    winCost(a, trump) <= winCost(b, trump) ? a : b,
  )
  const worthIt =
    s.points[myTeam] + tPts >= 21 || // win the hand outright
    s.points[1 - myTeam] + tPts >= 21 || // deny them the hand
    sweep ||
    antiKapot ||
    tPts >= CONTEST_MIN ||
    (tPts >= 3 && winCost(cheapestWin, trump) <= CHEAP_WIN)
  return worthIt ? cheapestWin : cheapest(legal, trump)
}

function choosePlayCard(s: State, seat: number, rand: () => number): Card {
  const legal = legalCards(s, seat)
  if (legal.length === 1) return legal[0]
  const read = readHand(s, seat)
  const smart =
    s.trick.length === 0 ? leadCard(s, seat, legal, read) : followCard(s, seat, legal, read)
  // Imperfect on purpose: sometimes fall back to a lazy dump.
  return rand() < SKILL ? smart : cheapest(legal, s.trump!)
}

// ---- Entry point -----------------------------------------------------------------

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
    case 'next':
    case 'troefke':
      // Troefke is the bidder's lone legal action while the partner's first
      // lead is pending — there is no decline. The real decision happens in
      // the 'ack' branch below, where asking doubles as the confirmation.
      return first
    case 'ack': {
      const t = legal.find((a) => a.type === 'troefke')
      if (t && wantsTroefke(s, seat, rand)) return t
      return first
    }
    case 'chooseDealer': {
      // Pick a random member of the winner's own team.
      const mate = partnerOf(seat)
      return { type: 'chooseDealer', seat, dealer: rand() < 0.5 ? seat : mate }
    }
    case 'bid': {
      const suit = s.phase === 'BIDDING_R1' ? s.turned!.first.s : s.turned!.second.s
      const rating = rateHand(s.hands[seat], suit)
      const myTeam = teamOf(seat)
      const oppLines = s.lines[1 - myTeam]
      // Knijpen: squeeze the hand to level 1 while a level-1 loss stays
      // survivable — pointless at 1 opponent line, where any loss kills.
      const knijpen = s.phase === 'BIDDING_R1' && oppLines <= 2 && oppLines > s.multiplier
      // A hand worth all remaining lines deserves a looser bid.
      const stakes = s.phase === 'BIDDING_R1' ? s.multiplier : 2
      const decisive = s.lines[myTeam] <= stakes || (s.phase === 'BIDDING_R2' && oppLines <= 2)
      const play =
        rating >= BID_THRESHOLD ||
        (knijpen && (rating >= KNIJP_MIN || rand() < KNIJP_CHANCE)) ||
        (decisive && rating >= BID_THRESHOLD - 2)
      return { type: 'bid', seat, play }
    }
    case 'choose': {
      // The dealer chooses blind — they know only the two shown cards, which
      // are already theirs. Same suit means two guaranteed trumps.
      const suits = choiceSuits(s)
      const t = s.turned!
      const rankOf = (suit: Suit) =>
        suit === t.first.s ? RANK_ORDER[t.first.r] : RANK_ORDER[t.second.r]
      const best = suits.reduce((a, b) => (rankOf(a) >= rankOf(b) ? a : b))
      // A level-2 win erases 2 lines — always go when that ends the match.
      if (s.lines[teamOf(seat)] <= 2) return { type: 'choose', seat, suit: best }
      let p: number
      if (suits.length === 1) {
        const low =
          RANK_ORDER[t.first.r] <= RANK_ORDER['J'] && RANK_ORDER[t.second.r] <= RANK_ORDER['J']
        p = low ? DEALER_LOW_SAME : DEALER_SAME_SUIT
      } else {
        // Different suits: a gamble — only a strong shown card justifies it.
        const top = Math.max(...suits.map(rankOf))
        p = top >= RANK_ORDER['A'] ? DEALER_ACE : top >= RANK_ORDER['K'] ? DEALER_KING : DEALER_WEAK
      }
      return { type: 'choose', seat, suit: rand() < p ? best : null }
    }
    case 'play':
      return { type: 'play', seat, card: choosePlayCard(s, seat, rand) }
  }
}
