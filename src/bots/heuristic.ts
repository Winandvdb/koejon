import {
  RANK_ORDER,
  RANK_POINTS,
  RANKS,
  sameCard,
  SUITS,
  teamOf,
  trickPoints,
  trickWinnerIndex,
} from '../engine'
import type { Action, Card, Rank, Suit, TrickCard } from '../engine'
import type { Algorithm, BotTrace } from './algorithm'
import { troefkeHand, troefkeLead } from './conventions'
import type { Observation } from './observation'

const partnerOf = (seat: number) => (seat + 2) % 4
const oppSeatsOf = (seat: number) => [(seat + 1) % 4, (seat + 3) % 4]

// ---- Tunables --------------------------------------------------------------

export type BotLevel = 'easy' | 'normal' | 'hard'
export const BOT_LEVELS: BotLevel[] = ['easy', 'normal', 'hard']

export interface BotProfile {
  /** Share of card decisions that use the smart rule; the rest are lazy. */
  skill: number
  /** A lazy card: the cheapest dump, or any legal card, a beginner's slip that can give an ace away. */
  lazy: 'dump' | 'random'
  /** What the bot remembers: nothing, trumps only, or trumps plus voids, suit counts and fallen aces. */
  memory: 'none' | 'trumps' | 'full'
  /** Knijpen, troefke, dealer-choice weighing and lead tactics — beginners lack these. */
  tactics: boolean
}

export const BOT_PROFILES: Record<BotLevel, BotProfile> = {
  easy: { skill: 0.55, lazy: 'random', memory: 'none', tactics: false },
  normal: { skill: 0.8, lazy: 'dump', memory: 'trumps', tactics: true },
  hard: { skill: 0.95, lazy: 'dump', memory: 'full', tactics: true },
}

/** Tuning constants; the options of `heuristic:<level>` override them. */
export interface HeuristicOptions {
  /**
   * Bid threshold by stake in lines. A win erases the stake, a loss gives the
   * stake away plus a koei, so the break-even win chance is
   * (stake + 1) / (2 * stake + 1) (`breakEven`): a higher stake asks a weaker hand.
   */
  bidThreshold1: number
  bidThreshold2: number
  bidThreshold4: number
  /** 1st card: wait for the 2nd card when another suit rates this much higher… */
  betterSuit: number
  /** …unless the turned suit clears the threshold by this margin. */
  clearBid: number
  /** A bid with one trump (K or A) asks at least this rating. */
  loneTrumpMin: number
  /**
   * The dealer keeps the turned trump card: a turned ace raises the bid
   * threshold by `turnedOpponent` when the dealer is an opponent, and lowers
   * it by `turnedPartner` when the dealer is the partner. A lower card counts
   * by its points, so a 9 or 10 counts nothing.
   */
  turnedOpponent: number
  turnedPartner: number
  /** Knijpen: minimum rating for a squeeze bid, and odds of going anyway. */
  knijpMin: number
  knijpChance: number
  troefkeChance: number
  /** Dealer blind-choice probabilities. */
  dealerSameSuit: number
  dealerLowSame: number
  dealerAce: number
  dealerKing: number
  dealerWeak: number
  /** Trick points worth a fight, and the winner cost allowed for a cheap steal. */
  contestMin: number
  cheapWin: number
  /** Max points to feed a trick the partner may still lose. */
  vetMaxRisk: number
}

/**
 * Tuned with `npm run tune` (SPSA, seed 1, 150 generations, 400 seeds; #93),
 * except the values marked as set by hand (`fixed` in `PARAMS`). The bid
 * thresholds and the turned card constants were tuned again together, with
 * the other constants fixed (#170).
 */
export const HEURISTIC_DEFAULTS: Readonly<HeuristicOptions> = {
  bidThreshold1: 14.5,
  bidThreshold2: 11,
  bidThreshold4: 11.5,
  betterSuit: 5.5,
  clearBid: 7.5,
  loneTrumpMin: 14.5,
  turnedOpponent: 2.5,
  turnedPartner: 3,
  knijpMin: 1.5,
  knijpChance: 0.79,
  troefkeChance: 0.73,
  dealerSameSuit: 0.98,
  dealerLowSame: 0.31,
  dealerAce: 0.65,
  // Set by hand, not tuned (#175): people almost never go blind on two suits
  // without an ace. Tuned, these drifted to 0.3 and 0.25 on noise; the low
  // values play as well against bots.
  dealerKing: 0.1,
  dealerWeak: 0.05,
  contestMin: 4,
  cheapWin: 10,
  vetMaxRisk: 1,
}

