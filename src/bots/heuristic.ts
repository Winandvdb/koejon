import {
  RANK_ORDER,
  RANK_POINTS,
  RANKS,
  SUITS,
  teamOf,
  trickPoints,
  trickWinnerIndex,
} from '../engine'
import type { Action, Card, Rank, Suit, TrickCard } from '../engine'
import type { Algorithm, BotTrace } from './algorithm'
import type { Observation } from './observation'

const partnerOf = (seat: number) => (seat + 2) % 4
const oppSeatsOf = (seat: number) => [(seat + 1) % 4, (seat + 3) % 4]

// ---- Tunables --------------------------------------------------------------

export type BotLevel = 'easy' | 'normal' | 'hard'
export const BOT_LEVELS: BotLevel[] = ['easy', 'normal', 'hard']

export interface BotProfile {
  /** Share of card decisions that use the smart rule; the rest dump low. */
  skill: number
  /** What the bot remembers: nothing, trumps only, or trumps plus voids. */
  memory: 'none' | 'trumps' | 'full'
  /** Knijpen, troefke and dealer-choice weighing — beginners lack these. */
  tactics: boolean
}

export const BOT_PROFILES: Record<BotLevel, BotProfile> = {
  easy: { skill: 0.55, memory: 'none', tactics: false },
  normal: { skill: 0.8, memory: 'trumps', tactics: true },
  hard: { skill: 0.95, memory: 'full', tactics: true },
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
  /** A suit with fewer cards than this outside our hand likely has a void. */
  shortSuit: number
}

export const HEURISTIC_DEFAULTS: Readonly<HeuristicOptions> = {
  bidThreshold1: 11,
  bidThreshold2: 8,
  bidThreshold4: 7,
  betterSuit: 2,
  clearBid: 3,
  loneTrumpMin: 13,
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
  shortSuit: 3,
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
}

/**
 * Human-like memory rebuilt from the public log: which trumps are gone and who
 * has shown out of a suit. Side-suit ranks are deliberately not counted (only
 * how many of a suit fell), so the bot still misjudges some tricks — like a
 * human does.
 */
