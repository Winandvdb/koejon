// Bot benchmark: this checkout's bot against a git ref's, or any two bots
// against each other.
//
//   npm run bench -- [--base origin/develop] [--matches 500] [--level normal]
//   npm run bench -- --a heuristic:hard --b origin/develop@heuristic:easy [--jobs 4]
//
// A side (--a / --b) is "[<git ref>@]<spec>": an algorithm id, inline JSON or
// a bot configuration file — see scripts/bot-spec.mjs. A missing side keeps
// today's default: side A is this checkout's botAction, side B is --base's,
// both at --level. Each seed is played twice with the sides swapped, so seat
// and deal luck cancel out. Prints side A's win rate with a 95% interval and
// bidding stats from self-play; with --a/--b also the decision timing and
// algorithm use of each side.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { Worker } from 'node:worker_threads'
import { extractRef, parseSpecArg } from './bot-spec.mjs'
import { newBidStats, runSlice } from './bench-worker.mjs'

const { values: opt } = parseArgs({
  options: {
    base: { type: 'string', default: 'origin/develop' },
    matches: { type: 'string', default: '500' },
    level: { type: 'string', default: 'normal' },
    a: { type: 'string' },
    b: { type: 'string' },
    jobs: { type: 'string', default: '1' },
  },
})
const MATCHES = Number(opt.matches)
const JOBS = Math.max(1, Math.min(MATCHES, Math.floor(Number(opt.jobs) || 1)))
const root = resolve(import.meta.dirname, '..')
const custom = opt.a != null || opt.b != null

const parsed = [
  opt.a != null ? parseSpecArg(opt.a) : { ref: null, spec: null },
  opt.b != null ? parseSpecArg(opt.b) : { ref: opt.base, spec: null },
]
const labels = [opt.a ?? 'this checkout', opt.b ?? opt.base]

/** @param {import('./bench-worker.mjs').BenchJob} job */
function runWorker(job) {
  return new Promise((resolvePromise, reject) => {
    const w = new Worker(new URL('./bench-worker.mjs', import.meta.url), { workerData: job })
    w.once('message', resolvePromise)
    w.once('error', reject)
    w.once('exit', (code) => {
      if (code !== 0) reject(new Error(`worker exited with code ${code}`))
    })
  })
}

/**
 * @param {import('./bench-worker.mjs').BenchResult[]} parts
 * @returns {import('./bench-worker.mjs').BenchResult}
 */
function mergeParts(parts) {
  const out = parts[0]
  for (const part of parts.slice(1)) {
    out.wins += part.wins
    out.n += part.n
    for (const i of [0, 1]) {
      for (const phase of /** @type {const} */ (['bidding', 'play'])) {
        const a = out.sides[i].stats[phase]
        const b = part.sides[i].stats[phase]
        a.n += b.n
        a.ms += b.ms
        a.max = Math.max(a.max, b.max)
      }
      for (const [id, k] of Object.entries(part.sides[i].stats.algos))
        out.sides[i].stats.algos[id] = (out.sides[i].stats.algos[id] ?? 0) + k
      const a = out.self[i]
      const b = part.self[i]
      a.hands += b.hands
      a.secondUp += b.secondUp
      for (const j of [0, 1]) {
        a.r1[j] += b.r1[j]
        a.r2[j] += b.r2[j]
      }
      for (let j = 0; j < a.trumps.length; j++) a.trumps[j] += b.trumps[j]
    }
  }
  return out
}

const tmp = mkdtempSync(join(tmpdir(), 'bot-bench-'))
try {
  // Refs share one temp dir; each side without a ref uses this checkout.
  const refDirs = /** @type {Record<string, string>} */ ({})
  for (const p of parsed)
    if (p.ref != null && refDirs[p.ref] == null) refDirs[p.ref] = extractRef(root, p.ref, tmp)
  const sides = parsed.map((p) => ({ dir: p.ref == null ? null : refDirs[p.ref], spec: p.spec }))
  const seeds = Array.from({ length: MATCHES }, (_, i) => i + 1)
  const parts =
    JOBS <= 1
      ? [await runSlice({ root, sides, level: opt.level, seeds })]
      : await Promise.all(
          Array.from({ length: JOBS }, (_, w) =>
            runWorker({
              root,
              sides,
              level: opt.level,
              seeds: seeds.filter((_, i) => i % JOBS === w),
            }),
          ),
        )
  const result = mergeParts(parts)

  const n = result.n
  const p = result.wins / n
  const ci = 1.96 * Math.sqrt((p * (1 - p)) / n)
  const pct = (/** @type {number} */ x) => `${(100 * x).toFixed(1)}%`
  const ms = (/** @type {import('./bench-worker.mjs').PhaseStats} */ t) =>
    t.n === 0 ? '-' : `${(t.ms / t.n).toFixed(1)} ms, max ${t.max.toFixed(1)} ms`

  if (!custom) {
    console.log(`Bot benchmark: this checkout vs ${opt.base}, level ${opt.level}, ${n} matches`)
    console.log(`Win rate of this checkout: ${pct(p)} ± ${pct(ci)} (${result.wins}/${n})`)
  } else {
    console.log(`Bot benchmark: ${labels[0]} vs ${labels[1]}, ${n} matches`)
    console.log(`Win rate of ${labels[0]}: ${pct(p)} ± ${pct(ci)} (${result.wins}/${n})`)
    for (const [i, side] of result.sides.entries())
      if (side.legacy && parsed[i].spec != null)
        console.log(`note: ${labels[i]} has no bot framework, used ${side.name}`)
    console.log('')
    console.log('Decisions (real choices only):')
    for (const [i, side] of result.sides.entries()) {
      const t = side.stats
      const total = t.bidding.n + t.play.n
      const algos =
        total === 0
          ? '-'
          : Object.entries(t.algos)
              .sort((x, y) => y[1] - x[1])
              .map(([id, k]) => `${id} ${pct(k / total)}`)
              .join(', ')
      console.log(
        `  ${labels[i]}: ${total} — bidding ${t.bidding.n} (avg ${ms(t.bidding)}),` +
          ` play ${t.play.n} (avg ${ms(t.play)})`,
      )
      console.log(`    algorithms: ${algos}`)
    }
  }
  console.log('')
  console.log('Bidding in self-play (both teams the same bot):')
  for (const i of [1, 0]) {
    const st = result.self[i]
    const bids = st.r1[1] + st.r2[1]
    console.log(`  ${labels[i]}:`)
    console.log(
      `    1st card bid rate: ${pct(st.r1[1] / st.r1[0])}  2nd card bid rate: ${pct(st.r2[1] / st.r2[0])}`,
    )
    console.log(`    hands with 2nd card turned: ${pct(st.secondUp / st.hands)} of ${st.hands}`)
    console.log(
      `    bids by own trump count: ${st.trumps.map((k, i) => `${i}:${k}`).join(' ')}` +
        `  (0 trump ${pct(st.trumps[0] / bids)}, 1 trump ${pct(st.trumps[1] / bids)})`,
    )
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
