import {
  clientState,
  fullDeck,
  RANK_ORDER,
  sameCard,
  SUITS,
  teamOf,
  trickWinnerIndex,
} from '../engine'
import type { Card, State, Suit, TrickCard } from '../engine'
import type { Observation } from './observation'

/** Worlds a `weight` may reject before the sampler keeps the last one. */
const MAX_TRIES = 50

const key = (c: Card): string => c.s + c.r

const clamp01 = (w: number): number => Math.min(1, Math.max(0, w))

/** `n` uniform draws without replacement from `items` (a shuffle of a copy). */
function take<T>(items: T[], n: number, rand: () => number): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a.slice(0, n)
}

/**
 * Cards played this hand, in play order with their seats. The running
 * hand's 'card' events sit in the log after its last 'deal' event: a hand
 * stays far under the 60-event cap, so none are lost. A state built by
 * hand may carry no log; then the three visible tricks are all that can
 * be known.
 */
export function playedCards(obs: Observation): TrickCard[] {
  for (let i = obs.log.length - 1; i >= 0; i--) {
    if (obs.log[i].t === 'deal') {
      const out: TrickCard[] = []
      for (const e of obs.log.slice(i + 1)) {
        if (e.t === 'card') out.push({ seat: e.seat!, card: e.card! })
      }
      return out
    }
  }
  return [...(obs.prevTrick ?? []), ...(obs.lastTrick ?? []), ...obs.trick]
}

/**
 * Suits each seat is known to be out of, read off the trick history. The
 * rule is `legalCards`' own: while a seat still holds the led suit it may
 * only follow it or play a trump over the trumps already down. Any other
 * card it played proves the void — also under a trump lead, where every
 * trump is legal and only a non-trump shows it.
 */
function voidSuits(played: TrickCard[], trump: Suit | null): Set<Suit>[] {
  const out = [new Set<Suit>(), new Set<Suit>(), new Set<Suit>(), new Set<Suit>()]
  for (let i = 0; i + 1 < played.length; i += 4) {
    const led = played[i].card.s
    let top = played[i].card.s === trump ? RANK_ORDER[played[i].card.r] : 0
    for (let p = 1; p < 4 && i + p < played.length; p++) {
      const { seat, card } = played[i + p]
      if (card.s !== led && !(card.s === trump && RANK_ORDER[card.r] > top)) out[seat].add(led)
      if (card.s === trump) top = Math.max(top, RANK_ORDER[card.r])
    }
  }
  return out
}

/**
 * Fill the hands nobody may see. Own hand, the played cards and the turned
 * cards still at the dealer's seat are fixed; the rest of the deck is dealt
 * to the other seats within the voids their plays revealed. The deal goes
 * card by card; each card picks a seat by its free places (without voids
 * that is a fair deal), among the `seatsThatFit`: the seats after which
 * the other cards can still fill the hands. So a deal never runs into a
 * dead end.
 */
function hiddenHands(obs: Observation, played: TrickCard[], rand: () => number): Card[][] {
  const taken = new Set<string>()
  for (const c of obs.hand) taken.add(key(c))
  for (const tc of played) taken.add(key(tc.card))
  // The turned cards count as the dealer's hand until the dealer plays them.
  const must: Card[][] = [[], [], [], []]
  for (const c of [obs.turned?.first, obs.turned?.second]) {
    if (c && !taken.has(key(c))) {
      must[obs.dealer].push(c)
      taken.add(key(c))
    }
  }
  const hands = [0, 1, 2, 3].map((i) => [...(i === obs.seat ? obs.hand : []), ...must[i]])
  const need = obs.handCounts.map((n, i) => n - hands[i].length)
  const voids = voidSuits(played, obs.trump)
  const pool = fullDeck().filter((c) => !taken.has(key(c)))
  // Seat 4 sets aside the cards no hand gets: without a log, the cards
  // played before the visible tricks are unknown and stay in the pool.
  const free = [...need, pool.length - need.reduce((a, b) => a + b, 0)]
  const holders = { S: 0, H: 0, D: 0, C: 0 }
  const left = { S: 0, H: 0, D: 0, C: 0 }
  for (const s of SUITS) {
    for (let i = 0; i < 5; i++) if (i === 4 || !voids[i].has(s)) holders[s] |= 1 << i
  }
  for (const c of pool) left[c.s]++
  const noDeal = () => new Error('sampleWorld: no deal fits the observation (a bug in the constraints)')
  if (free.some((n) => n < 0)) throw noDeal()
  const drew: Card[][] = [[], [], [], [], []]
  for (const c of pool) {
    // Each placement keeps the rest fitting, so only the first card can
    // find no seat: then the observation contradicts itself.
    const seats = seatsThatFit(c.s, free, left, holders)
    if (seats === 0) throw noDeal()
    let r = 0
    for (let i = 0; i < 5; i++) if (seats & (1 << i)) r += free[i]
    r *= rand()
    let seat = 0
    for (let i = 0; i < 5; i++) {
      if (!(seats & (1 << i))) continue
      seat = i
      r -= free[i]
      if (r < 0) break
    }
    left[c.s]--
    free[seat]--
    drew[seat].push(c)
  }
  for (let i = 0; i < 4; i++) hands[i].push(...drew[i])
  return hands
}

