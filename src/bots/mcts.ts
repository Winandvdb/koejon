import { RANKS, SUITS, teamOf } from '../engine'
import type { Action, Card, Phase, State, Turned } from '../engine'
import type { Algorithm, BotTrace } from './algorithm'
import { troefkeHand, troefkeLead, troefkeWeight } from './conventions'
import { sampleWorld } from './determinize'
import type { Observation } from './observation'
import { cardIndex, maskOf, POINTS_OF, RANK_OF, SUIT_MASK, SUIT_OF } from './solver'
import { handValue } from './value'

/** Iterations per decision when the spec names no `iterations`. */
export const MCTS_ITERATIONS = 1000
/** UCB1 exploration constant for rewards in [0, 1] when the spec names no `c`. */
export const MCTS_C = 0.7
/** Worlds of `mcts` when the spec names no `worlds`; the iterations are split over them. */
export const MCTS_WORLDS = 10
/**
 * MAST temperature: a playout picks a move with weight exp(average / τ), the
 * average reward in [0, 1] of that move by that seat in this decision.
 * CadiaPlayer's τ = 10 for rewards 0..100.
 */
const MAST_TAU = 0.1

// ---- One hand, fast ----------------------------------------------------------
//
// The tree and the playouts roll a hand forward thousands of times per
// decision: the engine's `apply` (a structured clone and a legality check per
// action) is far too slow for that. `Hand` plays the same rules on bitmasks:
// the solver's cards, a hand is a 24-bit mask. `tests/mcts.test.ts` plays
// random hands on both and compares them.

const cardsOf = (mask: number): Card[] => {
  const out: Card[] = []
  for (let m = mask; m; m &= m - 1) {
    const c = 31 - Math.clz32(m & -m)
    out.push({ s: SUITS[SUIT_OF[c]], r: RANKS[RANK_OF[c]] })
  }
  return out
}

// Moves: a card is its index; the other moves follow the cards.
export const PASS = 24
export const GO = 25
/** The dealer passes in the dealer's choice: all passed. */
export const CHOOSE_NONE = 26
/** The dealer's choice of a suit: `CHOOSE + suit index`. */
export const CHOOSE = 27
export const ACK = 31
export const TROEFKE = 32
/**
 * The bids of round 2 carry the suit of the second card: in a tree over
 * worlds where it was still face down at the root, a pass or a bid on
 * hearts and one on diamonds are different moves, as at the table.
 */
export const PASS_R2 = 33
export const GO_R2 = 37
const MOVES = 41

const R1 = 0
const R2 = 1
const CHOICE = 2
/** The bidder decides the troefke before its partner leads. */
const ASK = 3
const PLAY = 4
const DONE = 5

/** The largest `handValue`: the defenders win a kapot at stake 2 and give the bidders a koei. */
const MAX_VALUE = 4

/** The rest of one hand, from a bid on, for a world where all hands are known. */
export interface Hand {
  phase: number
  hands: number[]
  dealer: number
  bidIndex: number
  /** The turned cards. */
  first: number
  second: number
  multiplier: number
  lines: [number, number]
  trump: number
  level: number
  bidder: number
  troefke: boolean
  turn: number
  trick: number[]
  points: [number, number]
  won: [number, number]
  played: number
  /** The hand's value for team 0 once it is DONE (`handValue`). */
  value: number
}

/** The hand of `world`: a sampled world, in a bidding phase or PLAYING. */
export function handOf(world: State): Hand {
  const phases: Partial<Record<State['phase'], number>> = {
    BIDDING_R1: R1,
    BIDDING_R2: R2,
    DEALER_CHOICE: CHOICE,
    PLAYING: PLAY,
  }
  let phase = phases[world.phase]
  if (phase === undefined) throw new Error(`mcts has no hand to play in ${world.phase}`)
  const bidder = world.bidder ?? -1
  // The bidder still decides the troefke when it has not confirmed the
  // dealer's cards yet: a bot only acts while it is pending.
  if (
    phase === PLAY &&
    troefkeHand(world.hands[bidder], world.trump!) &&
    !world.troefkeAsked &&
    world.tricksPlayed === 0 &&
    world.trick.length === 0 &&
    world.turn === (bidder + 2) % 4 &&
    !world.trickAcks.includes(bidder)
  )
    phase = ASK
  return {
    phase,
    hands: world.hands.map(maskOf),
    dealer: world.dealer,
    bidIndex: world.bidIndex,
    first: world.turned ? cardIndex(world.turned.first) : -1,
    second: world.turned ? cardIndex(world.turned.second) : -1,
    multiplier: world.multiplier,
    lines: [world.lines[0], world.lines[1]],
    trump: world.trump ? SUITS.indexOf(world.trump) : -1,
    level: world.level,
    bidder,
    troefke: world.troefkeAsked,
    turn: world.turn,
    trick: world.trick.map((tc) => cardIndex(tc.card)),
    points: [world.points[0], world.points[1]],
    won: [world.tricksWon[0], world.tricksWon[1]],
    played: world.tricksPlayed,
    value: 0,
  }
}