/**
 * Per-level overrides of the defaults. Easy keeps the hand-picked values from
 * before the tuning: the tuned ones make every level stronger, and a beginner
 * bot that bids fast is fine.
 */
const LEVEL_OPTIONS: Record<BotLevel, Partial<HeuristicOptions>> = {
  easy: {
    bidThreshold1: 11,
    bidThreshold2: 8,
    bidThreshold4: 7,
    betterSuit: 2,
    clearBid: 3,
    loneTrumpMin: 13,
    // Beginners do not read the dealer's turned card.
    turnedOpponent: 0,
    turnedPartner: 0,
    knijpMin: 4,
    knijpChance: 0.85,
    troefkeChance: 0.9,
    dealerSameSuit: 0.9,
    dealerLowSame: 0.15,
    dealerAce: 0.6,
    dealerKing: 0.25,
    dealerWeak: 0.05,
    contestMin: 5,
    cheapWin: 6,
    vetMaxRisk: 2,
  },
  normal: {},
  hard: {},
}

/** The options a level plays without spec options. */
export function levelOptions(level: BotLevel): HeuristicOptions {
  return { ...HEURISTIC_DEFAULTS, ...LEVEL_OPTIONS[level] }
}

export const TROEFKE_CHANCE = HEURISTIC_DEFAULTS.troefkeChance

// ---- Small helpers -----------------------------------------------------------

/** Note why a card was picked, for the trace. */
function because<T>(why: string[], reason: string, x: T): T {
  why.push(reason)
  return x
}

function lowest(cards: Card[]): Card {
  return cards.reduce((a, b) => (RANK_ORDER[a.r] <= RANK_ORDER[b.r] ? a : b))
}

function highest(cards: Card[]): Card {
  return cards.reduce((a, b) => (RANK_ORDER[a.r] >= RANK_ORDER[b.r] ? a : b))
}

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

/** Drop trumps that lose to a trump already down, while a plain card can go instead. */
function noUndertrump(trick: TrickCard[], cards: Card[], trump: Suit): Card[] {
  const top = Math.max(0, ...trick.filter((tc) => tc.card.s === trump).map((tc) => RANK_ORDER[tc.card.r]))
  const keep = cards.filter((c) => c.s !== trump || RANK_ORDER[c.r] > top)
  return keep.some((c) => c.s !== trump) ? keep : cards
}

/** Throw a card away: never overtake the partner, never waste a trump under a higher one. */
function dump(trick: TrickCard[], seat: number, legal: Card[], trump: Suit): Card {
  let pool = legal
  if (trick.length > 0 && trick[trickWinnerIndex(trick, trump)].seat === partnerOf(seat)) {
    const safe = legal.filter((c) => !wouldWin(trick, seat, c, trump))
    if (safe.length) pool = safe
  }
  return cheapest(noUndertrump(trick, pool, trump), trump)
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
  /** Cards of each suit played this hand ('full' memory only, else 0). */
  suitSeen: Record<Suit, number>
  /** Suits whose ace fell this hand ('full' memory only, else empty). */
  acesGone: Set<Suit>
  /** Cards the partner signalled to hold, still unplayed and not ours (no memory: empty). */
  signals: Card[]
}

/**
 * Human-like memory rebuilt from the public log: which trumps are gone and who
 * has shown out of a suit. Side-suit ranks are deliberately not counted (only
 * how many of a suit fell, and which aces), so the bot still misjudges some
 * tricks — like a human does.
 */
