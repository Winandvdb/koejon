// Bot benchmark: the bot in this checkout against the bot of a git ref.
//
//   npm run bench -- [--base origin/develop] [--matches 500] [--level normal]
//
// Each seed is played twice, with the two bots swapping teams, so seat and
// deal luck cancel out. Prints the win rate of this checkout's bot with a 95%
// interval, and bidding stats from self-play of each bot.
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createServer } from 'vite'

const { values: opt } = parseArgs({
  options: {
    base: { type: 'string', default: 'origin/develop' },
    matches: { type: 'string', default: '500' },
    level: { type: 'string', default: 'normal' },
  },
})
const MATCHES = Number(opt.matches)
const STEP_CAP = 20000
const root = resolve(import.meta.dirname, '..')

// The base bot runs from its own copy of src/, so its imports stay intact.
const baseDir = mkdtempSync(join(tmpdir(), 'bot-bench-'))
execSync(`git archive ${opt.base} src | tar -x -C ${baseDir}`, { cwd: root })

const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
})
try {
  const { apply, createMatch, pendingSeats } = await server.ssrLoadModule('/src/engine/index.ts')
  const { mulberry } = await server.ssrLoadModule('/tests/helpers.ts')
  const head = (await server.ssrLoadModule('/src/bots/bot.ts')).botAction
  const base = (await server.ssrLoadModule(join(baseDir, 'src/bots/bot.ts'))).botAction

  const newStats = () => ({ hands: 0, secondUp: 0, r1: [0, 0], r2: [0, 0], trumps: [0, 0, 0, 0, 0, 0, 0] })

  /**
   * One match; `bots[team]` plays for that team. Returns the winning team.
   * @param {number} seed
   * @param {Function[]} bots
   * @param {ReturnType<typeof newStats>} [stats]
   */
  function runMatch(seed, bots, stats) {
    let s = createMatch(seed)
    const rand = mulberry(seed * 7919 + 13)
    let steps = 0
    while (s.phase !== 'GAME_OVER') {
      if (steps++ > STEP_CAP) throw new Error(`match ${seed} did not terminate`)
      const seat = pendingSeats(s)[0]
      const a = bots[seat % 2](s, seat, rand, opt.level)
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
  for (let seed = 1; seed <= MATCHES; seed++) {
    if (runMatch(seed, [head, base]) === 0) wins++
    if (runMatch(seed, [base, head]) === 1) wins++
  }
  const n = 2 * MATCHES
  const p = wins / n
  const ci = 1.96 * Math.sqrt((p * (1 - p)) / n)
  const pct = (/** @type {number} */ x) => `${(100 * x).toFixed(1)}%`

  console.log(`Bot benchmark: this checkout vs ${opt.base}, level ${opt.level}, ${n} matches`)
  console.log(`Win rate of this checkout: ${pct(p)} ± ${pct(ci)} (${wins}/${n})`)
  console.log('')
  console.log('Bidding in self-play (both teams the same bot):')
  for (const [name, bot] of [[opt.base, base], ['this checkout', head]]) {
    const st = newStats()
    for (let seed = 1; seed <= MATCHES; seed++) runMatch(seed, [bot, bot], st)
    const bids = st.r1[1] + st.r2[1]
    console.log(`  ${name}:`)
    console.log(`    1st card bid rate: ${pct(st.r1[1] / st.r1[0])}  2nd card bid rate: ${pct(st.r2[1] / st.r2[0])}`)
    console.log(`    hands with 2nd card turned: ${pct(st.secondUp / st.hands)} of ${st.hands}`)
    console.log(
      `    bids by own trump count: ${st.trumps.map((k, i) => `${i}:${k}`).join(' ')}` +
        `  (0 trump ${pct(st.trumps[0] / bids)}, 1 trump ${pct(st.trumps[1] / bids)})`,
    )
  }
} finally {
  await server.close()
  rmSync(baseDir, { recursive: true, force: true })
}
