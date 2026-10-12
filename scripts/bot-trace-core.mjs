// Core of bot:trace: plays one seeded match and reports every real decision of
// the shown seats with what the bot saw, the rule and algorithm that decided,
// its trace and the chosen action, plus a summary per trick and per hand. No
// vite and no terminal here, so tests can call it; scripts/bot-trace.mjs is the
// command line around it.
import { realDecisionPhase } from './bot-spec.mjs'

const STEP_CAP = 20000
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' }

/** @typedef {import('../src/engine/types.ts').Card} Card */
/** @typedef {import('../src/engine/types.ts').Action} Action */
/** @typedef {import('../src/engine/types.ts').TrickCard} TrickCard */
/** @typedef {import('../src/engine/types.ts').HandResult} HandResult */
/** @typedef {import('../src/bots/observation.ts').Observation} Observation */
/** @typedef {import('../src/bots/algorithm.ts').TraceCandidate} TraceCandidate */

/**
 * @typedef {{
 *   apply: Function, createMatch: Function, pendingSeats: Function, observe: Function,
 *   trickWinnerIndex: Function, trickPoints: Function, seededRandom: (seed: number) => () => number,
 * }} TraceEngine
 */

/**
 * `step` counts every engine action of the match from 1 (lifts, deals and acks
 * included); `hand` is the engine's hand counter, so a redeal after an
 * all-pass is a hand of its own.
 * @typedef {{
 *   step: number, hand: number, phase: string, kind: 'bidding' | 'play', seat: number,
 *   obs: Observation, rule: number | null, algorithm: string,
 *   candidates: TraceCandidate[], notes: string[], chosen: Action,
 * }} Decision
 */

/**
 * @typedef {(
 *   { type: 'decision', decision: Decision } |
 *   { type: 'trick', step: number, hand: number, number: number, winner: number,
 *     cards: TrickCard[], points: number, scores: number[] } |
 *   { type: 'hand', step: number, hand: number, result: HandResult, lines: number[], over: boolean }
 * )} TraceEvent
 */

/** @typedef {'red' | 'bold'} Style */
/** @typedef {(style: Style, text: string) => string} Paint */

/** @type {Paint} */
export const plain = (_style, text) => text

/**
 * Play the match of `seed` the way `npm run bench` does (same random source,
 * `bots[seat]` decides for that seat) and emit the events inside the window.
 * @param {TraceEngine} engine
 * @param {number} seed
 * @param {{ name: string, decide: Function }[]} bots  one per seat
 * @param {{ show: number[], from?: number, to?: number, hand?: number }} opt  `show`: seats whose decisions are emitted
 * @param {(event: TraceEvent) => void} emit
 */
export function traceMatch(engine, seed, bots, opt, emit) {
  let s = engine.createMatch(seed)
  const rand = engine.seededRandom(seed * 7919 + 13)
  for (let step = 1; s.phase !== 'GAME_OVER'; step++) {
    if (step > STEP_CAP) throw new Error(`match ${seed} did not terminate`)
    if (opt.to != null && step > opt.to) break
    if (opt.hand != null && s.handNumber > opt.hand) break
    const seat = engine.pendingSeats(s)[0]
    const obs = engine.observe(s, seat)
    const kind = realDecisionPhase(obs.legal)
    const trace = /** @type {import('../src/bots/algorithm.ts').BotTrace} */ ({ candidates: [], notes: [] })
    const chosen = bots[seat].decide(s, seat, rand, trace)
    const next = engine.apply(s, chosen)
    const inWindow = (opt.from == null || step >= opt.from) && (opt.hand == null || s.handNumber === opt.hand)
    if (inWindow) {
      if (kind && opt.show.includes(seat)) {
        emit({
          type: 'decision',
          decision: {
            step,
            hand: s.handNumber,
            phase: s.phase,
            kind,
            seat,
            obs,
            rule: trace.rule ?? null,
            algorithm: trace.algorithm ?? bots[seat].name,
            candidates: sortCandidates(trace.candidates),
            notes: trace.notes,
            chosen,
          },
        })
      }
      if (next.tricksPlayed > s.tricksPlayed) {
        const cards = next.lastTrick
        emit({
          type: 'trick',
          step,
          hand: s.handNumber,
          number: next.tricksPlayed,
          winner: cards[engine.trickWinnerIndex(cards, next.trump)].seat,
          cards,
          points: engine.trickPoints(cards),
          scores: next.points,
        })
      }
      if (s.phase === 'PLAYING' && (next.phase === 'SCORED' || next.phase === 'GAME_OVER')) {
        emit({
          type: 'hand',
          step,
          hand: s.handNumber,
          result: next.lastResult,
          lines: next.lines,
          over: next.phase === 'GAME_OVER',
        })
      }
    }
    s = next
  }
}

/** Best score first; candidates without a score keep their order at the end. */
function sortCandidates(/** @type {TraceCandidate[]} */ candidates) {
  const key = (/** @type {TraceCandidate} */ c) => c.score ?? -Infinity
  return [...candidates].sort((a, b) => key(b) - key(a))
}

// ---- Text ------------------------------------------------------------------------

/** `A♠`; red suits are painted. */
export function cardText(/** @type {Card} */ c, paint = plain) {
  const t = `${c.r}${SUIT[c.s]}`
  return c.s === 'H' || c.s === 'D' ? paint('red', t) : t
}

