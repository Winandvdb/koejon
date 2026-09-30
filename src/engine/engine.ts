import { fullDeck, RANK_ORDER, RANK_POINTS, sameCard, trickPoints, trickWinnerIndex } from './cards'
import { rngRange, rngShuffle } from './rng'
import type { Action, BoomkeMark, Card, DealerDraw, State, Suit, TrickCard } from './types'
import { START_LINES } from './types'

const freshMarks = (): BoomkeMark[] =>
  [0, 1].flatMap((team) =>
    Array.from({ length: START_LINES }, () => ({ team, t: 'line' as const, crossed: false, batch: 0 })),
  )

export class IllegalActionError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'IllegalActionError'
  }
}

const teamOf = (seat: number) => seat % 2
const leftOf = (seat: number) => (seat + 1) % 4

/**
 * Create a fresh match in phase LOBBY.
 * `drawers` optionally fixes which seat draws for each team
 * (default: lowest seat of each team).
 */
export function createMatch(seed: number, drawers?: [number, number]): State {
  return {
    phase: 'LOBBY',
    rng: seed | 0,
    seed: seed | 0,
    handNumber: 0,
    dealer: 0,
    dealerDraw: {
      drawer: drawers ?? [0, 1],
      draws: [],
      packetA: null,
      pending: 0,
      winnerSeat: null,
    },
    hands: [[], [], [], []],
    turned: null,
    trump: null,
    level: 0,
    multiplier: 1,
    bidder: null,
    bidIndex: 0,
    turn: 0,
    leader: 0,
    trick: [],
    lastTrick: null,
    prevTrick: null,
    trickAcks: [],
    troefkeAsked: false,
    tricksPlayed: 0,
    tricksWon: [0, 0],
    points: [0, 0],
    lines: [START_LINES, START_LINES],
    marks: freshMarks(),
    koeien: [0, 0],
    lastResult: null,
    winner: null,
    log: [],
  }
}

function pushLog(s: State, ev: { t: string } & Record<string, unknown>): void {
  s.log.push(ev as State['log'][number])
  if (s.log.length > 60) s.log.splice(0, s.log.length - 60)
}

/** Seats that currently have at least one legal action. */
export function pendingSeats(s: State): number[] {
  switch (s.phase) {
    case 'LOBBY':
      return [0, 1, 2, 3]
    case 'DEALER_DRAW': {
      const dd = s.dealerDraw!
      if (dd.pending === 2) return [dd.winnerSeat!]
      return [dd.drawer[dd.pending]]
    }
    case 'DEALING':
      return [s.dealer]
    case 'BIDDING_R1':
    case 'BIDDING_R2':
      return [(s.dealer + 1 + s.bidIndex) % 4]
    case 'DEALER_CHOICE':
      return [s.dealer]
    case 'PLAYING':
      // All seats confirm the dealer's cards before the first lead, and
      // a completed trick stays until every seat has confirmed it too.
      if (s.trickAcks.length < 4)
        return [0, 1, 2, 3].filter((x) => !s.trickAcks.includes(x))
      return [s.turn]
    case 'SCORED':
      return [0, 1, 2, 3]
    case 'GAME_OVER':
      return []
  }
}

/** Cards of `seat`'s hand that may legally be played right now. */
export function legalCards(s: State, seat: number): Card[] {
  if (s.phase !== 'PLAYING' || s.turn !== seat) return []
  const hand = s.hands[seat]
  if (s.trick.length === 0) return hand
  const trump = s.trump!
  const led = s.trick[0].card.s
  if (led === trump) {
    const trumps = hand.filter((c) => c.s === trump)
    return trumps.length > 0 ? trumps : hand
  }
  const follow = hand.filter((c) => c.s === led)
  if (follow.length === 0) return hand
  // No underbuy: a trump is only legal here if it beats the highest trump in the trick.
  let highestTrump = 0
  for (const tc of s.trick) {
    if (tc.card.s === trump && RANK_ORDER[tc.card.r] > highestTrump) {
      highestTrump = RANK_ORDER[tc.card.r]
    }
  }
  const overTrumps = hand.filter((c) => c.s === trump && RANK_ORDER[c.r] > highestTrump)
  return [...follow, ...overTrumps]
}