function copyHand(h: Hand): Hand {
  return {
    ...h,
    hands: [...h.hands],
    lines: [h.lines[0], h.lines[1]],
    trick: [...h.trick],
    points: [h.points[0], h.points[1]],
    won: [h.won[0], h.won[1]],
  }
}

/** The seat to move. */
export function moverOf(h: Hand): number {
  switch (h.phase) {
    case R1:
    case R2:
      return (h.dealer + 1 + h.bidIndex) & 3
    case CHOICE:
      return h.dealer
    case ASK:
      return h.bidder
    default:
      return h.turn
  }
}

/** Does card `c` beat card `best` with trump suit `trump`? */
function beats(c: number, best: number, trump: number): boolean {
  if (SUIT_OF[c] === trump) return SUIT_OF[best] !== trump || RANK_OF[c] > RANK_OF[best]
  return SUIT_OF[best] !== trump && SUIT_OF[c] === SUIT_OF[best] && RANK_OF[c] > RANK_OF[best]
}

/** Cards the seat to move may play, as `legalCards` in the engine, and the troefke convention. */
function cardMask(h: Hand): number {
  const hand = h.hands[h.turn]
  const trumps = hand & SUIT_MASK[h.trump]
  const n = h.trick.length
  if (n === 0) {
    // The bidder's partner obeys the troefke with a trump lead (`troefkeLead`).
    const obeys = h.troefke && h.played === 0 && h.turn === ((h.bidder + 2) & 3)
    return obeys && trumps ? trumps : hand
  }
  const led = SUIT_OF[h.trick[0]]
  if (led === h.trump) return trumps || hand
  const follow = hand & SUIT_MASK[led]
  if (follow === 0) return hand
  // No underbuy: a trump only counts when it beats the trumps already down.
  let top = -1
  for (let i = 1; i < n; i++) if (SUIT_OF[h.trick[i]] === h.trump && RANK_OF[h.trick[i]] > top) top = RANK_OF[h.trick[i]]
  return follow | ((trumps >> (6 * h.trump + top + 1)) << (6 * h.trump + top + 1))
}

/** The legal moves of the seat to move, into `out` (cleared first). */
export function movesOf(h: Hand, out: number[]): number[] {
  out.length = 0
  switch (h.phase) {
    case R1:
      out.push(GO, PASS)
      break
    case R2:
      out.push(GO_R2 + SUIT_OF[h.second], PASS_R2 + SUIT_OF[h.second])
      break
    case CHOICE:
      out.push(CHOOSE + SUIT_OF[h.first])
      // The dealer chooses after both rounds, so with both cards face up.
      if (SUIT_OF[h.second] !== SUIT_OF[h.first]) out.push(CHOOSE + SUIT_OF[h.second])
      out.push(CHOOSE_NONE)
      break
    case ASK:
      out.push(ACK, TROEFKE)
      break
    case PLAY:
      for (let m = cardMask(h); m; m &= m - 1) out.push(31 - Math.clz32(m & -m))
      break
  }
  return out
}

function startPlaying(h: Hand, trump: number, level: number, bidder: number): void {
  h.trump = trump
  h.level = level
  h.bidder = bidder
  h.turn = (h.dealer + 1) & 3
  // Only a bidder whose partner leads may ask a troefke, and it asks only
  // with a troefke hand: the other seats read it as one (`troefkeWeight`).
  const ask = h.turn === ((bidder + 2) & 3) && troefkeHand(cardsOf(h.hands[bidder]), SUITS[trump])
  h.phase = ask ? ASK : PLAY
}

/** The engine's `scoreHand`, as a value for team 0. */
function score(h: Hand): number {
  const playing = h.bidder & 1
  const after: [number, number] = [h.lines[0], h.lines[1]]
  // Exactly 20 is a draw: nobody crosses a line.
  if (h.points[playing] !== 20) {
    const winner = h.points[playing] > 20 ? playing : 1 - playing
    const erased = (h.level === 1 ? h.multiplier : 2) + (h.won[winner] === 6 ? 1 : 0)
    after[winner] = Math.max(0, after[winner] - erased)
    if (winner !== playing) after[playing]++
  }
  return handValue({ lines: h.lines }, { lines: after }, 0)
}