function readHand(s: Observation, memory: BotProfile['memory']): HandRead {
  const trump = s.trump!
  const trumpsGone = new Set<Rank>()
  const voids = new Set<string>()
  const suitSeen: Record<Suit, number> = { S: 0, H: 0, D: 0, C: 0 }
  const acesGone = new Set<Suit>()
  const signals: Card[] = []
  if (memory !== 'none') {
    const playedThisHand = s.tricksPlayed * 4 + s.trick.length
    const played: TrickCard[] = []
    for (let i = s.log.length - 1; i >= 0 && played.length < playedThisHand; i--) {
      const ev = s.log[i]
      if (ev.t === 'card' && ev.card && ev.seat !== undefined) {
        played.unshift({ seat: ev.seat, card: ev.card })
      }
    }
    for (const tc of played) if (tc.card.s === trump) trumpsGone.add(tc.card.r)
    if (memory === 'trumps') {
      // Trump voids only: a non-trump under a trump lead means trump was missing.
      for (let t = 0; t + 1 < played.length; t += 4) {
        const w = played.slice(t, t + 4)
        if (w[0].card.s !== trump) continue
        for (let i = 1; i < w.length; i++) {
          if (w[i].card.s !== trump) voids.add(`${w[i].seat}:${trump}`)
        }
      }
    }
    if (memory === 'full') {
      for (const tc of played) {
        suitSeen[tc.card.s]++
        if (tc.card.r === 'A') acesGone.add(tc.card.s)
      }
      // A sluff of a third suit, a trump under an existing trump, or any
      // non-trump under a trump lead means the led suit was missing.
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
    }
    // The partner's discard of a side suit on a trick we won and played before
    // it, a card without points or an ace, says: I hold the highest card
    // left in that suit, the ace or after it the king. A card with points is a
    // vet, not a signal. It ends once that card fell, the partner showed out of
    // the suit, or when the card is ours.
    const partner = partnerOf(s.seat)
    const fellBy = (n: number, c: Card) => played.slice(0, n).some((tc) => sameCard(tc.card, c))
    for (let t = 0; t + 4 <= played.length - s.trick.length; t += 4) {
      const w = played.slice(t, t + 4)
      const i = w.findIndex((tc) => tc.seat === partner)
      const me = w.findIndex((tc) => tc.seat === s.seat)
      if (i < me || w[trickWinnerIndex(w, trump)].seat !== s.seat) continue
      const suit = w[i].card.s
      if (suit === trump || suit === w[0].card.s) continue
      if (RANK_POINTS[w[i].card.r] > 0 && w[i].card.r !== 'A') continue
      const r = (['A', 'K'] as const).find((r) => !fellBy(t + i + 1, { s: suit, r }))
      if (!r) continue
      const top = { s: suit, r }
      if (!fellBy(played.length, top) && !voids.has(`${partner}:${suit}`) && !s.hand.some((c) => sameCard(c, top)))
        signals.push(top)
    }
  }
  const mine = s.hand.filter((c) => c.s === trump)
  let bossOut: Rank | null = null
  for (let i = RANKS.length - 1; i >= 0; i--) {
    const r = RANKS[i]
    if (!trumpsGone.has(r) && !mine.some((c) => c.r === r)) {
      bossOut = r
      break
    }
  }
  return { trumpsGone, trumpsOut: 6 - trumpsGone.size - mine.length, bossOut, voids, suitSeen, acesGone, signals }
}

/** Highest trump of `cards` that still tops everything left outside our hand. */
function bossTrump(cards: Card[], read: HandRead): Card | null {
  const beat = cards.filter(
    (c) => read.bossOut === null || RANK_ORDER[c.r] > RANK_ORDER[read.bossOut],
  )
  return beat.length ? highest(beat) : null
}