/** Suits the dealer may pick in DEALER_CHOICE (distinct suits of the shown cards). */
export function choiceSuits(s: State): Suit[] {
  const t = s.turned!
  const suits: Suit[] = [t.first.s]
  if (t.secondUp && t.second.s !== t.first.s) suits.push(t.second.s)
  return suits
}

export function legalActions(s: State, seat: number): Action[] {
  const out: Action[] = []
  switch (s.phase) {
    case 'LOBBY':
      out.push({ type: 'start', seat })
      break
    case 'DEALER_DRAW': {
      const dd = s.dealerDraw!
      if (dd.pending === 2) {
        if (seat === dd.winnerSeat) {
          for (let d = 0; d < 4; d++) out.push({ type: 'chooseDealer', seat, dealer: d })
        }
      } else if (seat === dd.drawer[dd.pending]) {
        out.push({ type: 'draw', seat })
      }
      break
    }
    case 'DEALING':
      if (seat === s.dealer) out.push({ type: 'deal', seat })
      break
    case 'BIDDING_R1':
    case 'BIDDING_R2':
      if (seat === (s.dealer + 1 + s.bidIndex) % 4) {
        out.push({ type: 'bid', seat, play: true }, { type: 'bid', seat, play: false })
      }
      break
    case 'DEALER_CHOICE':
      if (seat === s.dealer) {
        for (const suit of choiceSuits(s)) out.push({ type: 'choose', seat, suit })
        out.push({ type: 'choose', seat, suit: null })
      }
      break
    case 'PLAYING':
      if (s.trickAcks.length < 4) {
        if (!s.trickAcks.includes(seat)) out.push({ type: 'ack', seat })
      } else if (seat === s.turn) {
        for (const card of legalCards(s, seat)) out.push({ type: 'play', seat, card })
      }
      // "Troefke": the bidder may ask their partner to open with trump while
      // the partner's first lead is still pending — it may be ignored.
      if (
        s.bidder === seat &&
        s.turn === (s.bidder + 2) % 4 &&
        s.tricksPlayed === 0 &&
        s.trick.length === 0 &&
        !s.troefkeAsked
      ) {
        out.push({ type: 'troefke', seat })
      }
      break
    case 'SCORED':
      out.push({ type: 'next', seat })
      break
    case 'GAME_OVER':
      break
  }
  return out
}

function actionIsLegal(s: State, a: Action): boolean {
  return legalActions(s, a.seat).some((la) => {
    if (la.type !== a.type) return false
    if (a.type === 'chooseDealer' && la.type === 'chooseDealer') return la.dealer === a.dealer
    if (a.type === 'bid' && la.type === 'bid') return la.play === a.play
    if (a.type === 'choose' && la.type === 'choose') return la.suit === a.suit
    if (a.type === 'play' && la.type === 'play') return sameCard(la.card, a.card)
    return true
  })
}

function doDeal(s: State): void {
  const deck = rngShuffle(s, fullDeck())
  const order = [leftOf(s.dealer), (s.dealer + 2) % 4, (s.dealer + 3) % 4, s.dealer]
  const hands: Card[][] = [[], [], [], []]
  let i = 0
  for (let round = 0; round < 3; round++) {
    for (const seat of order) {
      hands[seat].push(deck[i++], deck[i++])
    }
  }
  s.hands = hands
  const dh = hands[s.dealer]
  s.turned = { first: dh[5], second: dh[4], secondUp: false }
  s.trump = null
  s.level = 0
  s.bidder = null
  s.bidIndex = 0
  s.turn = leftOf(s.dealer)
  s.leader = s.turn
  s.trick = []
  s.lastTrick = null
  s.prevTrick = null
  // The first leader has "seen" the dealer's cards implicitly.
  s.trickAcks = [s.turn]
  s.troefkeAsked = false
  s.tricksPlayed = 0
  s.tricksWon = [0, 0]
  s.points = [0, 0]
  s.phase = 'BIDDING_R1'
  s.handNumber++
  pushLog(s, { t: 'deal', seat: s.dealer, card: s.turned.first })
}

