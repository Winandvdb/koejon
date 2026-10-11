// SPSA over the heuristic's tuning constants (HEURISTIC_DEFAULTS), used by
// tune-heuristic.mjs. Pure: no engine, no vite, so tests import it directly.
//
// SPSA, not CMA-ES: it needs 2 evaluations per step for any number of
// constants, the + and − candidates play the same seeds (common random
// numbers make their difference far less noisy than either score), and it is
// 40 lines without a library. CMA-ES needs ~12 candidates per generation for
// 18 constants and a covariance update.

/**
 * Search space per constant: bounds and the step a value is rounded to (a
 * hand rating moves in halves, trick points and costs in whole numbers).
 * @typedef {{ key: string, lo: number, hi: number, step: number }} Param
 * @type {Param[]}
 */
export const PARAMS = [
  { key: 'bidThreshold1', lo: 6, hi: 16, step: 0.5 },
  { key: 'bidThreshold2', lo: 4, hi: 13, step: 0.5 },
  { key: 'bidThreshold4', lo: 3, hi: 12, step: 0.5 },
  { key: 'betterSuit', lo: 0, hi: 6, step: 0.5 },
  { key: 'clearBid', lo: 0, hi: 8, step: 0.5 },
  { key: 'loneTrumpMin', lo: 8, hi: 18, step: 0.5 },
  { key: 'knijpMin', lo: 0, hi: 12, step: 0.5 },
  { key: 'knijpChance', lo: 0, hi: 1, step: 0.01 },
  { key: 'troefkeChance', lo: 0, hi: 1, step: 0.01 },
  { key: 'dealerSameSuit', lo: 0, hi: 1, step: 0.01 },
  { key: 'dealerLowSame', lo: 0, hi: 1, step: 0.01 },
  { key: 'dealerAce', lo: 0, hi: 1, step: 0.01 },
  { key: 'dealerKing', lo: 0, hi: 1, step: 0.01 },
  { key: 'dealerWeak', lo: 0, hi: 1, step: 0.01 },
  { key: 'contestMin', lo: 1, hi: 12, step: 1 },
  { key: 'cheapWin', lo: 2, hi: 14, step: 1 },
  { key: 'vetMaxRisk', lo: 0, hi: 4, step: 1 },
  { key: 'shortSuit', lo: 0, hi: 6, step: 1 },
]

// Standard SPSA gain decay (Spall). The search runs in [0, 1] per constant.
const ALPHA = 0.602
const GAMMA = 0.101
/** Perturbation: 10% of each range at the start. */
const C = 0.1
/** First step ≈ 2% of a range for a typical gradient estimate of 0.25. */
const STEP0 = 0.08 / 0.25

/**
 * mulberry32: a run repeats for the same seed.
 * @param {number} seed
 */
export function mulberry32(seed) {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp01 = (/** @type {number} */ x) => Math.min(1, Math.max(0, x))

/**
 * Options for a point of the [0, 1] search space: scaled to the bounds and
 * rounded to the step.
 * @param {number[]} u
 * @returns {Record<string, number>}
 */
export function toOptions(u) {
  return Object.fromEntries(
    PARAMS.map((p, i) => {
      const v = p.lo + clamp01(u[i]) * (p.hi - p.lo)
      // Round twice: the step, then away the float noise of 0.01 steps.
      return [p.key, Number((Math.round(v / p.step) * p.step).toFixed(2))]
    }),
  )
}

/**
 * The [0, 1] point of `options`.
 * @param {Record<string, number>} options
 */
export function toPoint(options) {
  return PARAMS.map((p) => clamp01((options[p.key] - p.lo) / (p.hi - p.lo)))
}

/**
 * @typedef {{ gen: number, plus: number, minus: number, options: Record<string, number> }} SpsaStep
 */

/**
 * Maximise `evaluate` with SPSA from `start`. Each generation draws its own
 * seeds and scores the + and − candidates on those same seeds.
 * @param {{
 *   start: Record<string, number>,
 *   generations: number,
 *   seed: number,
 *   seedsPerGen: number,
 *   evaluate: (plus: Record<string, number>, minus: Record<string, number>, seeds: number[]) => Promise<[number, number]>,
 *   onStep?: (step: SpsaStep) => void,
 *   fixed?: string[],
 * }} run  `fixed`: constants that keep their start value
 * @returns {Promise<Record<string, number>>} the options after the last step
 */
export async function spsa({ start, generations, seed, seedsPerGen, evaluate, onStep, fixed = [] }) {
  const rand = mulberry32(seed)
  const A = Math.max(1, Math.round(0.1 * generations))
  const a = STEP0 * (A + 1) ** ALPHA
  let u = toPoint(start)
  for (let k = 0; k < generations; k++) {
    const ak = a / (k + 1 + A) ** ALPHA
    const ck = C / (k + 1) ** GAMMA
    // A fixed constant gets no perturbation, so it never moves. Draw for it
    // anyway: the other constants then see the same draws as without --fixed.
    const delta = u.map((_, i) => (rand() < 0.5 ? -1 : 1) * (fixed.includes(PARAMS[i].key) ? 0 : 1))
    // Match seeds far above the bench's 1..N, so `npm run bench` checks on new seeds.
    const seeds = Array.from({ length: seedsPerGen }, () => 1_000_000 + Math.floor(rand() * 1e9))
    const [plus, minus] = await evaluate(
      toOptions(u.map((x, i) => x + ck * delta[i])),
      toOptions(u.map((x, i) => x - ck * delta[i])),
      seeds,
    )
    const g = (plus - minus) / (2 * ck)
    u = u.map((x, i) => clamp01(x + ak * g * delta[i]))
    onStep?.({ gen: k + 1, plus, minus, options: toOptions(u) })
  }
  return toOptions(u)
}
