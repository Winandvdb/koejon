import {
  clientState,
  fullDeck,
  RANK_ORDER,
  sameCard,
  teamOf,
  trickWinnerIndex,
} from '../engine'
import type { Card, DealerDraw, State, Suit, TrickCard } from '../engine'
import type { Observation } from './observation'

/** Tries before a sampler gives up: a failure then means the constraints
 *  contradict each other (a bug), never bad luck. */
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
function playedCards(obs: Observation): TrickCard[] {
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
 * to the other seats within the voids their plays revealed. The most
 * constrained seat is served first; a random restart repairs the rare dead
 * end.
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
  if (need.some((n) => n < 0)) {
    throw new Error('sampleWorld: the observation fixes more cards than a hand can hold')
  }
  const voids = voidSuits(played, obs.trump)
  const pool = fullDeck().filter((c) => !taken.has(key(c)))
  const seats = [0, 1, 2, 3].filter((i) => need[i] > 0)
  for (let tries = 0; tries < MAX_TRIES; tries++) {
    const order = take(seats, seats.length, rand).sort((a, b) => voids[b].size - voids[a].size)
    let rest = pool
    let stuck = false
    const drew: Card[][] = [[], [], [], []]
    for (const i of order) {
      const allowed = rest.filter((c) => !voids[i].has(c.s))
      if (allowed.length < need[i]) {
        stuck = true
        break
      }
      const got = take(allowed, need[i], rand)
      const drop = new Set(got.map(key))
      rest = rest.filter((c) => !drop.has(key(c)))
      drew[i] = got
    }
    if (!stuck) {
      for (const i of seats) hands[i].push(...drew[i])
      return hands
    }
  }
  throw new Error(`sampleWorld: no deal fits the constraints after ${MAX_TRIES} tries`)
}

/**
 * A dealer-draw deck that shows the cards already lifted at their places.
 * The order around them is neutral — nobody ever saw the deck.
 */
function drawDeck(dd: DealerDraw, rand: () => number): Card[] {
  const at = new Map<number, Card>()
  if (dd.packetA !== null && dd.draws.length > 0) {
    at.set(dd.packetA - 1, dd.draws[0].card)
    if (dd.draws.length > 1) {
      // Team B's packet size is not public: any lift in its range explains the card.
      const max = 24 - dd.packetA - 4
      const n = 4 + Math.floor(rand() * (max - 3))
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
  if (s.dealerDraw) s.dealerDraw.deck = drawDeck(s.dealerDraw, rand)
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
 * plays can steer the sample without changing callers. All randomness
 * comes from `rand` — the same seed gives the same world.
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