function startPlaying(s: State, trump: Suit, level: 1 | 2, bidder: number): void {
  s.trump = trump
  s.level = level
  s.bidder = bidder
  s.leader = leftOf(s.dealer)
  s.turn = s.leader
  s.phase = 'PLAYING'
  pushLog(s, { t: 'play-call', seat: bidder, suit: trump })
}

function allPassed(s: State): void {
  pushLog(s, { t: 'all-pass', n: s.multiplier * 2 })
  s.multiplier *= 2
  s.dealer = leftOf(s.dealer)
  s.hands = [[], [], [], []]
  s.turned = null
  s.trump = null
  s.level = 0
  s.bidder = null
  s.bidIndex = 0
  s.trick = []
  s.lastTrick = null
  s.prevTrick = null
  s.phase = 'DEALING'
}

function resolveTrick(s: State): void {
  const wi = trickWinnerIndex(s.trick, s.trump!)
  const winner = s.trick[wi].seat
  const team = teamOf(winner)
  s.tricksWon[team]++
  s.points[team] += trickPoints(s.trick)
  s.tricksPlayed++
  s.prevTrick = s.lastTrick
  s.lastTrick = s.trick
  s.trick = []
  // The winner leads next — their card is the confirmation, no click needed.
  s.trickAcks = [winner]
  s.leader = winner
  s.turn = winner
  pushLog(s, { t: 'trick', seat: winner })
  if (s.tricksPlayed === 6) scoreHand(s)
}

function scoreHand(s: State): void {
  const playing = teamOf(s.bidder!)
  const defending = 1 - playing
  // Exactly 20-20 is a draw: nobody erases lines, no Koei is added, and the
  // stake on the next deal's first turned card doubles.
  const draw = s.points[playing] === 20
  const winner = draw ? defending : s.points[playing] > 20 ? playing : defending
  const kapot = !draw && s.tricksWon[winner] === 6
  const base = s.level === 1 ? s.multiplier : 2
  const erased = draw ? 0 : base + (kapot ? 1 : 0)
  const koei = !draw && winner === defending
  s.lines[winner] = Math.max(0, s.lines[winner] - erased)
  // Cross the `erased` marks, top ladder lines first; Koeis are crossed last.
  // Same batch keeps one scratch gesture.
  let toCross = erased
  for (let i = s.marks.length - 1; i >= 0 && toCross > 0; i--) {
    const m = s.marks[i]
    if (m.team === winner && m.t === 'line' && !m.crossed) {
      m.crossed = true
      m.batch = s.handNumber
      toCross--
    }
  }
  for (const m of s.marks) {
    if (toCross === 0) break
    if (m.team === winner && m.t === 'koei' && !m.crossed) {
      m.crossed = true
      m.batch = s.handNumber
      toCross--
    }
  }
  if (koei) {
    s.koeien[playing]++
    s.lines[playing]++
    s.marks.push({ team: playing, t: 'koei', crossed: false, batch: 0 })
  }
  s.lastResult = {
    playingTeam: playing,
    points: [...s.points],
    winnerTeam: winner,
    draw,
    erased,
    kapot,
    koei,
    level: s.level,
    multiplier: s.multiplier,
  }
  pushLog(s, draw ? { t: 'tied' } : { t: 'score', team: winner, n: erased })
  s.multiplier = draw ? s.multiplier * 2 : 1
  if (!draw && s.lines[winner] === 0) {
    s.winner = winner
    s.phase = 'GAME_OVER'
    pushLog(s, { t: 'game-over', team: winner })
  } else {
    s.phase = 'SCORED'
  }
}

function nextHand(s: State): void {
  s.dealer = leftOf(s.dealer)
  s.phase = 'DEALING'
}