/** Play `move` for the seat to move. */
export function step(h: Hand, move: number): void {
  switch (h.phase) {
    case R1:
    case R2:
      if (move === GO || move >= GO_R2) {
        const r1 = h.phase === R1
        startPlaying(h, SUIT_OF[r1 ? h.first : h.second], r1 ? 1 : 2, moverOf(h))
      } else if (++h.bidIndex === 3) {
        h.bidIndex = 0
        h.phase = h.phase === R1 && SUIT_OF[h.second] !== SUIT_OF[h.first] ? R2 : CHOICE
      }
      return
    case CHOICE:
      if (move === CHOOSE_NONE) {
        // All passed: nobody crosses a line (the doubled stake that follows is not weighed).
        h.value = 0
        h.phase = DONE
      } else startPlaying(h, move - CHOOSE, 2, h.dealer)
      return
    case ASK:
      h.troefke = move === TROEFKE
      h.phase = PLAY
      return
  }
  h.hands[h.turn] ^= 1 << move
  h.trick.push(move)
  if (h.trick.length < 4) {
    h.turn = (h.turn + 1) & 3
    return
  }
  let top = 0
  let pts = 0
  for (let i = 0; i < 4; i++) {
    if (i > 0 && beats(h.trick[i], h.trick[top], h.trump)) top = i
    pts += POINTS_OF[h.trick[i]]
  }
  const winner = (h.turn + 1 + top) & 3
  h.points[winner & 1] += pts
  h.won[winner & 1]++
  h.trick.length = 0
  h.turn = winner
  if (++h.played === 6) {
    h.value = score(h)
    h.phase = DONE
  }
}

export const isDone = (h: Hand): boolean => h.phase === DONE

// ---- The search ----------------------------------------------------------------

/** A tree node: the statistics of the move that leads to it, for the seat that made it. */
interface Node {
  children: Map<number, Node>
  visits: number
  /** Sum of the rewards in [0, 1] for the team of the seat that made the move. */
  reward: number
  /** Iterations in which the move was legal at its parent. */
  avail: number
}

const newNode = (): Node => ({ children: new Map(), visits: 0, reward: 0, avail: 0 })

interface Search {
  c: number
  rand: () => number
  /** MAST: sum and count of the rewards per seat and move (`seat * MOVES + move`); null when off. */
  mast: { sum: Float64Array; n: Float64Array } | null
}

/** Reward in [0, 1] for `team` of a finished hand. */
const rewardOf = (h: Hand, team: number): number => ((team === 0 ? h.value : -h.value) + MAX_VALUE) / (2 * MAX_VALUE)

/** A playout move: uniform, or by MAST's Gibbs weights. */
function playoutMove(h: Hand, moves: number[], s: Search): number {
  if (!s.mast || moves.length === 1) return moves[Math.floor(s.rand() * moves.length)]
  const base = moverOf(h) * MOVES
  let total = 0
  const weights = moves.map((m) => {
    const n = s.mast!.n[base + m]
    // An untried move counts as the best one, so it gets tried.
    const w = Math.exp((n ? s.mast!.sum[base + m] / n : 1) / MAST_TAU)
    total += w
    return w
  })
  let r = s.rand() * total
  for (let i = 0; i < moves.length; i++) if ((r -= weights[i]) < 0) return moves[i]
  return moves[moves.length - 1]
}

/**
 * One iteration from `root` on `h` (changed): select by UCB with
 * availability counts (the subset-armed bandit of SO-ISMCTS: a move counts
 * only the iterations in which it was legal), expand one untried move, play
 * out to the end of the hand, and back up the reward. With one world every
 * move stays legal: UCT, with the parent's visits counted from the move's
 * expansion on.
 */
