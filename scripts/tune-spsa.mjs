// SPSA over the heuristic's tuning constants (HEURISTIC_DEFAULTS), used by
// tune-heuristic.mjs. Pure: no engine, no vite, so tests import it directly.
//
// SPSA, not CMA-ES: it needs 2 evaluations per step for any number of
// constants, the + and − candidates play the same seeds (common random
// numbers make their difference far less noisy than either score), and it is
// 40 lines without a library. CMA-ES needs ~12 candidates per generation for
// 17 constants and a covariance update.

/**
 * Search space per constant: bounds and the step a value is rounded to (a
 * hand rating moves in halves, trick points and costs in whole numbers).
 * `fixed`: a value set by hand, which the tuner keeps unless `--free` names it.
 * @typedef {{ key: string, lo: number, hi: number, step: number, fixed?: boolean }} Param
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
  // Close to how people play (#175); bot self-play cannot tell it from noise.
  { key: 'dealerWeak', lo: 0, hi: 1, step: 0.01, fixed: true },
  { key: 'contestMin', lo: 1, hi: 12, step: 1 },
  { key: 'cheapWin', lo: 2, hi: 14, step: 1 },
  { key: 'vetMaxRisk', lo: 0, hi: 4, step: 1 },
]

// Standard SPSA gain decay (Spall). The search runs in [0, 1] per constant.
const ALPHA = 0.602
const GAMMA = 0.101
/** Perturbation: 10% of each range at the start, and never less than one step. */
const C = 0.1
/** First step ≈ 8% of a range for a typical gradient estimate of 0.25. */
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
 * The constants a run keeps at their start value: `fixed` plus the ones set
 * by hand (`Param.fixed`), unless `free` names them.
 * @param {string[]} fixed
 * @param {string[]} [free]
 */
export function fixedKeys(fixed, free = []) {
  for (const [flag, keys] of /** @type {const} */ ([['fixed', fixed], ['free', free]]))
    for (const k of keys)
      if (!PARAMS.some((p) => p.key === k)) throw new Error(`--${flag}: unknown constant '${k}'`)
  for (const k of free) {
    if (!PARAMS.some((p) => p.key === k && p.fixed)) throw new Error(`--free: '${k}' is not set by hand, so it is tuned already`)
    if (fixed.includes(k)) throw new Error(`--free and --fixed both name '${k}'`)
  }
  const byHand = PARAMS.filter((p) => p.fixed && !free.includes(p.key)).map((p) => p.key)
  return [...new Set([...fixed, ...byHand])]
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
  // Fixed constants keep their start value exactly, unrounded.
  const pinned = Object.fromEntries(fixed.map((k) => [k, start[k]]))
  const options = (/** @type {number[]} */ v) => ({ ...toOptions(v), ...pinned })
  let u = toPoint(start)
  for (let k = 0; k < generations; k++) {
    const ak = a / (k + 1 + A) ** ALPHA
    const ck = C / (k + 1) ** GAMMA
    // At least one step: a smaller perturbation rounds + and − to the same
    // value, and the update of that constant would be noise.
    const c = PARAMS.map((p) => Math.max(ck, p.step / (p.hi - p.lo)))
    // A fixed constant gets no perturbation, so it never moves. Draw for it
    // anyway: the other constants then see the same draws as without --fixed.
    const delta = u.map((_, i) => (rand() < 0.5 ? -1 : 1) * (fixed.includes(PARAMS[i].key) ? 0 : 1))
    // Match seeds far above the bench's 1..N, so `npm run bench` checks on new seeds.
    const seeds = Array.from({ length: seedsPerGen }, () => 1_000_000 + Math.floor(rand() * 1e9))
    const [plus, minus] = await evaluate(
      options(u.map((x, i) => x + c[i] * delta[i])),
      options(u.map((x, i) => x - c[i] * delta[i])),
      seeds,
    )
    u = u.map((x, i) => clamp01(x + (ak * (plus - minus) * delta[i]) / (2 * c[i])))
    onStep?.({ gen: k + 1, plus, minus, options: options(u) })
  }
  return options(u)
}