/** Apply a validated action; returns a new state. Throws IllegalActionError. */
export function apply(state: State, action: Action): State {
  if (!actionIsLegal(state, action)) {
    throw new IllegalActionError(`illegal action ${action.type} for seat ${action.seat} in ${state.phase}`)
  }
  const s = structuredClone(state)
  switch (action.type) {
    case 'start':
      s.phase = 'DEALER_DRAW'
      pushLog(s, { t: 'start' })
      break
    case 'draw': {
      const dd = s.dealerDraw!
      const deck = rngShuffle(s, fullDeck())
      let card: Card
      if (dd.pending === 0) {
        // Team A packet: take [4,16] (leave >=8). Bottom card of packet is revealed.
        const k = rngRange(s, 4, 16)
        dd.packetA = k
        card = deck[k - 1]
        dd.draws = [{ seat: action.seat, card }]
        dd.pending = 1
      } else {
        // Team B draws from what remains of the same deck: take [4, remaining-4].
        const kA = dd.packetA!
        const remaining = 24 - kA
        const k = rngRange(s, 4, remaining - 4)
        card = deck[kA + k - 1]
        dd.draws.push({ seat: action.seat, card })
      }
      pushLog(s, { t: 'draw', seat: action.seat, card })
      if (dd.draws.length === 2) {
        const [a, b] = dd.draws
        if (RANK_ORDER[a.card.r] === RANK_ORDER[b.card.r]) {
          // Tie: both players redraw on a fresh deck.
          dd.draws = []
          dd.packetA = null
          dd.pending = 0
          pushLog(s, { t: 'draw-tie' })
        } else {
          dd.pending = 2
          dd.winnerSeat =
            RANK_ORDER[a.card.r] > RANK_ORDER[b.card.r] ? a.seat : b.seat
          pushLog(s, { t: 'draw-win', seat: dd.winnerSeat })
        }
      }
      break
    }
    case 'chooseDealer':
      s.dealer = action.dealer
      s.dealerDraw = null
      pushLog(s, { t: 'first-dealer', seat: action.dealer })
      s.phase = 'DEALING'
      break
    case 'deal':
      doDeal(s)
      break
    case 'bid': {
      if (action.play) {
        const suit = s.phase === 'BIDDING_R1' ? s.turned!.first.s : s.turned!.second.s
        startPlaying(s, suit, s.phase === 'BIDDING_R1' ? 1 : 2, action.seat)
      } else {
        pushLog(s, { t: 'pass', seat: action.seat })
        s.bidIndex++
        if (s.bidIndex === 3) {
          if (s.phase === 'BIDDING_R1') {
            s.turned!.secondUp = true
            pushLog(s, { t: 'second-card', card: s.turned!.second })
            s.bidIndex = 0
            s.phase =
              s.turned!.second.s === s.turned!.first.s ? 'DEALER_CHOICE' : 'BIDDING_R2'
          } else {
            s.bidIndex = 0
            s.phase = 'DEALER_CHOICE'
          }
        }
      }
      break
    }
    case 'choose': {
      if (action.suit === null) {
        pushLog(s, { t: 'dealer-pass', seat: action.seat })
        allPassed(s)
      } else {
        startPlaying(s, action.suit, 2, action.seat)
      }
      break
    }
    case 'play': {
      const hand = s.hands[action.seat]
      const idx = hand.findIndex((c) => sameCard(c, action.card))
      if (idx < 0) throw new IllegalActionError('card not in hand')
      hand.splice(idx, 1)
      s.trick.push({ seat: action.seat, card: action.card })
      pushLog(s, { t: 'card', seat: action.seat, card: action.card })
      if (s.trick.length === 4) {
        resolveTrick(s)
      } else {
        s.turn = (s.turn + 1) % 4
      }
      break
    }
    case 'ack':
      s.trickAcks.push(action.seat)
      break
    case 'troefke':
      s.troefkeAsked = true
      // Asking implies the bidder saw the dealer's cards.
      if (!s.trickAcks.includes(action.seat)) s.trickAcks.push(action.seat)
      pushLog(s, { t: 'troefke', seat: action.seat })
      break
    case 'next':
      nextHand(s)
      break
  }
  return s
}

/** True when `seat` may not look at their cards (dealer during bidding). */
export function handMasked(s: State, seat: number): boolean {
  return (
    seat === s.dealer &&
    (s.phase === 'BIDDING_R1' || s.phase === 'BIDDING_R2' || s.phase === 'DEALER_CHOICE')
  )
}

/** The hand a given seat is allowed to see; null means "all face down". */
export function visibleHand(s: State, seat: number): Card[] | null {
  if (s.hands[seat].length === 0) return []
  if (handMasked(s, seat)) return null
  return s.hands[seat]
}
