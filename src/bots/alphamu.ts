import { SUITS, teamOf } from '../engine'
import type { Action, State } from '../engine'
import type { Algorithm, BotTrace } from './algorithm'
import { troefkeLead, troefkeWeight } from './conventions'
import { sampleWorld } from './determinize'
import { decisionPhase } from './observation'
import type { Observation } from './observation'
import { cost } from './pimc'
import { beatsCard, cardIndex, legalCardMask, maskOf, playSearch } from './solver'

/** Own-team moves searched before the solver values the worlds, when the spec names no `M`. */
export const ALPHAMU_M = 2
/** Worlds per decision when the spec names no `worlds`. */
export const ALPHAMU_WORLDS = 20

const INF = 1000

/** The front of one root card: the plans worth keeping, each a vector of values, one per world. */
export interface AlphaMuValue {
  action: Action
  front: number[][]
  /** The vector of the front with the best sum: the value of the card. */
  best: number[]
  sum: number
  /**
   * False when `cut` stopped its search: it cannot beat the best card, and
   * `sum` is only an upper bound (its pimc value, or its front when cut).
   */
  exact: boolean
}

/**
 * Keep the vectors that no other vector beats or equals in every world of
 * `ws` (the worlds that still fit this line); of equal vectors, the first.
 */
function prune(front: number[][], ws: number[]): number[][] {
  if (front.length < 2) return front
  return front.filter((v, i) =>
    !front.some((u, j) => {
      if (j === i) return false
      let equal = true
      for (const w of ws) {
        if (u[w] < v[w]) return false
        if (u[w] > v[w]) equal = false
      }
      return !equal || j < i
    }),
  )
}

const sum = (v: number[]): number => v.reduce((a, b) => a + b, 0)

/**
 * Every pair of plans of `a` and `b`, combined world by world: where the
 * seat to move sees the deal, it takes the better (`max`) or worse value per world.
 */
function product(a: number[][], b: number[][], ws: number[], max: boolean): number[][] {
  const out: number[][] = []
  for (const x of a) {
    for (const y of b) {
      const v = x.slice()
      for (const w of ws) v[w] = max ? Math.max(x[w], y[w]) : Math.min(x[w], y[w])
      out.push(v)
    }
  }
  return prune(out, ws)
}

/**
 * αμ (Cazenave & Ventos) over the given `worlds`, all fitting what `seat`
 * saw, for its cards `actions`. It searches the lines of play of all worlds
 * together: per line a set of vectors (one value per world, for the seat's
 * team, as `handValue`), the Pareto front. The seat plays the same card in
 * every world, as it cannot tell them apart: its front is the union of its
 * cards' fronts. An opponent sees its world and plays the worst card for us
 * in each one; its partner (choice A of #89) the best one, so the partner's
 * cards count as own-team moves. Those two combine the fronts of their cards
 * world by world. A card is played only in the worlds where it is legal.
 * After `M` own-team moves (the root card is the first) the solver values
 * each world. With `M = 1` this is PIMC.
 *
 * With `cut`, a card stops as soon as its sum is surely below the best card's
 * so far: first because its pimc sum (an upper bound) is, then while an
 * opponent's cards make it worse. The cards are searched best pimc sum first.
 * The best cards, and all cards they tie with, stay exact.
 *
 * Pure: no randomness, and the worlds are only read.
 */