function iterate(root: Node, h: Hand, s: Search): void {
  const path: Node[] = []
  const teams: number[] = []
  const history: number[] = []
  const moves: number[] = []
  let node = root
  let expanded = false
  while (!isDone(h)) {
    const seat = moverOf(h)
    movesOf(h, moves)
    let move = -1
    if (!expanded) {
      const untried: number[] = []
      let best = -Infinity
      for (const m of moves) {
        const child = node.children.get(m)
        if (!child) {
          untried.push(m)
          continue
        }
        child.avail++
      }
      if (untried.length) {
        move = untried[Math.floor(s.rand() * untried.length)]
        const child = newNode()
        child.avail = 1
        node.children.set(move, child)
        expanded = true
      } else {
        for (const m of moves) {
          const child = node.children.get(m)!
          const ucb = child.reward / child.visits + s.c * Math.sqrt(Math.log(child.avail) / child.visits)
          if (ucb > best) {
            best = ucb
            move = m
          }
        }
      }
      node = node.children.get(move)!
      path.push(node)
      teams.push(teamOf(seat))
    } else move = playoutMove(h, moves, s)
    if (s.mast) history.push(seat * MOVES + move)
    step(h, move)
  }
  for (let i = 0; i < path.length; i++) {
    path[i].visits++
    path[i].reward += rewardOf(h, teams[i])
  }
  if (s.mast) {
    for (const k of history) {
      s.mast.sum[k] += rewardOf(h, teamOf(Math.floor(k / MOVES)))
      s.mast.n[k]++
    }
  }
}

/** The move code of an engine action in `s` (a state or an observation). */
export function moveOf(a: Action, s: { phase: Phase; turned: { second: Turned['second'] | null } | null }): number {
  switch (a.type) {
    case 'play':
      return cardIndex(a.card)
    case 'bid':
      if (s.phase === 'BIDDING_R2') return (a.play ? GO_R2 : PASS_R2) + SUITS.indexOf(s.turned!.second!.s)
      return a.play ? GO : PASS
    case 'choose':
      return a.suit ? CHOOSE + SUITS.indexOf(a.suit) : CHOOSE_NONE
    case 'ack':
      return ACK
    case 'troefke':
      return TROEFKE
    default:
      throw new Error(`mcts cannot decide ${a.type}`)
  }
}

interface Options {
  iterations: number
  c: number
  worlds: number
  mast: boolean
}

/** The root's actions with their summed statistics, the choice first (most visits). */
interface RootStats {
  action: Action
  visits: number
  reward: number
  avail: number
}

/**
 * Pick from the root statistics: most visits, then the best mean, then the
 * order of the legal actions. The trace lists them in that order, with the
 * mean as a value in lines (as `handValue`).
 */
function choose(stats: RootStats[], note: string, trace?: BotTrace): Action {
  const mean = (r: RootStats) => (r.visits ? r.reward / r.visits : 0)
  const order = stats
    .map((_, i) => i)
    .sort((i, j) => stats[j].visits - stats[i].visits || mean(stats[j]) - mean(stats[i]) || i - j)
  if (trace) {
    for (const i of order) {
      const r = stats[i]
      // An action the budget never reached has no value yet.
      if (!r.visits) {
        trace.candidates.push({ action: r.action, visits: 0, note: 'untried' })
        continue
      }
      trace.candidates.push({
        action: r.action,
        score: mean(r) * 2 * MAX_VALUE - MAX_VALUE,
        visits: r.visits,
        note: `avail ${r.avail}`,
      })
    }
    trace.notes.push(note)
  }
  return stats[order[0]].action
}

/** Decide `obs` from the root statistics of the trees that `run` searched. */
function decideWith(
  obs: Observation,
  rand: () => number,
  opt: Options,
  trace: BotTrace | undefined,
  run: (s: Search) => { roots: Node[]; note: string },
): Action {
  let candidates = obs.legal
  const ack = candidates.find((a) => a.type === 'ack')
  if (ack && !troefkeHand(obs.hand, obs.trump!)) {
    // As in the tree: no troefke without a troefke hand, so the others read it right.
    trace?.candidates.push({ action: ack, note: 'no troefke hand' })
    trace?.notes.push('no troefke: no troefke hand')
    return ack
  }
  if (troefkeLead(obs)) {
    candidates = candidates.filter((a) => a.type === 'play' && a.card.s === obs.trump)
    trace?.notes.push('troefke asked: lead a trump')
    if (candidates.length === 1) {
      trace?.candidates.push({ action: candidates[0], note: 'the only trump' })
      return candidates[0]
    }
  }
  const s: Search = {
    c: opt.c,
    rand,
    mast: opt.mast ? { sum: new Float64Array(4 * MOVES), n: new Float64Array(4 * MOVES) } : null,
  }
  const { roots, note } = run(s)
  const stats = candidates.map((action) => {
    const r: RootStats = { action, visits: 0, reward: 0, avail: 0 }
    for (const root of roots) {
      const child = root.children.get(moveOf(action, obs))
      if (!child) continue
      r.visits += child.visits
      r.reward += child.reward
      r.avail += child.avail
    }
    return r
  })
  return choose(stats, note, trace)
}