/**
 * The seats (a bit mask) where a card of `suit` may go so that the cards
 * `left` still fill every `free` place; 0 when they cannot fill them at
 * all. `holders` has a bit per seat that may hold a suit. Hall's condition:
 * each group of seats needs at least as many cards it may hold as free
 * places, which is enough with as many cards as places in all. A group at
 * that limit that may hold this card must get it, or it falls short.
 */
function seatsThatFit(
  suit: Suit,
  free: number[],
  left: Record<Suit, number>,
  holders: Record<Suit, number>,
): number {
  let seats = holders[suit]
  for (let i = 0; i < free.length; i++) if (free[i] === 0) seats &= ~(1 << i)
  for (let group = 1; group < 1 << free.length; group++) {
    let places = 0
    for (let i = 0; i < free.length; i++) if (group & (1 << i)) places += free[i]
    let cards = 0
    for (const s of SUITS) if (holders[s] & group) cards += left[s]
    if (places > cards) return 0
    if (places === cards && holders[suit] & group) seats &= group
  }
  return seats
}

/**
 * A dealer-draw deck that shows the cards already lifted at their places.
 * The order around them is neutral — nobody ever saw the deck.
 */
function drawDeck(obs: Observation, rand: () => number): Card[] {
  const dd = obs.dealerDraw!
  const at = new Map<number, Card>()
  if (dd.packetA !== null && dd.draws.length > 0) {
    at.set(dd.packetA - 1, dd.draws[0].card)
    if (dd.draws.length > 1) {
      // The log tells how many cards team B lifted; without it any lift in
      // its range explains the card.
      let n = 0
      for (let i = obs.log.length - 1; i >= 0; i--) {
        if (obs.log[i].t === 'draw') {
          n = obs.log[i].n ?? 0
          break
        }
      }
      if (n === 0) n = 4 + Math.floor(rand() * (24 - dd.packetA - 7))
      at.set(dd.packetA + n - 1, dd.draws[1].card)
    }
  }
  const rest = take(
    fullDeck().filter((c) => ![...at.values()].some((k) => sameCard(k, c))),
    24 - at.size,
    rand,
  )
  const deck: Card[] = []
  for (let i = 0; i < 24; i++) deck.push(at.get(i) ?? rest.pop()!)
  return deck
}

function hiddenWorld(obs: Observation, rand: () => number): State {
  const played = playedCards(obs)
  const s = clientState(obs, obs.seat, obs.hand)
  s.hands = hiddenHands(obs, played, rand)
  // Neutral values for the hidden fields the rest of the hand does not
  // need: the match seed is gone and `rng` gets a fresh throw, so the world
  // still shuffles its trick piles like the engine does.
  s.seed = 0
  s.rng = (rand() * 0x80000000) | 0
  // The piles hold this hand's finished tricks, shuffled. Their order only
  // decides the next deal; the contents are known, so keep them.
  if (obs.trump) {
    for (let i = 0; i + 4 <= played.length; i += 4) {
      const trick = played.slice(i, i + 4)
      const winner = teamOf(trick[trickWinnerIndex(trick, obs.trump)].seat)
      s.piles[winner].push(...take(trick.map((tc) => tc.card), 4, rand))
    }
  }
  // A hand nobody played — all passed, or not dealt yet — leaves its cards
  // thrown in on pile 0 (or still fresh out of the box). Nobody saw them,
  // so any 24 do: without them `doDeal` would deal `undefined` cards.
  if (played.length === 0 && obs.handCounts.every((n) => n === 0)) {
    s.piles[0] = take(fullDeck(), 24, rand)
  }
  if (obs.turned) {
    const { first, second, secondUp } = obs.turned
    // second === null means still face down: any card of the dealer's,
    // played or not, can be it.
    let faceDown = second
    if (faceDown === null) {
      const candidates = [
        ...s.hands[obs.dealer],
        ...played.filter((tc) => tc.seat === obs.dealer).map((tc) => tc.card),
      ].filter((c) => !sameCard(c, first))
      faceDown = candidates.length ? candidates[Math.floor(rand() * candidates.length)] : first
    }
    s.turned = { first, second: faceDown, secondUp }
  }
  if (s.dealerDraw) s.dealerDraw.deck = drawDeck(obs, rand)
  return s
}

/**
 * A full engine `State` that fits `obs`: the seat's own hand, the played
 * cards and the revealed voids are kept and the unseen cards are dealt to
 * the other hands at random. Search algorithms roll these determinizations
 * forward with `apply`/`legalActions`.
 *
 * `weight` optionally scores a world: a draw is kept with probability
 * `weight(world)` (clamped to [0,1]), so later inference from bids and
 * plays can steer the sample without changing callers. A run of
 * rejections still ends in a world — possibly one the weight scored low —
 * because the caller always needs one. Hidden fields the rest of the hand
 * does not need get neutral values: `seed`, `rng`, pile order, the draw
 * deck. All randomness comes from `rand` — the same seed gives the same
 * world.
 *
 * Like the observation, a world shares arrays (`trick`, `log`, `marks`, …)
 * with the live engine state: change it only through `apply`, which clones.
 */
export function sampleWorld(
  obs: Observation,
  rand: () => number,
  weight?: (world: State) => number,
): State {
  let world = hiddenWorld(obs, rand)
  for (let tries = 1; weight && tries < MAX_TRIES && rand() >= clamp01(weight(world)); tries++) {
    world = hiddenWorld(obs, rand)
  }
  return world
}