function readHand(s: Observation, memory: BotProfile['memory']): HandRead {
  const trump = s.trump!
  const trumpsGone = new Set<Rank>()
  const voids = new Set<string>()
  const suitSeen: Record<Suit, number> = { S: 0, H: 0, D: 0, C: 0 }
  if (memory !== 'none') {
    // Cards played this hand: 4 per finished trick plus the open one.
    const want = s.tricksPlayed * 4 + s.trick.length
    const played: TrickCard[] = []
    for (let i = s.log.length - 1; i >= 0 && played.length < want; i--) {
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
      for (const tc of played) suitSeen[tc.card.s]++
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
  return { trumpsGone, trumpsOut: 6 - trumpsGone.size - mine.length, bossOut, voids, suitSeen }
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

/** Ask for the trump lead only when our trumps can take over afterwards. */
function wantsTroefke(s: Observation, rand: () => number, opt: HeuristicOptions): boolean {
  const trumps = s.hand.filter((c) => c.s === s.trump)
  const strong =
    trumps.length >= 3 ||
    (trumps.length >= 2 && trumps.some((c) => RANK_ORDER[c.r] >= RANK_ORDER['K']))
  return strong && rand() < opt.troefkeChance
}

// ---- Card play -----------------------------------------------------------------

function leadCard(s: Observation, legal: Card[], read: HandRead, opt: HeuristicOptions, why: string[]): Card {
  const seat = s.seat
  const trump = s.trump!
  const myTeam = teamOf(seat)
  const trumps = legal.filter((c) => c.s === trump)
  const oppVoid = (suit: Suit) => oppSeatsOf(seat).some((o) => read.voids.has(`${o}:${suit}`))
  // An opponent can trump a suit when they may still hold trump and either
  // showed out of it or the suit ran short outside our hand.
  const trumpable = (suit: Suit) => {
    const outside = 6 - s.hand.filter((c) => c.s === suit).length - read.suitSeen[suit]
    return oppSeatsOf(seat).some(
      (o) =>
        mayHoldTrump(read, o, trump) &&
        (read.voids.has(`${o}:${suit}`) || outside < opt.shortSuit),
    )
  }

  // Honour the partner's troefke request: open with the best trump.
  if (
    s.troefkeAsked &&
    s.tricksPlayed === 0 &&
    seat === partnerOf(s.bidder!) &&
    trumps.length > 0
  ) {
    return because(why, 'troefke: lead the best trump', highest(trumps))
  }
  // Protect a live sweep: lead the surest winner first.
  if (s.tricksPlayed > 0 && s.tricksWon[myTeam] === s.tricksPlayed) {
    const boss = bossTrump(trumps, read)
    if (boss) return because(why, 'sweep: boss trump', boss)
    const ace = legal.find((c) => c.r === 'A' && c.s !== trump && !trumpable(c.s))
    if (ace) return because(why, 'sweep: safe ace', ace)
    return because(why, 'sweep: highest card', highest(legal))
  }
  const playing = teamOf(s.bidder!) === myTeam
  const boss = bossTrump(trumps, read)
  // Both opponents showed out of trump: whatever trumps are left belong to the
  // partner, and pulling only strips our own side.
  const oppMayTrump = oppSeatsOf(seat).some((o) => mayHoldTrump(read, o, trump))
  // Pull trumps when we hold the boss and others still hold trumps. Defenders
  // pull only when they hold the majority of what is left.
  if (boss && read.trumpsOut > 0 && oppMayTrump && (playing || trumps.length > read.trumpsOut))
    return because(why, 'pull trumps with the boss', boss)
  // Length pull: with enough trumps a low one still draws enemy trumps.
  if (playing && oppMayTrump && trumps.length >= 3 && read.trumpsOut >= 2)
    return because(why, 'length pull: low trump', lowest(trumps))
  // Cash an ace only where no opponent can trump it; else keep it for later.
  const aces = legal.filter((c) => c.r === 'A' && c.s !== trump && !trumpable(c.s))
  if (aces.length) return because(why, 'cash a safe ace', highest(aces))
  // Otherwise a low card from a suit nobody is known void in.
  const plain = legal.filter((c) => c.s !== trump)
  const pool = plain.length ? plain : legal
  const safe = pool.filter((c) => !oppVoid(c.s) && !read.voids.has(`${partnerOf(seat)}:${c.s}`))
  const ok = safe.length ? safe : pool.filter((c) => !oppVoid(c.s))
  return because(why, 'low lead', lowest(ok.length ? ok : pool))
}

function followCard(s: Observation, legal: Card[], read: HandRead, opt: HeuristicOptions, why: string[]): Card {
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

  if (partnerWinning) {
    // Vet the trick — never overtake, and mind who can still beat partner.
    const safe = noUndertrump(
      s.trick,
      legal.filter((c) => !wouldWin(s.trick, seat, c, trump)),
      trump,
    )
    if (safe.length === 0) return because(why, 'forced to overtake partner', cheapest(legal, trump))
    const pts = safe.filter((c) => RANK_POINTS[c.r] > 0)
    if (pts.length === 0) return because(why, 'partner wins: no points to feed', lowest(safe))
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
      return because(why, 'partner safe: feed points', highestPoint(nonAce.length ? nonAce : pts))
    }
    // Partner's win is not sealed: feed only cheap points.
    const cheap = pts.filter((c) => RANK_POINTS[c.r] <= opt.vetMaxRisk)
    return because(why, 'partner not safe: feed cheap points', cheap.length ? highestPoint(cheap) : lowest(safe))
  }

  // Opponent winning: fight for rich tricks, duck the rest.
  const winners = legal.filter((c) => wouldWin(s.trick, seat, c, trump))
  if (winners.length === 0) return because(why, 'cannot win: dump', dump(s.trick, seat, legal, trump))
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
  const worthIt =
    (tPts > 0 && doomed) ||
    s.points[myTeam] + tPts >= 21 || // win the hand outright
    s.points[1 - myTeam] + tPts >= 21 || // deny them the hand
    sweep ||
    antiKapot ||
    tPts >= opt.contestMin ||
    (tPts >= 3 && winCost(cheapestWin, trump) <= opt.cheapWin)
  return worthIt
    ? because(why, `contest: ${tPts} points in the trick`, cheapestWin)
    : because(why, 'not worth it: dump', dump(s.trick, seat, legal, trump))
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
    s.trick.length === 0 ? leadCard(s, legal, read, opt, why) : followCard(s, legal, read, opt, why)
  // Imperfect on purpose: sometimes fall back to a lazy dump.
  if (rand() < profile.skill) return smart
  // The smart rule did not decide, so its reason stays out of the trace.
  why.length = 0
  return because(why, 'lazy dump', dump(s.trick, s.seat, legal, s.trump!))
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
      const threshold =
        stakes >= 4 ? opt.bidThreshold4 : stakes >= 2 ? opt.bidThreshold2 : opt.bidThreshold1
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
        `bid: rating ${rating} vs threshold ${threshold}` +
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
 * observation only. Options override `HEURISTIC_DEFAULTS`.
 */
export function createHeuristic(variant: string | undefined, options: Record<string, unknown>): Algorithm {
  if (!BOT_LEVELS.includes(variant as BotLevel)) throw new Error(`unknown heuristic level: ${variant}`)
  for (const [k, v] of Object.entries(options)) {
    if (!Object.hasOwn(HEURISTIC_DEFAULTS, k)) throw new Error(`unknown heuristic option: ${k}`)
    // A string from a JSON file would turn the sums into string concatenation.
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`heuristic option ${k} must be a number`)
  }
  const profile = BOT_PROFILES[variant as BotLevel]
  const opt: HeuristicOptions = { ...HEURISTIC_DEFAULTS, ...options }
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