export function actionText(/** @type {Action} */ a, paint = plain) {
  switch (a.type) {
    case 'play':
      return cardText(a.card, paint)
    case 'bid':
      return a.play ? 'bid play' : 'bid pass'
    case 'choose':
      return a.suit ? `choose ${SUIT[a.suit]}` : 'choose pass'
    default:
      return a.type
  }
}

const cardsText = (/** @type {Card[]} */ cards, paint = plain) => cards.map((c) => cardText(c, paint)).join(' ')
const trickText = (/** @type {TrickCard[]} */ trick, paint = plain) =>
  trick.map((tc) => `${tc.seat}:${cardText(tc.card, paint)}`).join(' ')
const num = (/** @type {number | undefined} */ n) =>
  n === undefined ? '' : Number.isInteger(n) ? String(n) : n.toFixed(3)

/** The candidate table: a `*` marks the chosen action, score and visits right-aligned. */
function candidateLines(/** @type {Decision} */ d) {
  const chosen = actionText(d.chosen)
  const rows = [
    ['', 'action', 'score', 'visits', 'note'],
    ...d.candidates.map((c) => [
      actionText(c.action) === chosen ? '*' : '',
      actionText(c.action),
      num(c.score),
      c.visits === undefined ? '' : String(c.visits),
      c.note ?? '',
    ]),
  ]
  const w = [1, 2, 3].map((i) => Math.max(...rows.map((r) => r[i].length)))
  return rows.map(
    (r) => `${r[0].padEnd(1)} ${r[1].padEnd(w[0])}  ${r[2].padStart(w[1])}  ${r[3].padStart(w[2])}  ${r[4]}`.trimEnd(),
  )
}

/** One decision as aligned text lines. */
export function formatDecision(/** @type {Decision} */ d, paint = plain) {
  const o = d.obs
  const lines = [
    paint('bold', `step ${d.step} | hand ${d.hand} | ${d.phase} (${d.kind}) | seat ${d.seat}`) +
      ` | rule ${d.rule ?? '-'} ${d.algorithm}`,
  ]
  const row = (/** @type {string} */ label, /** @type {string} */ text) => lines.push(`  ${label.padEnd(11)}${text}`)
  row('hand', o.hand.length ? cardsText(o.hand, paint) : o.handCounts[d.seat] ? '(hidden: the dealer bids blind)' : '-')
  row('trick', o.trick.length ? trickText(o.trick, paint) : '-')
  row(
    'trump',
    o.trump
      ? `${SUIT[o.trump]} (level ${o.level}, bidder seat ${o.bidder}${o.troefkeAsked ? ', troefke asked' : ''})`
      : 'none yet',
  )
  row(
    'turned',
    o.turned
      ? `first ${cardText(o.turned.first, paint)}, second ${o.turned.second ? cardText(o.turned.second, paint) : 'face down'}`
      : '-',
  )
  row(
    'lines',
    `team 0 ${o.lines[0]}, team 1 ${o.lines[1]} | points ${o.points[0]}-${o.points[1]} | tricks ${o.tricksWon[0]}-${o.tricksWon[1]}` +
      (o.multiplier > 1 ? ` | stake x${o.multiplier}` : ''),
  )
  row('legal', o.legal.map((a) => actionText(a, paint)).join(', '))
  if (d.candidates.length) {
    row('candidates', '')
    for (const l of candidateLines(d)) lines.push(`    ${l}`)
  }
  d.notes.forEach((n, i) => row(i === 0 ? 'notes' : '', n))
  row('chosen', actionText(d.chosen, paint))
  return lines.join('\n')
}

/** A decision, or the summary of a trick or a hand, as text. */
export function formatEvent(/** @type {TraceEvent} */ e, paint = plain) {
  if (e.type === 'decision') return formatDecision(e.decision, paint)
  if (e.type === 'trick') {
    return (
      `  > trick ${e.number}: seat ${e.winner} wins [${trickText(e.cards, paint)}], ${e.points} points` +
      ` | points ${e.scores[0]}-${e.scores[1]}`
    )
  }
  const r = e.result
  const parts = [
    `points ${r.points[0]}-${r.points[1]}`,
    r.draw ? 'tied, no lines erased' : `team ${r.winnerTeam} wins, erased ${r.erased}`,
  ]
  if (r.kapot) parts.push('kapot')
  if (r.koei) parts.push(`koei for team ${r.playingTeam}`)
  parts.push(`lines ${e.lines[0]}-${e.lines[1]}`)
  if (e.over) parts.push(`match won by team ${r.winnerTeam}`)
  return `  >> hand ${e.hand} over: ${parts.join(', ')}`
}

/** A decision as one JSON line, with cards and actions as the engine has them. */
export function decisionJson(/** @type {Decision} */ d) {
  const o = d.obs
  return JSON.stringify({
    step: d.step,
    hand: d.hand,
    phase: d.phase,
    kind: d.kind,
    seat: d.seat,
    cards: o.hand,
    trick: o.trick,
    trump: o.trump,
    level: o.level,
    bidder: o.bidder,
    turned: o.turned,
    lines: o.lines,
    points: o.points,
    tricksWon: o.tricksWon,
    multiplier: o.multiplier,
    legal: o.legal,
    rule: d.rule,
    algorithm: d.algorithm,
    candidates: d.candidates,
    notes: d.notes,
    chosen: d.chosen,
  })
}
