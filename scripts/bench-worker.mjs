// Match-slice runner for the bot benchmark: loads the engine and both bots
// through a vite server, plays each seed with the sides swapped plus one
// self-play match per side, and returns the aggregates. Also the --jobs
// worker entry point: bot-benchmark.mjs spawns it with a BenchJob.
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { createServer } from 'vite'
import { loadDecider, realDecisionPhase } from './bot-spec.mjs'

const STEP_CAP = 20000

export function newBidStats() {
  return { hands: 0, secondUp: 0, r1: [0, 0], r2: [0, 0], trumps: [0, 0, 0, 0, 0, 0, 0] }
}

/** @typedef {{ n: number, ms: number, max: number }} PhaseStats */
/** @typedef {{ bidding: PhaseStats, play: PhaseStats, algos: Record<string, number> }} SideStats */
/** @typedef {{ dir: string | null, spec: import('./bot-spec.mjs').BotSpec | null }} BenchSide */
/** @typedef {{ root: string, sides: BenchSide[], level: string, seeds: number[] }} BenchJob */
/** @typedef {{ name: string, legacy: boolean, stats: SideStats }} BenchSideResult */
/** @typedef {{ wins: number, n: number, sides: BenchSideResult[], self: ReturnType<typeof newBidStats>[] }} BenchResult */

function newSideStats() {
  return {
    bidding: { n: 0, ms: 0, max: 0 },
    play: { n: 0, ms: 0, max: 0 },
    algos: /** @type {Record<string, number>} */ ({}),
  }
}

/**
 * Play every seed of `job` both ways plus self-play per side, and aggregate
 * wins, decision timing, algorithm use and bidding stats.
 * @param {BenchJob} job
 * @returns {Promise<BenchResult>}
 */
export async function runSlice(job) {
  const server = await createServer({
    root: job.root,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
  })
  try {
    const { apply, createMatch, pendingSeats, legalActions } = await server.ssrLoadModule(
      '/src/engine/index.ts',
    )
    const { seededRandom } = await server.ssrLoadModule('/src/lib/seed.ts')

    const sides = []
    const sideStats = [newSideStats(), newSideStats()]
    for (const [i, side] of job.sides.entries()) {
      const loaded = await loadDecider(server, side.dir, side.spec ?? null, job.level)
      const st = sideStats[i]
      // Time every call; count only real decisions, split by phase, and which
      // algorithm the trace says decided (the bot name for a legacy botAction).
      const decide = (/** @type {object} */ s, /** @type {number} */ seat, /** @type {() => number} */ rand) => {
        const phase = realDecisionPhase(legalActions(s, seat))
        const trace = /** @type {import('../src/bots/algorithm.ts').BotTrace} */ ({
          candidates: [],
          notes: [],
        })
        const t0 = performance.now()
        const a = loaded.decide(s, seat, rand, trace)
        const ms = performance.now() - t0
        if (phase) {
          const t = st[phase]
          t.n++
          t.ms += ms
          if (ms > t.max) t.max = ms
          const id = trace.algorithm ?? loaded.name
          st.algos[id] = (st.algos[id] ?? 0) + 1
        }
        return a
      }
      sides.push({ name: loaded.name, legacy: loaded.legacy, decide })
    }

    /**
     * One match; `pair[team]` plays for that team. Returns the winning team.
     * @param {number} seed
     * @param {Function[]} pair
     * @param {ReturnType<typeof newBidStats>} [stats]
     */
    function runMatch(seed, pair, stats) {
      let s = createMatch(seed)
      const rand = seededRandom(seed * 7919 + 13)
      let steps = 0
      while (s.phase !== 'GAME_OVER') {
        if (steps++ > STEP_CAP) throw new Error(`match ${seed} did not terminate`)
        const seat = pendingSeats(s)[0]
        const a = pair[seat % 2](s, seat, rand)
        if (stats && a.type === 'bid') {
          const r1 = s.phase === 'BIDDING_R1'
          const suit = r1 ? s.turned.first.s : s.turned.second.s
          stats[r1 ? 'r1' : 'r2'][0]++
          if (a.play) {
            stats[r1 ? 'r1' : 'r2'][1]++
            stats.trumps[s.hands[seat].filter((/** @type {{ s: string }} */ c) => c.s === suit).length]++
          }
        }
        const next = apply(s, a)
        if (stats && s.phase === 'DEALING') stats.hands++
        if (stats && !s.turned?.secondUp && next.turned?.secondUp) stats.secondUp++
        s = next
      }
      return s.winner
    }

    let wins = 0
    const self = [newBidStats(), newBidStats()]
    for (const seed of job.seeds) {
      if (runMatch(seed, [sides[0].decide, sides[1].decide]) === 0) wins++
      if (runMatch(seed, [sides[1].decide, sides[0].decide]) === 1) wins++
      runMatch(seed, [sides[0].decide, sides[0].decide], self[0])
      runMatch(seed, [sides[1].decide, sides[1].decide], self[1])
    }
    return {
      wins,
      n: job.seeds.length * 2,
      sides: sides.map((s, i) => ({ name: s.name, legacy: s.legacy, stats: sideStats[i] })),
      self,
    }
  } finally {
    await server.close()
  }
}

const port = parentPort
if (!isMainThread && port) {
  runSlice(/** @type {BenchJob} */ (workerData)).then(
    (r) => port.postMessage(r),
    // A rejection must reach the parent: an exit code alone hides the cause.
    (e) => port.postMessage({ error: String(e instanceof Error ? e.stack ?? e.message : e) }),
  )
}