/** False once the seat showed out of trump, or no trump is left outside our hand. */
function mayHoldTrump(read: HandRead, seat: number, trump: Suit): boolean {
  return read.trumpsOut > 0 && !read.voids.has(`${seat}:${trump}`)
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

// Moved to the shared conventions; still exported here for older imports.
export { troefkeHand }

function wantsTroefke(s: Observation, rand: () => number, opt: HeuristicOptions): boolean {
  return troefkeHand(s.hand, s.trump!) && rand() < opt.troefkeChance
}

// ---- Card play -----------------------------------------------------------------

function leadCard(s: Observation, legal: Card[], read: HandRead, tactics: boolean, why: string[]): Card {
  const seat = s.seat
  const trump = s.trump!
  const myTeam = teamOf(seat)
  const trumps = legal.filter((c) => c.s === trump)
  const oppVoid = (suit: Suit) => oppSeatsOf(seat).some((o) => read.voids.has(`${o}:${suit}`))
  // Cards of a suit the other three may still hold (counts need 'full' memory).
  const outside = (suit: Suit) => 6 - s.hand.filter((c) => c.s === suit).length - read.suitSeen[suit]

  if (troefkeLead(s)) return because(why, 'troefke: lead the best trump', highest(trumps))
  const isBidder = seat === s.bidder
  const partner = seat === partnerOf(s.bidder!)
  const boss = bossTrump(trumps, read)
  const plain = legal.filter((c) => c.s !== trump)
  // A defender without the trump majority keeps the boss: it stays a threat
  // to the bidders as long as possible.
  const shortDefender = !isBidder && !partner && trumps.length <= read.trumpsOut
  // The bidder pulls; the partner leaves that to the bidder.
  const leadsBoss = isBidder || (!partner && !shortDefender)
  // Both opponents showed out of trump: whatever trumps are left belong to the
  // partner, and pulling only strips our own side.
  const oppMayTrump = oppSeatsOf(seat).some((o) => mayHoldTrump(read, o, trump))
  const aces = plain.filter((c) => c.r === 'A')
  const lowTrumps = trumps.filter((c) => c !== boss)
  // Only aces as plain cards while an opponent may trump them: a low trump
  // goes first from every seat (#163), even a short defender's boss trump.
  const beforeAces =
    oppMayTrump && aces.length && aces.length === plain.length && trumps.length ? lowest(trumps) : null
  const acesWait = 'the ace waits: an opponent may trump it'
  // A low card in a suit the partner signalled reaches the partner's top card.
  const toSignal = plain.filter((c) => read.signals.some((g) => g.s === c.s))
  const signalLead = toSignal.length ? lowest(toSignal) : null
  const signalWhy = `low card to the partner's signal in ${signalLead?.s}, opponents hold no trump`
  // Protect a live sweep: lead the surest winner first. Trump is always
  // allowed, so a side ace is sure only once no opponent may hold trump.
  if (s.tricksPlayed > 0 && s.tricksWon[myTeam] === s.tricksPlayed) {
    if (boss && leadsBoss) return because(why, 'sweep: boss trump', boss)
    if (aces.length && !oppMayTrump) return because(why, 'sweep: safe ace, opponents hold no trump', aces[0])
    if (signalLead && !oppMayTrump) return because(why, `sweep: ${signalWhy}`, signalLead)
    if (aces.length && !tactics) return because(why, 'sweep: beginner cashes an ace', aces[0])
    if (beforeAces) return because(why, `sweep: only aces left: low trump, ${acesWait}`, beforeAces)
    // From here on any ace waits.
    const keep = partner || shortDefender ? trumps : []
    const rest = legal.filter((c) => !keep.includes(c) && !aces.includes(c))
    const note = aces.length ? `, ${acesWait}` : ''
    if (keep.length && rest.length) return because(why, `sweep: highest card, keeps trump${note}`, highest(rest))
    if (rest.length) return because(why, `sweep: highest card${note}`, highest(rest))
    return because(why, 'sweep: highest card', highest(legal))
  }
  // Pull trumps when we hold the boss and others still hold trumps. Defenders
  // pull only when they hold the majority of what is left.
  if (boss && leadsBoss && read.trumpsOut > 0 && oppMayTrump)
    return because(why, 'pull trumps with the boss', boss)
  // A beginner cashes its aces at once, also where an opponent may trump them.
  if (aces.length && !tactics) return because(why, 'beginner: cash an ace', aces[0])
  // Length pull: with enough trumps a low one still draws enemy trumps.
  if (tactics && isBidder && oppMayTrump && trumps.length >= 3 && read.trumpsOut >= 2)
    return because(why, 'length pull: low trump', lowest(trumps))
  // Low trump against the trump ace: once it falls, our top trump is the boss.
  // A short defender keeps its trumps, as for the boss pull.
  const top = tactics && trumps.length >= 2 && leadsBoss ? highest(trumps) : null
  const nextOut = RANKS.filter(
    (r) => r !== 'A' && !read.trumpsGone.has(r) && !trumps.some((c) => c.r === r),
  ).pop()
  if (
    top &&
    oppMayTrump &&
    read.bossOut === 'A' &&
    (nextOut === undefined || RANK_ORDER[top.r] > RANK_ORDER[nextOut])
  )
    return because(why, 'low trump to draw the trump ace', lowest(trumps))
  // A short defender with two side aces pulls with a low trump, so the bidders'
  // trumps fall before the aces go. With one ace the pull gains nothing (#195).
  if (shortDefender && oppMayTrump && lowTrumps.length && aces.length >= 2)
    return because(why, 'defender pull: low trump, keeps the boss', lowest(lowTrumps))
  // Trump is always allowed, also on a suit an opponent can follow: cash an
  // ace only once no opponent may hold trump.
  if (aces.length && !oppMayTrump) return because(why, 'cash an ace: opponents hold no trump', highest(aces))
  // A suit nobody else holds wins once no opponent may trump. The count
  // needs 'full' memory: other levels see no suit fall.
  if (!oppMayTrump) {
    const unfollowed = plain.filter((c) => read.suitSeen[c.s] > 0 && outside(c.s) === 0)
    if (unfollowed.length) return because(why, 'suit nobody else holds', highest(unfollowed))
    if (signalLead) return because(why, signalWhy, signalLead)
  }
  // Otherwise a low card from a suit nobody is known void in. An ace goes
  // only when nothing else may.
  if (beforeAces) return because(why, `only aces left: low trump, ${acesWait}`, beforeAces)
  const nonAce = plain.filter((c) => c.r !== 'A')
  const pool = nonAce.length ? nonAce : plain.length ? plain : legal
  const safe = pool.filter((c) => !oppVoid(c.s) && !read.voids.has(`${partnerOf(seat)}:${c.s}`))
  const ok = safe.length ? safe : pool.filter((c) => !oppVoid(c.s))
  const leads = ok.length ? ok : pool
  // Draw out the ace: a card without points under our king, so the king tops
  // the suit once the ace falls. Only 'full' memory knows the ace already fell.
  const has = (suit: Suit, r: Rank) => s.hand.some((c) => c.s === suit && c.r === r)
  const underKing = tactics
    ? leads.filter(
        (c) =>
          c.s !== trump &&
          RANK_POINTS[c.r] === 0 &&
          has(c.s, 'K') &&
          !has(c.s, 'A') &&
          !read.acesGone.has(c.s),
      )
    : []
  if (underKing.length) return because(why, 'draw out the ace: low card under the king', lowest(underKing))
  return because(why, 'low lead', lowest(leads))
}

function followCard(
  s: Observation,
  legal: Card[],
  read: HandRead,
  opt: HeuristicOptions,
  tactics: boolean,
  why: string[],
): Card {
  const seat = s.seat
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
  if (decided && !sweep && !antiKapot) return because(why, 'hand decided: dump', dump(s.trick, seat, legal, trump))

  // Troefke: the partner opens trump and the bidder pulls. An opponent still
  // plays after the bidder, so take the trick with a trump nobody left can
  // beat, unless the partner's trump already is one.
  const pc = s.trick[winnerIdx].card
  const sealed = partnerWinning && (read.bossOut === null || RANK_ORDER[pc.r] >= RANK_ORDER[read.bossOut])
  const trumpLedOnTroefke =
    s.troefkeAsked && s.tricksPlayed === 0 && seat === s.bidder && s.trick[0].card.s === trump
  if (trumpLedOnTroefke && oppToAct.length > 0 && !sealed) {
    const boss = legal.filter(
      (c) =>
        c.s === trump &&
        (read.bossOut === null || RANK_ORDER[c.r] > RANK_ORDER[read.bossOut]) &&
        wouldWin(s.trick, seat, c, trump),
    )
    if (boss.length) return because(why, 'troefke: take the trump lead with the boss trump', lowest(boss))
  }

  if (partnerWinning) {
    // Vet the trick — never overtake, and mind who can still beat partner.
    const safe = noUndertrump(
      s.trick,
      legal.filter((c) => !wouldWin(s.trick, seat, c, trump)),
      trump,
    )
    if (safe.length === 0) {
      // Our team already holds the trick: follow suit to keep the trump, and
      // the card's points go to our side. In a kapot run with an opponent
      // still to play, the trick is worth the cheapest card, also a trump.
      const follow = legal.filter((c) => c.s !== trump)
      const kapotRun = (sweep || antiKapot) && oppToAct.length > 0
      if (follow.length && !kapotRun) {
        if (oppToAct.length === 0) {
          // Nobody can beat it: feed points, but keep an ace for a trick of its own.
          const nonAce = follow.filter((c) => c.r !== 'A')
          return because(why, 'overtake partner, last to play: follow suit with points', highestPoint(nonAce.length ? nonAce : follow))
        }
        // An opponent can still beat it: feed only cheap points.
        const cheap = follow.filter((c) => RANK_POINTS[c.r] <= opt.vetMaxRisk)
        return because(why, 'overtake partner, opponent to play: follow suit, cheap points', cheap.length ? highestPoint(cheap) : lowest(follow))
      }
      return because(why, 'forced to overtake partner', cheapest(legal, trump))
    }
    // A discard without points tells the partner: I hold the highest card left
    // in this suit. It replaces only a card without points, so the vet stays.
    let signal: Card | null = null
    if (tactics && !legal.some((c) => c.s === s.trick[0].card.s)) {
      const has = (suit: Suit, r: Rank) => s.hand.some((c) => c.s === suit && c.r === r)
      const holdsTop = (suit: Suit) => has(suit, 'A') || (read.acesGone.has(suit) && has(suit, 'K'))
      const low = safe.filter((c) => c.s !== trump && RANK_POINTS[c.r] === 0 && holdsTop(c.s))
      if (low.length) signal = lowest(low)
    }
    const quiet = (reason: string) =>
      signal ? because(why, `signal: low card under the top of ${signal.s}`, signal) : because(why, reason, lowest(safe))
    const pts = safe.filter((c) => RANK_POINTS[c.r] > 0)
    if (pts.length === 0) return quiet('partner wins: no points to feed')
    const partnerSafe =
      oppToAct.length === 0 ||
      (pc.s === trump &&
        (read.bossOut === null || RANK_ORDER[pc.r] >= RANK_ORDER[read.bossOut])) ||
      (pc.r === 'A' &&
        (read.trumpsOut === 0 || oppToAct.every((o) => read.voids.has(`${o}:${trump}`))))
    if (partnerSafe) {
      // Feed real points — but keep aces, they win tricks of their own.
      const nonAce = pts.filter((c) => c.r !== 'A')
      return because(why, 'partner safe: feed points', highestPoint(nonAce.length ? nonAce : pts))
    }
    const cheap = pts.filter((c) => RANK_POINTS[c.r] <= opt.vetMaxRisk)
    if (cheap.length) return because(why, 'partner not safe: feed cheap points', highestPoint(cheap))
    return quiet('partner not safe: feed cheap points')
  }

  // Opponent winning: fight for rich tricks, duck the rest.
  let winners = legal.filter((c) => wouldWin(s.trick, seat, c, trump))
  if (winners.length === 0) return because(why, 'cannot win: dump', dump(s.trick, seat, legal, trump))
  // A plain dump can still be a low trump that buys the trick: duck with a plain card.
  const plain = legal.filter((c) => c.s !== trump)
  const duck = (reason: string) =>
    because(why, reason, dump(s.trick, seat, plain.length ? plain : legal, trump))
  const partnerToAct = !s.trick.some((tc) => tc.seat === partnerOf(seat))
  // A trick with no points is worth no trump, unless the partner already played
  // and only our card can still stop their kapot.
  if (tPts === 0 && plain.length && !(antiKapot && !partnerToAct)) {
    winners = winners.filter((c) => c.s !== trump)
    if (winners.length === 0) return duck('no points: no trump')
  }
  const cheapestWin = winners.reduce((a, b) =>
    winCost(a, trump) <= winCost(b, trump) ? a : b,
  )
  // Without the boss trump and outnumbered in trumps, ours get pulled later
  // anyway — better spend one on a trick with points now.
  const myTrumps = s.hand.filter((c) => c.s === trump)
  const doomed =
    cheapestWin.s === trump &&
    oppSeatsOf(seat).some((o) => mayHoldTrump(read, o, trump)) &&
    !bossTrump(myTrumps, read) &&
    read.trumpsOut >= myTrumps.length
  // A lone trump with points falls to the first trump lead: buy a trick with it
  // first, also when the partner still plays.
  if (doomed && tPts > 0 && s.trick[winnerIdx].card.s !== trump && myTrumps.length === 1 && RANK_POINTS[cheapestWin.r] >= 2)
    return because(why, `lone high trump: buy ${tPts} points before it is pulled`, cheapestWin)
  const decisive =
    s.points[myTeam] + tPts >= 21 || // win the hand outright
    s.points[1 - myTeam] + tPts >= 21 // deny them the hand
  // The partner plays 4th: count on them for a trick below the cheap-steal
  // floor, also to keep or stop a kapot.
  if (partnerToAct && !decisive && tPts < 3) return duck(`partner plays 4th: duck ${tPts} points`)
  const worthIt =
    (tPts > 0 && doomed) ||
    decisive ||
    sweep ||
    antiKapot ||
    tPts >= opt.contestMin ||
    (tPts >= 3 && winCost(cheapestWin, trump) <= opt.cheapWin)
  return worthIt
    ? because(why, `contest: ${tPts} points in the trick`, cheapestWin)
    : duck('not worth it: duck')
}

function choosePlayCard(
  s: Observation,
  rand: () => number,
  profile: BotProfile,
  opt: HeuristicOptions,
  why: string[],
): Card {
  const legal = s.legal.flatMap((a) => (a.type === 'play' ? [a.card] : []))
  if (legal.length === 1) return because(why, 'only legal card', legal[0])
  const read = readHand(s, profile.memory)
  const smart =
    s.trick.length === 0 ? leadCard(s, legal, read, profile.tactics, why) : followCard(s, legal, read, opt, profile.tactics, why)
  // Imperfect on purpose: sometimes fall back to a lazy card.
  if (rand() < profile.skill) return smart
  // The smart rule did not decide, so its reason stays out of the trace.
  why.length = 0
  why.push('lazy dump')
  if (profile.lazy === 'random') return because(why, 'random card', legal[Math.floor(rand() * legal.length)])
  return dump(s.trick, s.seat, legal, s.trump!)
}

// ---- Decisions -------------------------------------------------------------------

function decide(
  s: Observation,
  rand: () => number,
  profile: BotProfile,
  opt: HeuristicOptions,
  why: string[],
): Action {
  const seat = s.seat
  const first = s.legal[0]
  switch (first.type) {
    case 'ack': {
      const t = s.legal.find((a) => a.type === 'troefke')
      if (t && profile.tactics && wantsTroefke(s, rand, opt)) return because(why, 'troefke: strong trumps', t)
      return because(why, 'no troefke', first)
    }
    case 'bid': {
      const r1 = s.phase === 'BIDDING_R1'
      const suit = r1 ? s.turned!.first.s : s.turned!.second!.s
      const hand = s.hand
      const rating = rateHand(hand, suit)
      const trumps = hand.filter((c) => c.s === suit)
      // Real players never go without trump, and with a lone trump only on a
      // hand full of aces: a single trump is pulled at once.
      if (trumps.length === 0) return because(why, 'bid: no trump', { type: 'bid', seat, play: false })
      if (trumps.length === 1 && (RANK_ORDER[trumps[0].r] < RANK_ORDER['K'] || rating < opt.loneTrumpMin))
        return because(why, `bid: lone trump, rating ${rating}`, { type: 'bid', seat, play: false })
      const myTeam = teamOf(seat)
      const oppLines = s.lines[1 - myTeam]
      // Knijpen: squeeze the hand to level 1 while a level-1 loss stays
      // survivable — pointless at 1 opponent line, where any loss kills.
      const knijpen = r1 && oppLines <= 2 && oppLines > s.multiplier
      // A hand worth all remaining lines deserves a looser bid.
      const stakes = r1 ? s.multiplier : 2
      const decisive = s.lines[myTeam] <= stakes || (!r1 && oppLines <= 2)
      const shown = r1 ? s.turned!.first : s.turned!.second!
      const turned =
        (s.dealer === partnerOf(seat) ? -opt.turnedPartner : opt.turnedOpponent) *
        (RANK_POINTS[shown.r] / RANK_POINTS.A)
      const threshold =
        (stakes >= 4 ? opt.bidThreshold4 : stakes >= 2 ? opt.bidThreshold2 : opt.bidThreshold1) + turned
      // On the 1st card two low trumps are pulled at once: ask a K or A.
      const solid =
        !r1 || trumps.length !== 2 || trumps.some((c) => RANK_ORDER[c.r] >= RANK_ORDER['K'])
      // A hand that fits another suit clearly better waits for the 2nd card.
      const otherBest = Math.max(...SUITS.filter((x) => x !== suit).map((x) => rateHand(hand, x)))
      const waits =
        r1 && profile.tactics && otherBest >= rating + opt.betterSuit && rating < threshold + opt.clearBid
      const play =
        (solid && !waits && rating >= threshold) ||
        (profile.tactics &&
          ((knijpen && (rating >= opt.knijpMin || rand() < opt.knijpChance)) ||
            (decisive && solid && rating >= threshold - 2)))
      why.push(
        `bid: rating ${rating} vs threshold ${Number(threshold.toFixed(2))}` +
          (turned ? `, turned ${shown.r} ${turned > 0 ? '+' : ''}${Number(turned.toFixed(2))}` : '') +
          (waits ? ', waits for the 2nd card' : '') +
          (!solid ? ', two low trumps' : '') +
          (knijpen ? ', knijpen' : '') +
          (decisive ? ', decisive' : ''),
      )
      return { type: 'bid', seat, play }
    }
    case 'choose': {
      // The dealer chooses blind — they know only the two shown cards, which
      // are already theirs. Same suit means two guaranteed trumps.
      const suits = s.legal.flatMap((a) => (a.type === 'choose' && a.suit ? [a.suit] : []))
      const t = s.turned!
      const rankOf = (suit: Suit) =>
        suit === t.first.s ? RANK_ORDER[t.first.r] : RANK_ORDER[t.second!.r]
      const best = suits.reduce((a, b) => (rankOf(a) >= rankOf(b) ? a : b))
      // A level-2 win erases 2 lines — always go when that ends the match.
      if (s.lines[teamOf(seat)] <= 2) return because(why, 'choose: a win ends the match', { type: 'choose', seat, suit: best })
      // Beginners weigh nothing: play a shown suit most of the time.
      if (!profile.tactics) {
        return because(why, 'choose: no tactics, random', {
          type: 'choose',
          seat,
          suit: rand() < 0.7 ? suits[Math.floor(rand() * suits.length)] : null,
        })
      }
      let p: number
      if (suits.length === 1) {
        const low =
          RANK_ORDER[t.first.r] <= RANK_ORDER['J'] && RANK_ORDER[t.second!.r] <= RANK_ORDER['J']
        p = low ? opt.dealerLowSame : opt.dealerSameSuit
      } else {
        // Different suits: a gamble — only a strong shown card justifies it.
        const top = Math.max(...suits.map(rankOf))
        p = top >= RANK_ORDER['A'] ? opt.dealerAce : top >= RANK_ORDER['K'] ? opt.dealerKing : opt.dealerWeak
      }
      return because(why, `choose: go with chance ${p}`, { type: 'choose', seat, suit: rand() < p ? best : null })
    }
    case 'play':
      return { type: 'play', seat, card: choosePlayCard(s, rand, profile, opt, why) }
    default:
      throw new Error(`heuristic cannot decide ${first.type}`)
  }
}

// ---- Algorithm -------------------------------------------------------------------

/**
 * The hand-written bot as algorithm `heuristic:<level>`. It decides every real
 * decision (bids, troefke, the dealer's choice, card play) from the
 * observation only. Options override the level's values (`LEVEL_OPTIONS`
 * over `HEURISTIC_DEFAULTS`). Option `skill` overrides the profile's skill:
 * an anchor with `skill: 1` never plays a lazy dump (#183). It is not a
 * tuning constant, so it stays out of `HEURISTIC_DEFAULTS`.
 */
export function createHeuristic(variant: string | undefined, options: Record<string, unknown>): Algorithm {
  if (!BOT_LEVELS.includes(variant as BotLevel)) throw new Error(`unknown heuristic level: ${variant}`)
  const { skill, ...constants } = options
  if (skill !== undefined && (typeof skill !== 'number' || !(skill >= 0 && skill <= 1)))
    throw new Error('heuristic option skill must be a number in [0, 1]')
  for (const [k, v] of Object.entries(constants)) {
    if (!Object.hasOwn(HEURISTIC_DEFAULTS, k)) throw new Error(`unknown heuristic option: ${k}`)
    // A string from a JSON file would turn the sums into string concatenation.
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`heuristic option ${k} must be a number`)
  }
  const level = BOT_PROFILES[variant as BotLevel]
  const profile: BotProfile = skill === undefined ? level : { ...level, skill }
  const opt: HeuristicOptions = { ...levelOptions(variant as BotLevel), ...constants }
  return {
    id: `heuristic:${variant}`,
    supports: () => true,
    decide(obs: Observation, rand: () => number, trace?: BotTrace): Action {
      const why: string[] = []
      const a = decide(obs, rand, profile, opt, why)
      trace?.notes.push(...why)
      return a
    },
  }
}
