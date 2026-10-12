// Tune the heuristic's constants with SPSA (see tune-spsa.mjs) by self-play:
// a candidate's score is its win rate as heuristic:hard against this
// checkout's heuristic:hard (with --play pimc: both as the `hard` level bot,
// see below), each seed played twice with the sides swapped.
//
//   npm run tune -- [--generations 50] [--matches 200] [--seed 1] [--jobs 4] [--out tune-heuristic.json]
//                   [--fixed bidThreshold1,bidThreshold2] [--free dealerWeak] [--play heuristic|pimc] [--samples 10]
//
// Constants marked `fixed` in PARAMS are set by hand and keep their default,
// as if named in --fixed; --free tunes them anyway.
//
// --matches is the number of seeds per candidate and generation. The result
// is the same for the same --seed, --generations and --matches, whatever
// --jobs. Writes the options after every generation to --out as an algorithm
// spec, so the check on new seeds is:
//
//   npm run bench -- --a tune-heuristic.json --b heuristic:hard --matches 1000
//
// --play pimc tunes the bids of the `hard` level bot (bot.ts LEVEL_CONFIGS):
// both sides play their cards and the troefke with pimc and bid with
// heuristic:hard, the candidate with its options. The constants that only the
// heuristic's card play reads (CARD_PLAY_KEYS) stay fixed. --samples sets the
// worlds per pimc decision (default HARD_PIMC.samples); fewer worlds run
// faster, but the bids are then tuned for a weaker card player than the one
// that ships, so the bench check matters even more. --out is then the level's bot (HARD_PIMC) with the tuned options,
// and the check on new seeds prints with that level's bot as --b.
import { writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { parseArgs } from 'node:util'
import { Worker } from 'node:worker_threads'
import { CARD_PLAY_KEYS, PARAMS, fixedKeys, spsa, tuneBot } from './tune-spsa.mjs'

const { values: opt } = parseArgs({
  options: {
    generations: { type: 'string', default: '50' },
    matches: { type: 'string', default: '200' },
    seed: { type: 'string', default: '1' },
    jobs: { type: 'string', default: '1' },
    out: { type: 'string', default: 'tune-heuristic.json' },
    fixed: { type: 'string', default: '' },
    free: { type: 'string', default: '' },
    play: { type: 'string', default: 'heuristic' },
    samples: { type: 'string' },
  },
})
if (opt.play !== 'heuristic' && opt.play !== 'pimc') throw new Error(`--play must be heuristic or pimc, got '${opt.play}'`)
const PIMC = opt.play === 'pimc'
if (opt.samples != null && !PIMC) throw new Error('--samples needs --play pimc')
// Constants that keep their default: the ones set by hand (`fixed` in PARAMS)
// unless --free names them, plus --fixed, for example the bid thresholds to
// keep today's bid rate: tuned freely, they move the most.
const FIXED = [
  ...new Set([
    ...fixedKeys(opt.fixed.split(',').filter(Boolean), opt.free.split(',').filter(Boolean)),
    ...(PIMC ? CARD_PLAY_KEYS : []),
  ]),
]
/** @param {string} name */
function positiveInt(name) {
  const v = Number(opt[/** @type {keyof typeof opt} */ (name)])
  if (!Number.isInteger(v) || v < 1) throw new Error(`--${name} must be a positive integer, got '${opt[/** @type {keyof typeof opt} */ (name)]}'`)
  return v
}
const GENERATIONS = positiveInt('generations')
const MATCHES = positiveInt('matches')
const SAMPLES = opt.samples != null ? positiveInt('samples') : null
const SEED = Number(opt.seed)
if (!Number.isInteger(SEED)) throw new Error(`--seed must be an integer, got '${opt.seed}'`)
// Each worker boots a vite server: never more workers than cores.
const JOBS = Math.min(MATCHES, positiveInt('jobs'), availableParallelism())

/**
 * @typedef {{
 *   id: number, wins?: number, n?: number, error?: string,
 *   defaults?: Record<string, number>, levelPimc?: { samples: number, partnerSamples: number, anchor?: string, margin?: number },
 * }} Reply
 */

/** Stop the run on the first worker failure: a partial score would mislead SPSA. */
function die(/** @type {unknown} */ e) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}