/** A world for the seat of `obs`, as a hand, after a check that the seat moves first. */
function rootHand(obs: Observation, rand: () => number, weight: ((w: State) => number) | undefined): Hand {
  const h = handOf(sampleWorld(obs, rand, weight))
  if (moverOf(h) !== obs.seat) throw new Error(`mcts: seat ${obs.seat} does not move in its own decision`)
  return h
}

function parseOptions(name: string, variant: string | undefined, options: Record<string, unknown>, keys: string[]): Options {
  if (variant !== undefined) throw new Error(`unknown ${name} variant: ${variant}`)
  for (const [k, v] of Object.entries(options)) {
    if (!keys.includes(k)) throw new Error(`unknown ${name} option: ${k}`)
    if (k === 'mast') {
      if (typeof v !== 'boolean') throw new Error(`${name} option mast must be true or false`)
    } else if (k === 'c') {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`${name} option c must be a number of at least 0`)
    } else if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
      throw new Error(`${name} option ${k} must be a positive integer`)
    }
  }
  return {
    iterations: (options.iterations as number | undefined) ?? MCTS_ITERATIONS,
    c: (options.c as number | undefined) ?? MCTS_C,
    worlds: (options.worlds as number | undefined) ?? MCTS_WORLDS,
    mast: (options.mast as boolean | undefined) ?? false,
  }
}

/**
 * Determinized MCTS: `worlds` worlds per decision (`sampleWorld`), each
 * searched with UCT and full information for `iterations / worlds`
 * iterations; the root statistics of all worlds are summed and the action
 * with the most visits wins. Like PIMC it assumes it will know the cards
 * later (strategy fusion).
 *
 * Every decision is in the tree: bids, the troefke, the dealer's choice and
 * the cards, for all seats, to the end of the hand. The value is
 * `handValue` for the seat's team, scaled to [0, 1]; all passed is 0.
 * Playouts are random, or by MAST with `mast: true`. The troefke: the seat
 * obeys it and reads it (`troefkeLead`, `troefkeWeight`); in the tree and the
 * playouts the bidder's partner obeys it too.
 *
 * Options: `iterations`, `c` (UCB1 exploration), `worlds`, `mast`.
 */
export function createMcts(variant: string | undefined, options: Record<string, unknown>): Algorithm {
  const opt = parseOptions('mcts', variant, options, ['iterations', 'c', 'worlds', 'mast'])
  return {
    id: 'mcts',
    supports: () => true,
    decide: (obs, rand, trace) =>
      decideWith(obs, rand, opt, trace, (s) => {
        const weight = troefkeWeight(obs)
        const worlds = Math.min(opt.worlds, opt.iterations)
        const roots: Node[] = []
        for (let w = 0; w < worlds; w++) {
          const root = newNode()
          const h = rootHand(obs, rand, weight)
          // The iterations split evenly; the first worlds get the rest.
          const n = Math.floor(opt.iterations / worlds) + (w < opt.iterations % worlds ? 1 : 0)
          for (let i = 0; i < n; i++) iterate(root, copyHand(h), s)
          roots.push(root)
        }
        return { roots, note: `mcts: ${worlds} worlds, ${opt.iterations} iterations${opt.mast ? ', mast' : ''}` }
      }),
  }
}

/**
 * Single-Observer Information Set MCTS (Cowling, Powley & Whitehouse 2012):
 * one tree over the moves everyone sees, and a new world (`sampleWorld`)
 * per iteration that follows only the moves legal in it. UCB uses
 * availability counts. No strategy fusion over the seat's own moves: one
 * tree node holds a move for all the worlds the seat cannot tell apart.
 *
 * Bids, troefke, dealer's choice, cards, value, playouts and the troefke
 * convention as in `mcts`. Options: `iterations`, `c`, `mast`.
 */
export function createIsmcts(variant: string | undefined, options: Record<string, unknown>): Algorithm {
  const opt = parseOptions('ismcts', variant, options, ['iterations', 'c', 'mast'])
  return {
    id: 'ismcts',
    supports: () => true,
    decide: (obs, rand, trace) =>
      decideWith(obs, rand, opt, trace, (s) => {
        const weight = troefkeWeight(obs)
        const root = newNode()
        for (let i = 0; i < opt.iterations; i++) iterate(root, rootHand(obs, rand, weight), s)
        return { roots: [root], note: `ismcts: ${opt.iterations} iterations${opt.mast ? ', mast' : ''}` }
      }),
  }
}