export function alphamuValues(worlds: State[], seat: number, actions: Action[], M: number, cut = false): AlphaMuValue[] {
  const n = worlds.length
  const team = teamOf(seat)
  const first = worlds[0]
  const trump = SUITS.indexOf(first.trump!)
  const searches = worlds.map((w) => playSearch(w, team))
  const hands = worlds.map((w) => w.hands.map(maskOf))
  const trick = first.trick.map((tc) => cardIndex(tc.card))
  let turn = first.turn
  let played = first.tricksPlayed
  // The cards played since the decision: every world's solver replays them.
  const path: number[] = []
  const all = worlds.map((_, i) => i)

  function leaf(ws: number[]): number[] {
    const v = new Array<number>(n).fill(0)
    for (const w of ws) v[w] = searches[w].line(path)
    return v
  }

  /** Play `c` in the worlds `ws`, run `then`, take the card back. */
  function withCard<T>(c: number, ws: number[], then: () => T): T {
    const mover = turn
    for (const w of ws) hands[w][mover] ^= 1 << c
    trick.push(c)
    path.push(c)
    let done: number[] | null = null
    if (trick.length === 4) {
      let top = 0
      for (let i = 1; i < 4; i++) if (beatsCard(trick[i], trick[top], trump)) top = i
      done = trick.splice(0, 4)
      turn = (mover + 1 + top) & 3
      played++
    } else {
      turn = (mover + 1) & 3
    }
    const out = then()
    if (done) {
      trick.push(...done)
      played--
    }
    trick.pop()
    path.pop()
    turn = mover
    for (const w of ws) hands[w][mover] ^= 1 << c
    return out
  }

  // With `cut`: the best root sum so far; set when a search stopped below it.
  let bar = -Infinity
  let stopped = false

  /**
   * The front of the position for the worlds `ws`, `m` own-team moves deep.
   * `root`: an opponent's front here ends up as the root card's. (A cut on
   * the front the seat already has, as in the paper, was removed: it gave
   * about 3% and no test position could reach it.)
   */
  function node(m: number, ws: number[], root: boolean): number[][] {
    if (m === 0 || played === 6) return [leaf(ws)]
    const mover = turn
    const own = (mover & 1) === team
    // The last own-team move is the partner's, with only opponents before it:
    // every seat up to there picks per world, so the solver's value is the front.
    if (m === 1 && mover !== seat && (own || (trick.length < 3 && ((mover + 1) & 3) !== seat))) return [leaf(ws)]
    const masks = ws.map((w) => legalCardMask(hands[w][mover], trick, trick.length, trump))
    let union = 0
    for (const mask of masks) union |= mask
    if (mover === seat) {
      // Its own hand is the same in every world: every card fits all of them.
      let front: number[][] = []
      for (let c = 0; c < 24; c++) if (union & (1 << c)) front = prune([...front, ...withCard(c, ws, () => node(m - 1, ws, false))], ws)
      return front
    }
    let acc: number[][] | null = null
    for (let c = 0; c < 24; c++) {
      if (!(union & (1 << c))) continue
      const sub = ws.filter((_, i) => masks[i] & (1 << c))
      const all = sub.length === ws.length
      const front = withCard(c, sub, () => node(own ? m - 1 : m, sub, !own && all && root))
      if (!all) {
        // A world without this card takes another one: neutral here.
        const skip = ws.filter((_, i) => !(masks[i] & (1 << c)))
        for (const v of front) for (const w of skip) v[w] = own ? -INF : INF
      }
      acc = acc ? product(acc, front, ws, own) : front
      if (!own && root && Math.max(...acc.map(sum)) < bar) {
        stopped = true
        return acc
      }
    }
    return acc!
  }

  const value = (action: Action, front: number[][], exact: boolean): AlphaMuValue => {
    const sums = front.map(sum)
    const i = sums.indexOf(Math.max(...sums))
    return { action, front, best: front[i], sum: sums[i], exact }
  }
  const cards = actions.map((action) => {
    if (action.type !== 'play' || action.seat !== first.turn) throw new Error(`alphamu: seat ${seat} cannot play ${action.type} now`)
    return cardIndex(action.card)
  })
  // M = 1 is pimc: the solver values each world right after the card.
  const pimc = cards.map((c) => withCard(c, all, () => [leaf(all)]))
  if (M === 1) return actions.map((a, i) => value(a, pimc[i], true))
  const order = actions.map((_, i) => i)
  if (cut) order.sort((i, j) => sum(pimc[j][0]) - sum(pimc[i][0]))
  const out: AlphaMuValue[] = []
  for (const i of order) {
    if (cut && sum(pimc[i][0]) < bar) {
      out[i] = value(actions[i], pimc[i], false)
      continue
    }
    stopped = false
    const front = withCard(cards[i], all, () => node(M - 1, all, cut))
    out[i] = value(actions[i], front, !stopped)
    if (!stopped) bar = Math.max(bar, out[i].sum)
  }
  return out
}

/**
 * Algorithm `alphamu`: αμ search (`alphamuValues`) over `worlds` sampled
 * worlds, as pimc samples them, up to `M` own-team moves deep; it plays the
 * card whose best vector has the best average, ties as pimc. A card that
 * surely cannot win is cut short (`alphamuValues`): its trace note ends in
 * `, cut` and its score is an upper bound.
 *
 * Card play only: `supports` is false for bids, the dealer's choice and the
 * troefke, so a bot with it needs rules after it for those (pimc, heuristic).
 */
export function createAlphamu(variant: string | undefined, options: Record<string, unknown>): Algorithm {
  if (variant !== undefined) throw new Error(`unknown alphamu variant: ${variant}`)
  for (const [k, v] of Object.entries(options)) {
    if (k !== 'M' && k !== 'worlds') throw new Error(`unknown alphamu option: ${k}`)
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new Error(`alphamu option ${k} must be a positive integer`)
  }
  const M = (options.M as number | undefined) ?? ALPHAMU_M
  const samples = (options.worlds as number | undefined) ?? ALPHAMU_WORLDS
  return {
    id: 'alphamu',
    supports: (obs) => decisionPhase(obs) === 'play',
    decide(obs: Observation, rand: () => number, trace?: BotTrace): Action {
      // The same candidates and worlds as pimc, so M = 1 plays as pimc.
      let candidates = obs.legal
      if (troefkeLead(obs)) {
        candidates = candidates.filter((a) => a.type === 'play' && a.card.s === obs.trump)
        trace?.notes.push('troefke asked: lead a trump')
        if (candidates.length === 1) {
          trace?.candidates.push({ action: candidates[0], note: 'the only trump' })
          return candidates[0]
        }
      }
      const weight = troefkeWeight(obs)
      const worlds = Array.from({ length: samples }, () => sampleWorld(obs, rand, weight))
      const values = alphamuValues(worlds, obs.seat, candidates, M, true)
      const order = values
        .map((_, i) => i)
        .sort((i, j) => values[j].sum - values[i].sum || cost(candidates[i], obs.trump) - cost(candidates[j], obs.trump) || i - j)
      if (trace) {
        for (const i of order) {
          const { action, front, best, sum, exact } = values[i]
          trace.candidates.push({
            action,
            score: sum / samples,
            visits: samples,
            note: `front ${front.length}, min ${Math.min(...best)} max ${Math.max(...best)}${exact ? '' : ', cut'}`,
          })
        }
        trace.notes.push(`alphamu: M=${M}, ${samples} worlds, best average ${(values[order[0]].sum / samples).toFixed(2)}`)
      }
      return candidates[order[0]]
    },
  }
}