let nextId = 1
/** @type {Map<number, (r: Reply) => void>} */
const waiting = new Map()
const workers = Array.from({ length: JOBS }, () => {
  const w = new Worker(new URL('./tune-worker.mjs', import.meta.url), { workerData: { play: opt.play, samples: SAMPLES } })
  w.on('message', (/** @type {Reply} */ r) => {
    if (r.error != null) die(new Error(`tune worker: ${r.error}`))
    waiting.get(r.id)?.(r)
    waiting.delete(r.id)
  })
  w.on('error', die)
  return w
})

/**
 * Wins and games of `options` on `seeds`, split over the workers.
 * @param {Record<string, number>} options
 * @param {number[]} seeds
 */
async function score(options, seeds) {
  const parts = await Promise.all(
    workers.map((w, j) => ask(w, { options, seeds: seeds.filter((_, i) => i % JOBS === j) })),
  )
  return parts.reduce((sum, p) => sum + (p.wins ?? 0), 0) / parts.reduce((sum, p) => sum + (p.n ?? 0), 0)
}

/**
 * Send one task to `w` and wait for its reply.
 * @param {Worker} w
 * @param {object} task
 * @returns {Promise<Reply>}
 */
function ask(w, task) {
  const id = nextId++
  return new Promise((resolve) => {
    waiting.set(id, resolve)
    w.postMessage({ id, ...task })
  })
}

// The start point: the options heuristic:hard plays today, read through a worker's vite server.
const defaults = await ask(workers[0], { defaults: true })
const start = /** @type {Record<string, number>} */ (defaults.defaults)
// The bot that ships: the level's worlds, whatever --samples the tuner played.
const levelPimc = PIMC ? /** @type {{ samples: number, partnerSamples: number, anchor?: string, margin?: number }} */ (defaults.levelPimc) : null
const missing = Object.keys(start).filter((k) => !PARAMS.some((p) => p.key === k))
if (missing.length) die(new Error(`no search range in tune-spsa.mjs for: ${missing.join(', ')}`))
const stale = PARAMS.filter((p) => !Object.hasOwn(start, p.key)).map((p) => p.key)
if (stale.length) die(new Error(`search range in tune-spsa.mjs for a constant that is gone: ${stale.join(', ')}`))

const pct = (/** @type {number} */ x) => `${(100 * x).toFixed(1)}%`
const write = (/** @type {Record<string, number>} */ options) =>
  writeFileSync(opt.out, `${JSON.stringify(tuneBot(options, levelPimc), null, 2)}\n`)

console.log(
  `Tuning heuristic:hard: ${GENERATIONS} generations, ${MATCHES} seeds x 2 per candidate, seed ${SEED}, ${JOBS} jobs` +
    (PIMC ? `, cards with pimc (${SAMPLES ?? levelPimc?.samples} worlds)` : '') +
    (FIXED.length ? `, fixed: ${FIXED.join(', ')}` : ''),
)
let t0 = performance.now()
const best = await spsa({
  start,
  generations: GENERATIONS,
  seed: SEED,
  seedsPerGen: MATCHES,
  fixed: FIXED,
  evaluate: (plus, minus, seeds) => Promise.all([score(plus, seeds), score(minus, seeds)]),
  onStep({ gen, plus, minus, options }) {
    const s = ((performance.now() - t0) / 1000).toFixed(1)
    t0 = performance.now()
    console.log(`gen ${gen}/${GENERATIONS}  + ${pct(plus)}  - ${pct(minus)}  (${s} s)`)
    write(options)
  },
})
write(best)

console.log('')
console.log(`Best options (written to ${opt.out}), changes against the defaults:`)
for (const p of PARAMS)
  if (best[p.key] !== start[p.key]) console.log(`  ${p.key}: ${start[p.key]} -> ${best[p.key]}`)
console.log('')
const baseArg = PIMC ? `'${JSON.stringify(tuneBot({}, levelPimc))}'` : 'heuristic:hard'
console.log(`Check on new seeds: npm run bench -- --a ${opt.out} --b ${baseArg} --matches 1000 --jobs ${JOBS}`)
await Promise.all(
  workers.map((w) => {
    const exited = new Promise((resolve) => w.once('exit', resolve))
    w.postMessage({ close: true })
    return exited
  }),
)
